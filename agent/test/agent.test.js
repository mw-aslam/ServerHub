'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMeminfo,
  parseDf,
  parseLoadavg,
  parseJlist,
  normalizeProcesses,
  parseBattery,
  parseSysBattery,
  parsePmset,
  parseWindowsBattery,
  parseVmStat,
  parseWifi,
  parseTop,
  readDevice,
  keepLastBattery,
  createCpuSampler,
  createCollector,
} = require('../collectors');
const { formatEnvFile, redact } = require('../add-project');
const { detectPlatform } = require('../platform');
const { createExecutor, isExpired, trimOutput, MAX_OUTPUT_CHARS } = require('../commands');
const { buildConfig, parseEnv } = require('../config');
const { runProcess, resolveTool, createToolRunner } = require('../process-runner');

const processes = [
  { name: 'app', cwd: '/home/app' },
  { name: 'serverhub-agent', cwd: '/home/agent' },
  { name: 'all', cwd: '/home/all' },
  { name: '12', cwd: '/home/12' },
];

function setup({ fail = [], exists = () => true } = {}) {
  const calls = [];
  const run = async (file, args, options) => {
    calls.push({ file, args, cwd: options?.cwd });
    const failed = fail.includes(file);
    return { ok: !failed, code: failed ? 1 : 0, timedOut: false, stdout: 'ok', stderr: '', errorMessage: '' };
  };
  const executor = createExecutor({
    run,
    listProcesses: async () => processes,
    agentName: 'serverhub-agent',
    pathExists: exists,
  });
  return { calls, executor };
}

test('meminfo: занято считается по MemAvailable', () => {
  assert.deepEqual(parseMeminfo('MemTotal: 2048000 kB\nMemFree: 100 kB\nMemAvailable: 1024000 kB\n'), {
    totalMb: 2000,
    usedMb: 1000,
    freeMb: 1000,
  });
  assert.equal(parseMeminfo('garbage'), null);
});

test('df: разбирается последняя строка', () => {
  const output = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/fuse 10240 2048 8192 20% /storage\n';
  assert.deepEqual(parseDf(output), { totalMb: 10, usedMb: 2, freeMb: 8 });
  assert.equal(parseDf('Filesystem\n'), null);
});

test('loadavg: нули считаются недоступным значением', () => {
  assert.deepEqual(parseLoadavg('0.50 0.25 0.10 1/100 123'), { load1: 0.5, load5: 0.25, load15: 0.1 });
  assert.equal(parseLoadavg('0.00 0.00 0.00 1/100 123'), null);
});

test('jlist: служебные строки пропускаются', () => {
  assert.deepEqual(parseJlist('[PM2] Spawning daemon\n[{"name":"a"}]\n'), [{ name: 'a' }]);
  assert.deepEqual(parseJlist('[]'), []);
  assert.throws(() => parseJlist('[PM2] error'));
});

test('процессы: объединение cluster и отсутствие переменных окружения', () => {
  const list = [
    { name: 'web', pid: 11, monit: { cpu: 5, memory: 10485760 }, pm2_env: { status: 'online', pm_uptime: 1000, restart_time: 1, pm_cwd: '/w', SECRET: 'x' } },
    { name: 'web', pid: 12, monit: { cpu: 7, memory: 10485760 }, pm2_env: { status: 'stopped', restart_time: 2, pm_cwd: '/w' } },
    { name: 'serverhub-agent', pid: 0, monit: {}, pm2_env: { status: 'stopped' } },
  ];
  const [web, agent] = normalizeProcesses(list, 'serverhub-agent');
  assert.equal(web.cpu, 12);
  assert.equal(web.memoryMb, 20);
  assert.equal(web.restarts, 3);
  assert.equal(web.status, 'online');
  assert.equal(web.SECRET, undefined);
  assert.equal(agent.isAgent, true);
  assert.equal(agent.pid, null);
});

test('батарея Termux: подключение и ток', () => {
  assert.deepEqual(
    parseBattery('{"percentage":15,"status":"DISCHARGING","plugged":"UNPLUGGED","temperature":31.26,"health":"GOOD","current":-320000}'),
    { percent: 15, charging: false, temperature: 31.3, health: 'GOOD', status: 'DISCHARGING', plugged: 'UNPLUGGED', currentMa: -320 },
  );
  assert.equal(parseBattery('{"percentage":100,"status":"FULL"}').charging, true);
  assert.equal(parseBattery('{"percentage":80,"status":"NOT_CHARGING","plugged":"PLUGGED_USB"}').charging, true);
  assert.equal(parseBattery('{"percentage":80,"status":"NOT_CHARGING","plugged":"UNPLUGGED"}').charging, false);
  assert.equal(parseBattery('{"percentage":50,"current":450}').currentMa, 450);
  assert.equal(parseBattery('{"percentage":50,"current":999999999}').currentMa, null);
  assert.equal(parseBattery('{"percentage":50}').currentMa, null);
  assert.equal(parseBattery('{"API_ERROR":"x"}'), null);
});

test('Wi-Fi: сеть, геолокация, мобильная сеть', () => {
  const wifi = parseWifi('{"ssid":"\\"Home\\"","supplicant_state":"COMPLETED","ip":"192.168.1.5","rssi":-55,"link_speed_mbps":72,"frequency_mhz":2437}');
  assert.deepEqual(wifi, { type: 'wifi', ssid: 'Home', rssi: -55, linkSpeedMbps: 72, frequencyMhz: 2437, reason: null });

  const hidden = parseWifi('{"ssid":"<unknown ssid>","supplicant_state":"COMPLETED","ip":"192.168.1.5","rssi":-60}');
  assert.equal(hidden.type, 'wifi');
  assert.equal(hidden.ssid, null);
  assert.equal(hidden.reason, 'location');

  const mobile = parseWifi('{"ssid":"<unknown ssid>","supplicant_state":"DISCONNECTED","ip":"0.0.0.0","rssi":-127}');
  assert.equal(mobile.type, 'mobile');
  assert.throws(() => parseWifi('{"API_ERROR":"нет разрешения"}'));
});

test('CPU из top: toybox, procps, мусор', () => {
  assert.equal(parseTop('Tasks: 5\n800%cpu  12%user   0%nice  28%sys 760%idle   0%iow\n'), 5);
  assert.equal(parseTop('%Cpu(s):  1.5 us,  0.5 sy,  0.0 ni, 97.5 id,  0.5 wa\n'), 2.5);
  assert.equal(parseTop('%Cpu(s):  1,5 us,  0,5 sy,  0,0 ni, 90,0 id\n'), 10);
  assert.equal(parseTop('нет заголовка'), null);
  assert.equal(parseTop('0%cpu 0%idle'), null);
});

test('модель и версия Android, запасной путь getprop', async () => {
  const run = async (file, [name]) => {
    if (file === 'getprop') return { ok: false, stdout: '', code: 'ENOENT' };
    return { ok: true, stdout: name === 'ro.product.model' ? 'M2003J15SC\n' : '10\n' };
  };
  assert.deepEqual(await readDevice(run), { model: 'M2003J15SC', androidVersion: '10' });
  assert.deepEqual(await readDevice(async () => ({ ok: false, stdout: '' })), { model: null, androidVersion: null });
});

const validProject = (over = {}) => ({
  action: 'add_project',
  project: 'my-bot_1',
  payload: { repoUrl: 'https://github.com/user/my-bot', startCommand: 'npm start' },
  env: [{ key: 'TOKEN', value: 'super-secret-value' }],
  ...over,
});

function setupAddProject({ fail = [], existing = [], repoFiles = ['package.json', 'index.js'], processes: list = processes, writeError } = {}) {
  const calls = [];
  const written = [];
  const removed = [];
  const present = new Set(existing);
  const run = async (file, args, options) => {
    calls.push({ file, args, cwd: options?.cwd });
    if (file === 'git') for (const name of repoFiles) present.add(`/p/my-bot_1/${name}`.replace(/\//g, require('node:path').sep));
    const failed = fail.includes(`${file} ${args[0]}`);
    return { ok: !failed, code: failed ? 1 : 0, timedOut: false, stdout: 'вывод super-secret-value', stderr: '', errorMessage: '' };
  };
  const executor = createExecutor({
    run,
    listProcesses: async () => list,
    agentName: 'serverhub-agent',
    projectsRoot: '/p',
    npmEntry: 'npm',
    projectFiles: {
      exists: (target) => present.has(target),
      mkdir: async () => {},
      remove: async (target) => removed.push(target),
      writeSecret: async (file, content) => {
        if (writeError) throw writeError;
        written.push({ file, content });
      },
    },
  });
  return { calls, written, removed, executor };
}

test('add_project: порядок шагов, shell не нужен, .env записан', async () => {
  const { calls, written, removed, executor } = setupAddProject();
  const result = await executor.execute(validProject());
  assert.equal(result.status, 'success');
  assert.deepEqual(calls.map((call) => `${call.file} ${call.args[0]}`), ['git clone', 'npm install', 'pm2 start', 'pm2 save']);
  assert.deepEqual(calls[0].args.slice(0, 4), ['clone', '--depth', '1', '--']);
  assert.deepEqual(calls[2].args.slice(0, 2), ['start', 'npm']);
  assert.deepEqual(calls[2].args.slice(-2), ['--', 'start']);
  assert.equal(written[0].content, 'TOKEN=super-secret-value\n');
  assert.equal(removed.length, 0);
});

test('add_project: значения .env не попадают в вывод и в аргументы', async () => {
  const { calls, executor } = setupAddProject();
  const result = await executor.execute(validProject());
  assert.ok(!result.output.includes('super-secret-value'));
  assert.ok(result.output.includes('***'));
  assert.ok(!JSON.stringify(calls).includes('super-secret-value'));
});

test('add_project: node index.js', async () => {
  const { calls, executor } = setupAddProject();
  await executor.execute(validProject({ payload: { repoUrl: 'https://github.com/user/my-bot.git', startCommand: 'node index.js' } }));
  assert.deepEqual(calls[2].args.slice(0, 2), ['start', 'index.js']);
});

test('add_project: опасные адреса и имена не запускают ничего', async () => {
  const urls = [
    'http://github.com/a/b', 'https://github.com.evil.com/a/b', 'https://evil.com/github.com/a/b',
    'https://user:pass@github.com/a/b', 'https://github.com/a/b?x=1', 'https://github.com/a/b#x',
    'https://github.com/a/../b', 'https://github.com/a/..', 'https://github.com/-a/b',
    'https://github.com/a/b/c', 'https://github.com/a/b;reboot', 'https://github.com/a/$(reboot)',
    'ext::sh -c reboot', '--upload-pack=reboot', 'file:///etc', '', null, 5,
  ];
  for (const repoUrl of urls) {
    const { calls, executor } = setupAddProject();
    const result = await executor.execute(validProject({ payload: { repoUrl, startCommand: 'npm start' } }));
    assert.equal(result.status, 'error', String(repoUrl));
    assert.equal(calls.length, 0, String(repoUrl));
  }
  for (const project of ['-x', '--force', '../up', 'a/b', 'a b', 'a;b', 'all', 'ALL', '123', 'con', '', 'x'.repeat(65), null]) {
    const { calls, executor } = setupAddProject();
    const result = await executor.execute(validProject({ project }));
    assert.equal(result.status, 'error', String(project));
    assert.equal(calls.length, 0, String(project));
  }
  for (const startCommand of ['rm -rf /', 'npm run evil', '', undefined]) {
    const { calls, executor } = setupAddProject();
    await executor.execute(validProject({ payload: { repoUrl: 'https://github.com/a/b', startCommand } }));
    assert.equal(calls.length, 0, String(startCommand));
  }
});

test('add_project: неверные переменные отклоняются', async () => {
  const bad = [
    [{ key: 'A B', value: 'x' }], [{ key: '1A', value: 'x' }], [{ key: 'A\nB', value: 'x' }],
    [{ key: 'A', value: 'x\nEVIL=1' }], [{ key: 'A', value: 5 }],
    [{ key: 'A', value: '1' }, { key: 'A', value: '2' }], 'нет',
  ];
  for (const env of bad) {
    const { calls, executor } = setupAddProject();
    assert.equal((await executor.execute(validProject({ env }))).status, 'error');
    assert.equal(calls.length, 0);
  }
  const { calls, executor } = setupAddProject();
  assert.equal((await executor.execute(validProject({ envError: true }))).status, 'error');
  assert.equal(calls.length, 0);
});

test('add_project: существующий проект и папка не перезаписываются', async () => {
  const byPm2 = setupAddProject({ processes: [{ name: 'my-bot_1' }] });
  assert.equal((await byPm2.executor.execute(validProject())).status, 'error');
  assert.equal(byPm2.calls.length, 0);

  const byDir = setupAddProject({ existing: [require('node:path').join('/p', 'my-bot_1')] });
  assert.equal((await byDir.executor.execute(validProject())).status, 'error');
  assert.equal(byDir.calls.length, 0);
  assert.equal(byDir.removed.length, 0, 'чужая папка не удаляется');
});

test('add_project: при ошибке папка удаляется, следующие шаги не идут', async () => {
  for (const [step, expected] of [['git clone', 1], ['npm install', 2], ['pm2 start', 3]]) {
    const { calls, removed, executor } = setupAddProject({ fail: [step] });
    const result = await executor.execute(validProject());
    assert.equal(result.status, 'error', step);
    assert.equal(calls.length, expected, step);
    assert.equal(removed.length, 1, step);
    assert.ok(!result.output.includes('super-secret-value'), step);
  }
  const noPackage = setupAddProject({ repoFiles: [] });
  assert.equal((await noPackage.executor.execute(validProject())).status, 'error');
  assert.equal(noPackage.removed.length, 1);

  const envExists = setupAddProject({ writeError: Object.assign(new Error('x'), { code: 'EEXIST' }) });
  const result = await envExists.executor.execute(validProject());
  assert.equal(result.status, 'error');
  assert.match(result.output, /уже есть файл .env/);
});

test('add_project: сбой pm2 save не отменяет запущенный проект', async () => {
  const { removed, executor } = setupAddProject({ fail: ['pm2 save'] });
  const result = await executor.execute(validProject());
  assert.equal(result.status, 'success');
  assert.equal(removed.length, 0);
  assert.match(result.output, /pm2 save не сработал/);
});

test('.env: кавычки и особые символы', () => {
  assert.equal(formatEnvFile([{ key: 'A', value: 'b c' }]).content, 'A="b c"\n');
  assert.equal(formatEnvFile([{ key: 'A', value: 'b"c d' }]).content, "A='b\"c d'\n");
  assert.equal(formatEnvFile([{ key: 'A', value: 'x#y' }]).content, 'A="x#y"\n');
  assert.equal(formatEnvFile([{ key: 'A', value: '' }]).content, 'A=\n');
  assert.ok(formatEnvFile([{ key: 'A', value: '"\'`' }]).error);
  assert.equal(redact('a secret b', [{ key: 'K', value: 'secret' }]), 'a *** b');
  assert.equal(redact('a 1 b', [{ key: 'K', value: '1' }]), 'a 1 b');
});

test('Termux:API не установлен: агент не падает и сообщает причину', async () => {
  const config = {
    platform: 'termux', agentName: 'a', pm2IntervalMs: 1000, batteryIntervalMs: 1000,
    diskIntervalMs: 1000, wifiIntervalMs: 1000,
  };
  const run = async (file) => {
    if (file.startsWith('termux-')) return { ok: false, code: 'ENOENT', stdout: '', stderr: '' };
    if (file === 'pm2') return { ok: true, code: 0, stdout: '[]', stderr: '' };
    return { ok: false, code: 1, stdout: '', stderr: '' };
  };
  const snapshot = await createCollector(config, run).collect(null);
  assert.equal(snapshot.battery, null);
  assert.equal(snapshot.termuxApi, 'no_package');
  assert.equal(snapshot.network.connection.type, 'unknown');
  assert.equal(snapshot.network.connection.reason, 'no_package');
  assert.notEqual(snapshot.cpu.percent, undefined);
});

test('Termux:API завис: причина no_app', async () => {
  const config = {
    platform: 'termux', agentName: 'a', pm2IntervalMs: 1000, batteryIntervalMs: 1000,
    diskIntervalMs: 1000, wifiIntervalMs: 1000,
  };
  const run = async (file) => {
    if (file.startsWith('termux-')) return { ok: false, code: null, timedOut: true, stdout: '', stderr: '' };
    return { ok: file === 'pm2', code: 0, stdout: '[]', stderr: '' };
  };
  const snapshot = await createCollector(config, run).collect(null);
  assert.equal(snapshot.termuxApi, 'no_app');
  assert.equal(snapshot.network.connection.reason, 'no_app');
});

test('белый список: неизвестное действие не запускает ничего', async () => {
  const { calls, executor } = setup();
  for (const action of ['exec', 'delete', 'rm -rf', '', undefined]) {
    const result = await executor.execute({ action, project: 'app' });
    assert.equal(result.status, 'error');
  }
  assert.equal(calls.length, 0);
});

test('имена: только из pm2 jlist и без особого смысла для pm2', async () => {
  const { calls, executor } = setup();
  for (const project of ['ghost', 'app; rm -rf /', '$(reboot)', '--force', 'all', '12', '', null]) {
    const result = await executor.execute({ action: 'restart', project });
    assert.equal(result.status, 'error', String(project));
  }
  assert.equal(calls.length, 0);
});

test('start, stop, restart и logs формируют точные аргументы', async () => {
  const { calls, executor } = setup();
  await executor.execute({ action: 'start', project: 'app' });
  await executor.execute({ action: 'stop', project: 'app' });
  await executor.execute({ action: 'restart', project: 'app' });
  await executor.execute({ action: 'logs', project: 'app' });
  assert.deepEqual(calls.map((call) => [call.file, ...call.args]), [
    ['pm2', 'start', 'app'],
    ['pm2', 'stop', 'app'],
    ['pm2', 'restart', 'app'],
    ['pm2', 'logs', 'app', '--lines', '100', '--nostream'],
  ]);
});

test('update: git, npm, restart в папке проекта', async () => {
  const { calls, executor } = setup();
  const result = await executor.execute({ action: 'update', project: 'app' });
  assert.equal(result.status, 'success');
  assert.deepEqual(calls.map((call) => call.file), ['git', 'npm', 'pm2']);
  assert.equal(calls[0].cwd, '/home/app');
  assert.equal(calls[1].cwd, '/home/app');
});

test('update: при ошибке git следующие шаги не выполняются', async () => {
  const { calls, executor } = setup({ fail: ['git'] });
  const result = await executor.execute({ action: 'update', project: 'app' });
  assert.equal(result.status, 'error');
  assert.deepEqual(calls.map((call) => call.file), ['git']);
});

test('агент: стоп запрещён, перезапуск только после отправки результата', async () => {
  const { calls, executor } = setup();
  const stop = await executor.execute({ action: 'stop', project: 'serverhub-agent' });
  assert.equal(stop.status, 'error');
  assert.equal(calls.length, 0);

  const restart = await executor.execute({ action: 'restart', project: 'serverhub-agent' });
  assert.equal(restart.status, 'success');
  assert.equal(calls.length, 0);
  await restart.afterReport();
  assert.deepEqual(calls[0].args, ['restart', 'serverhub-agent']);
});

test('срок годности команды и обрезка вывода', () => {
  assert.equal(isExpired(60_000), false);
  assert.equal(isExpired(60_001), true);
  assert.equal(isExpired(NaN), true);
  assert.ok(trimOutput('x'.repeat(MAX_OUTPUT_CHARS + 10)).length < MAX_OUTPUT_CHARS + 50);
});

test('runProcess не интерпретирует аргументы и не отдаёт AGENT_KEY', async () => {
  process.env.AGENT_KEY = 'secret';
  const script = 'console.log(process.argv[1], process.env.AGENT_KEY === undefined)';
  const result = await runProcess(process.execPath, ['-e', script, '$(echo hacked); ls'], {});
  delete process.env.AGENT_KEY;
  assert.equal(result.stdout.trim(), '$(echo hacked); ls true');
});

const SERVER_ID = '7f3c1a52-9d4e-4b8a-a1c3-0e2f5d6b7c81';

test('конфигурация: интервал по умолчанию и защита от http', () => {
  const env = parseEnv(`\uFEFF# c\r\nBACKEND_URL="https://a.vercel.app/"\r\nSERVER_ID=${SERVER_ID}\r\nAGENT_KEY=k\r\n`);
  const config = buildConfig(env, 'linux');
  assert.equal(config.syncIntervalMs, 10_000);
  assert.equal(config.backendUrl, 'https://a.vercel.app');
  assert.equal(config.serverId, SERVER_ID);
  assert.equal(buildConfig({ ...env, SYNC_INTERVAL_SEC: '1000' }, 'linux').syncIntervalMs, 25_000);
  assert.throws(() => buildConfig({ ...env, BACKEND_URL: 'http://a.com' }, 'linux'), /https/);
  assert.throws(() => buildConfig({ ...env, AGENT_KEY: '' }, 'linux'), /AGENT_KEY/);
  assert.throws(() => buildConfig({ ...env, SERVER_ID: 'abc' }, 'linux'), /SERVER_ID/);
});

test('определение платформы', () => {
  const none = () => false;
  assert.equal(detectPlatform('win32', {}, none), 'windows');
  assert.equal(detectPlatform('darwin', {}, none), 'macos');
  assert.equal(detectPlatform('android', {}, none), 'termux');
  assert.equal(detectPlatform('linux', {}, none), 'linux');
  assert.equal(detectPlatform('linux', { TERMUX_VERSION: '0.118' }, none), 'termux');
  assert.equal(detectPlatform('linux', { PREFIX: '/data/data/com.termux/files/usr' }, none), 'termux');
});

test('Windows: pm2 и npm запускаются через node без shell', async () => {
  const options = { platform: 'windows', pm2Script: '', env: { APPDATA: 'C:\\A' }, execPath: 'C:\\node\\node.exe' };
  assert.deepEqual(resolveTool('pm2', options), {
    file: 'C:\\node\\node.exe',
    prefix: ['C:\\A\\npm\\node_modules\\pm2\\bin\\pm2'],
  });
  assert.deepEqual(resolveTool('npm', options).prefix, ['C:\\node\\node_modules\\npm\\bin\\npm-cli.js']);
  assert.deepEqual(resolveTool('git', options), { file: 'git', prefix: [] });
  assert.equal(resolveTool('pm2', { ...options, pm2Script: 'D:\\pm2' }).prefix[0], 'D:\\pm2');
  assert.deepEqual(resolveTool('pm2', { platform: 'linux', pm2Script: '' }), { file: 'pm2', prefix: [] });

  const calls = [];
  const run = createToolRunner(options, async (file, args) => calls.push([file, args]));
  await run('pm2', ['restart', 'a b; calc']);
  assert.deepEqual(calls[0][1], ['C:\\A\\npm\\node_modules\\pm2\\bin\\pm2', 'restart', 'a b; calc']);
});

test('батарея на разных системах', () => {
  assert.deepEqual(parseSysBattery({ capacity: '81', status: 'Discharging', temp: '312', health: 'Good' }), {
    percent: 81, charging: false, temperature: 31.2, health: 'GOOD', status: 'DISCHARGING',
  });
  assert.equal(parseSysBattery({ capacity: '80', status: 'Not charging', temp: null, health: null }).charging, true);
  assert.equal(parseSysBattery({ capacity: null, status: null, temp: null, health: null }), null);
  assert.equal(parseSysBattery({ capacity: '104', status: 'Full', temp: '99999', health: null }).percent, 100);
  assert.equal(parseSysBattery({ capacity: '50', status: 'Full', temp: '99999', health: null }).temperature, null);

  const mac = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t85%; discharging; 3:10 remaining present: true\n";
  assert.deepEqual(parsePmset(mac), { percent: 85, charging: false, temperature: null, health: null, status: 'DISCHARGING' });
  assert.equal(parsePmset(" -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining\n").charging, true);
  assert.equal(parsePmset(" -InternalBattery-0 (id=1)\t80%; AC attached; not charging\n").status, 'PLUGGED');
  assert.equal(parsePmset("Now drawing from 'AC Power'\n"), null);

  assert.deepEqual(parseWindowsBattery('{"EstimatedChargeRemaining":42,"BatteryStatus":1}'), {
    percent: 42, charging: false, temperature: null, health: null, status: 'DISCHARGING',
  });
  assert.equal(parseWindowsBattery('[{"EstimatedChargeRemaining":90,"BatteryStatus":2}]').charging, true);
  assert.equal(parseWindowsBattery(''), null);
});

test('батарея: единичный сбой не скрывает карточку', async () => {
  const values = [{ percent: 50 }, null, null, null, { percent: 49 }];
  const read = keepLastBattery(async () => values.shift());
  assert.deepEqual(await read(), { percent: 50 });
  assert.deepEqual(await read(), { percent: 50 });
  assert.deepEqual(await read(), { percent: 50 });
  assert.equal(await read(), null);
  assert.deepEqual(await read(), { percent: 49 });
});

test('память macOS и загрузка CPU по времени ядер', () => {
  const text = 'Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free:   1000.\nPages inactive:  500.\nPages speculative:  12.\n';
  const ram = parseVmStat(text, 1024 * 1024 * 1024);
  assert.equal(ram.totalMb, 1024);
  assert.equal(ram.freeMb, 6);
  assert.equal(parseVmStat('нет', 1), null);

  let idle = 100;
  let user = 100;
  const sample = createCpuSampler(() => [{ times: { user, nice: 0, sys: 0, idle, irq: 0 } }]);
  idle += 75;
  user += 25;
  assert.equal(sample(), 25);
  assert.equal(sample(), null);
  assert.equal(createCpuSampler(() => [])(), null);
});
