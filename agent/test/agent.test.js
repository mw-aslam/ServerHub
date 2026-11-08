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
  keepLastBattery,
  createCpuSampler,
} = require('../collectors');
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

test('батарея и Wi-Fi', () => {
  assert.deepEqual(
    parseBattery('{"percentage":15,"status":"DISCHARGING","temperature":31.26,"health":"GOOD"}'),
    { percent: 15, charging: false, temperature: 31.3, health: 'GOOD', status: 'DISCHARGING' },
  );
  assert.equal(parseBattery('{"percentage":100,"status":"FULL"}').charging, true);
  assert.equal(parseWifi('{"ssid":"\\"Home\\""}'), 'Home');
  assert.equal(parseWifi('{"ssid":"<unknown ssid>"}'), null);
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
