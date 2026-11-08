'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BYTES_IN_MB = 1024 * 1024;
const WINDOWS_MIN_BATTERY_INTERVAL_MS = 120_000;

const round = (value, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const clampPercent = (value) => Math.min(100, Math.max(0, value));

// Сайт отклоняет снимок с невозможными значениями, поэтому такие датчики отбрасываем.
const saneTemperature = (value) =>
  Number.isFinite(value) && value >= -40 && value <= 150 ? round(value) : null;

function parseMeminfo(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^(\w+):\s+(\d+)/);
    if (match) values[match[1]] = Number(match[2]);
  }
  if (!values.MemTotal) return null;
  const available = values.MemAvailable ?? (values.MemFree || 0) + (values.Cached || 0);
  return {
    totalMb: Math.round(values.MemTotal / 1024),
    usedMb: Math.round((values.MemTotal - available) / 1024),
    freeMb: Math.round(available / 1024),
  };
}

// os.freemem() в macOS не учитывает кэш, который система может освободить.
function parseVmStat(text, totalBytes) {
  const pageSize = Number(text.match(/page size of (\d+) bytes/)?.[1]);
  if (!pageSize) return null;
  const pages = (label) => Number(text.match(new RegExp(`${label}:\\s+(\\d+)`))?.[1]) || 0;
  const availableBytes =
    (pages('Pages free') + pages('Pages inactive') + pages('Pages speculative')) * pageSize;
  return {
    totalMb: Math.round(totalBytes / BYTES_IN_MB),
    usedMb: Math.round((totalBytes - availableBytes) / BYTES_IN_MB),
    freeMb: Math.round(availableBytes / BYTES_IN_MB),
  };
}

function memoryFromOs() {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    totalMb: Math.round(total / BYTES_IN_MB),
    usedMb: Math.round((total - free) / BYTES_IN_MB),
    freeMb: Math.round(free / BYTES_IN_MB),
  };
}

function parseDf(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return null;
  const parts = lines[lines.length - 1].trim().split(/\s+/);
  if (parts.length < 6) return null;
  const totalKb = Number(parts[1]);
  const usedKb = Number(parts[2]);
  const freeKb = Number(parts[3]);
  if (![totalKb, usedKb, freeKb].every(Number.isFinite) || totalKb <= 0) return null;
  return {
    totalMb: Math.round(totalKb / 1024),
    usedMb: Math.round(usedKb / 1024),
    freeMb: Math.round(freeKb / 1024),
  };
}

async function diskFromStatfs(target) {
  const stats = await fs.promises.statfs(target);
  const toMb = (blocks) => Math.round((blocks * stats.bsize) / BYTES_IN_MB);
  return {
    totalMb: toMb(stats.blocks),
    usedMb: toMb(stats.blocks - stats.bfree),
    freeMb: toMb(stats.bavail),
  };
}

function parseLoadavg(text) {
  const [load1, load5, load15] = text.trim().split(/\s+/).map(Number);
  if (![load1, load5, load15].every(Number.isFinite)) return null;
  // На части версий Android система отдаёт нули вместо реальных значений.
  if (load1 === 0 && load5 === 0 && load15 === 0) return null;
  return { load1, load5, load15 };
}

// В выводе pm2 перед JSON могут быть служебные строки вида [PM2] ...
function parseJlist(stdout) {
  const lines = stdout.split('\n').reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('[')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Это служебная строка, смотрим следующую.
    }
  }
  throw new Error('pm2 jlist вернул данные в неизвестном формате');
}

// В снимок попадают только перечисленные поля: в pm2_env лежат
// переменные окружения проектов, их нельзя отправлять наружу.
// Экземпляры одного проекта в режиме cluster объединяются в одну запись.
function normalizeProcesses(list, agentName) {
  const byName = new Map();
  for (const item of list) {
    const env = item.pm2_env || {};
    const name = String(item.name ?? env.name ?? '');
    if (!name) continue;
    const entry = {
      name,
      status: String(env.status || 'unknown'),
      cpu: Number(item.monit?.cpu) || 0,
      memoryMb: (Number(item.monit?.memory) || 0) / 1024 / 1024,
      startedAt: env.status === 'online' ? Number(env.pm_uptime) || null : null,
      restarts: Number(env.restart_time) || 0,
      pid: Number(item.pid) || null,
      cwd: typeof env.pm_cwd === 'string' ? env.pm_cwd : null,
      isAgent: name === agentName,
    };
    const existing = byName.get(name);
    if (!existing) {
      byName.set(name, entry);
      continue;
    }
    existing.cpu += entry.cpu;
    existing.memoryMb += entry.memoryMb;
    existing.restarts += entry.restarts;
    if (entry.status === 'online' && existing.status !== 'online') {
      existing.status = 'online';
      existing.startedAt = entry.startedAt;
      existing.pid = entry.pid;
    }
    if (entry.status === 'errored' && existing.status !== 'online') existing.status = 'errored';
  }
  return [...byName.values()];
}

// Android отдаёт ток в микроамперах, но часть прошивок сразу в миллиамперах.
function normalizeCurrentMa(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const milliamps = Math.abs(raw) >= 10_000 ? raw / 1000 : raw;
  return Math.abs(milliamps) <= 20_000 ? Math.round(milliamps) : null;
}

function parseBattery(stdout) {
  const data = JSON.parse(stdout);
  if (typeof data.percentage !== 'number') return null;
  const plugged = typeof data.plugged === 'string' ? data.plugged : null;
  const isPlugged = plugged !== null && plugged !== 'UNPLUGGED';
  return {
    percent: clampPercent(data.percentage),
    charging:
      data.status === 'CHARGING' ||
      data.status === 'FULL' ||
      (isPlugged && data.status !== 'DISCHARGING'),
    temperature: saneTemperature(data.temperature),
    health: typeof data.health === 'string' ? data.health : null,
    status: typeof data.status === 'string' ? data.status : null,
    plugged,
    currentMa: normalizeCurrentMa(data.current),
  };
}

function parseSysBattery({ capacity, status, temp, health }) {
  const percent = Number(capacity);
  if (capacity === null || !Number.isFinite(percent)) return null;
  const normalizedStatus = status ? status.toUpperCase().replace(/\s+/g, '_') : null;
  return {
    percent: clampPercent(percent),
    // "Not charging" у ноутбука значит, что питание подключено и заряд удерживается.
    charging: ['CHARGING', 'FULL', 'NOT_CHARGING'].includes(normalizedStatus),
    temperature: temp === null ? null : saneTemperature(Number(temp) / 10),
    health: health ? health.toUpperCase().replace(/\s+/g, '_') : null,
    status: normalizedStatus,
  };
}

const PMSET_STATUS = {
  charging: 'CHARGING',
  'finishing charge': 'CHARGING',
  charged: 'FULL',
  discharging: 'DISCHARGING',
  'ac attached': 'PLUGGED',
};

function parsePmset(stdout) {
  if (!stdout.includes('InternalBattery')) return null;
  const match = stdout.match(/(\d+)%;\s*([a-zA-Z ]+?)\s*;/);
  if (!match) return null;
  const status = PMSET_STATUS[match[2].toLowerCase()] ?? null;
  return {
    percent: clampPercent(Number(match[1])),
    charging: status !== null && status !== 'DISCHARGING',
    temperature: null,
    health: null,
    status,
  };
}

const WIN32_BATTERY_STATUS = {
  1: 'DISCHARGING',
  2: 'PLUGGED',
  3: 'FULL',
  4: 'DISCHARGING',
  5: 'DISCHARGING',
  6: 'CHARGING',
  7: 'CHARGING',
  8: 'CHARGING',
  9: 'CHARGING',
  11: 'PLUGGED',
};

function parseWindowsBattery(stdout) {
  const text = stdout.trim();
  if (!text) return null;
  const parsed = JSON.parse(text);
  const data = Array.isArray(parsed) ? parsed[0] : parsed;
  if (typeof data?.EstimatedChargeRemaining !== 'number') return null;
  const status = WIN32_BATTERY_STATUS[data.BatteryStatus] ?? null;
  return {
    percent: clampPercent(data.EstimatedChargeRemaining),
    charging: status !== null && status !== 'DISCHARGING',
    temperature: null,
    health: null,
    status,
  };
}

const inRange = (value, min, max) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;

function parseWifi(stdout) {
  const data = JSON.parse(stdout);
  if (data === null || typeof data !== 'object' || data.API_ERROR) throw new Error('wifi api error');

  const hasIp = typeof data.ip === 'string' && data.ip !== '' && data.ip !== '0.0.0.0';
  if (data.supplicant_state !== 'COMPLETED' && !hasIp) {
    return { type: 'mobile', ssid: null, rssi: null, linkSpeedMbps: null, frequencyMhz: null, reason: null };
  }

  const raw = typeof data.ssid === 'string' ? data.ssid.replace(/^"|"$/g, '') : '';
  const ssid = raw && raw !== '<unknown ssid>' ? raw.slice(0, 100) : null;
  return {
    type: 'wifi',
    ssid,
    rssi: inRange(data.rssi, -126, 0),
    linkSpeedMbps: inRange(data.link_speed_mbps, 1, 100_000),
    frequencyMhz: inRange(data.frequency_mhz, 1, 100_000),
    // Без геолокации Android подменяет имя сети на <unknown ssid>.
    reason: ssid ? null : 'location',
  };
}

function termuxFailure(result) {
  return result.code === 'ENOENT' ? 'no_package' : 'no_app';
}

// Заголовок top: toybox в Android и procps в Linux пишут его по-разному.
function parseTop(stdout) {
  const total = Number(stdout.match(/(\d+(?:\.\d+)?)%cpu\b/i)?.[1]);
  const idle = Number(stdout.match(/(\d+(?:\.\d+)?)%idle\b/i)?.[1]);
  if (total > 0 && Number.isFinite(idle)) return clampPercent(((total - idle) / total) * 100);

  const procpsIdle = stdout.match(/Cpu\(s\):.*?(\d+(?:[.,]\d+)?)\s*id\b/i)?.[1];
  if (procpsIdle !== undefined) return clampPercent(100 - Number(procpsIdle.replace(',', '.')));
  return null;
}

async function readDevice(run) {
  const prop = async (name) => {
    for (const file of ['getprop', '/system/bin/getprop']) {
      const result = await run(file, [name], { timeoutMs: 5000 });
      const value = result.ok ? result.stdout.trim() : '';
      if (value) return value.slice(0, 100);
    }
    return null;
  };
  const [model, androidVersion] = await Promise.all([
    prop('ro.product.model'),
    prop('ro.build.version.release'),
  ]);
  return { model, androidVersion };
}

// Возвращает результат не чаще раза в ttlMs и не запускает параллельных замеров.
function cached(ttlMs, producer) {
  let value = null;
  let updatedAt = -Infinity;
  let inflight = null;

  const get = (force = false) => {
    if (inflight) return inflight;
    if (!force && performance.now() - updatedAt < ttlMs) return Promise.resolve(value);
    inflight = producer()
      .catch(() => null)
      .then((result) => {
        value = result;
        updatedAt = performance.now();
        inflight = null;
        return result;
      });
    return inflight;
  };

  get.invalidate = () => {
    updatedAt = -Infinity;
  };
  return get;
}

// Панель скрывает карточку батареи при отсутствии данных. Единичный сбой
// датчика не должен заставлять карточку исчезать и появляться снова.
function keepLastBattery(read, allowedMisses = 2) {
  let last = null;
  let misses = 0;
  return async () => {
    const value = await read().catch(() => null);
    if (value) {
      last = value;
      misses = 0;
      return value;
    }
    misses += 1;
    return misses <= allowedMisses ? last : null;
  };
}

function cpuCount() {
  const fromOs =
    typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  if (fromOs > 0) return fromOs;
  try {
    const present = fs.readFileSync('/sys/devices/system/cpu/present', 'utf8').trim();
    const last = Number(present.split(/[-,]/).pop());
    if (Number.isFinite(last)) return last + 1;
  } catch {
    // Если файл недоступен, используется значение по умолчанию.
  }
  return 1;
}

function createCpuSampler(readCpus = os.cpus) {
  const read = () => {
    let total = 0;
    let idle = 0;
    for (const cpu of readCpus()) {
      for (const time of Object.values(cpu.times)) total += time;
      idle += cpu.times.idle;
    }
    return { total, idle };
  };

  let previous = read();
  return () => {
    const current = read();
    const total = current.total - previous.total;
    const idle = current.idle - previous.idle;
    previous = current;
    return total > 0 ? clampPercent((1 - idle / total) * 100) : null;
  };
}

function readLoad(platform) {
  if (platform === 'windows') return null;
  try {
    if (platform !== 'macos') {
      const load = parseLoadavg(fs.readFileSync('/proc/loadavg', 'utf8'));
      if (load) return load;
    }
  } catch {
    // Файл закрыт системой, пробуем следующий источник.
  }
  return parseLoadavg(os.loadavg().join(' '));
}

function readUptimeSec() {
  const fromOs = os.uptime();
  if (fromOs > 0) return Math.round(fromOs);
  try {
    return Math.round(Number(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0])) || null;
  } catch {
    return null;
  }
}

async function measureLatency() {
  const startedAt = performance.now();
  const response = await fetch('https://1.1.1.1/', {
    method: 'HEAD',
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  });
  const elapsed = performance.now() - startedAt;
  await response.body?.cancel();
  return Math.round(elapsed);
}

async function readLinuxBattery() {
  const base = '/sys/class/power_supply';
  const names = (await fs.promises.readdir(base)).filter((name) => /^BAT/i.test(name)).sort();
  if (names.length === 0) return null;
  const read = (file) =>
    fs.promises
      .readFile(path.join(base, names[0], file), 'utf8')
      .then((text) => text.trim())
      .catch(() => null);
  const [capacity, status, temp, health] = await Promise.all(
    ['capacity', 'status', 'temp', 'health'].map(read),
  );
  return parseSysBattery({ capacity, status, temp, health });
}

const WINDOWS_BATTERY_QUERY =
  'Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress';

function createBatteryReader(platform, run, onTermuxStatus) {
  const readers = {
    termux: async () => {
      const result = await run('termux-battery-status', [], { timeoutMs: 8000 });
      if (!result.ok) {
        onTermuxStatus(termuxFailure(result));
        return null;
      }
      try {
        const battery = parseBattery(result.stdout);
        onTermuxStatus(battery ? 'ok' : 'no_app');
        return battery;
      } catch {
        onTermuxStatus('no_app');
        return null;
      }
    },
    linux: readLinuxBattery,
    macos: async () => {
      const result = await run('pmset', ['-g', 'batt'], { timeoutMs: 8000 });
      return result.ok ? parsePmset(result.stdout) : null;
    },
    windows: async () => {
      const args = ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_BATTERY_QUERY];
      const result = await run('powershell', args, { timeoutMs: 20_000 });
      return result.ok ? parseWindowsBattery(result.stdout) : null;
    },
  };
  return readers[platform];
}

function createCollector(config, run) {
  const { platform } = config;
  const cores = cpuCount();
  const sampleCpu = createCpuSampler();
  let termuxApi = null;

  const getRawProcesses = cached(config.pm2IntervalMs, async () => {
    const result = await run('pm2', ['jlist'], { timeoutMs: 15_000 });
    if (!result.ok) throw new Error(result.stderr || result.errorMessage);
    return normalizeProcesses(parseJlist(result.stdout), config.agentName);
  });

  // Запуск PowerShell намного тяжелее чтения файла, поэтому в Windows реже.
  const batteryIntervalMs =
    platform === 'windows'
      ? Math.max(config.batteryIntervalMs, WINDOWS_MIN_BATTERY_INTERVAL_MS)
      : config.batteryIntervalMs;
  const getBattery = cached(
    batteryIntervalMs,
    keepLastBattery(
      createBatteryReader(platform, run, (status) => {
        termuxApi = status;
      }),
    ),
  );

  const getDisk = cached(config.diskIntervalMs, async () => {
    const target = os.homedir();
    if (platform === 'windows') return diskFromStatfs(target);
    const result = await run('df', ['-Pk', target], { timeoutMs: 5000 });
    const parsed = result.ok ? parseDf(result.stdout) : null;
    return parsed ?? diskFromStatfs(target);
  });

  // Данные Wi-Fi надёжно доступны только через Termux:API.
  const getConnection = cached(config.wifiIntervalMs, async () => {
    if (platform !== 'termux') return null;
    const unknown = (reason) => ({
      type: 'unknown',
      ssid: null,
      rssi: null,
      linkSpeedMbps: null,
      frequencyMhz: null,
      reason,
    });
    const result = await run('termux-wifi-connectioninfo', [], { timeoutMs: 8000 });
    if (!result.ok) return unknown(termuxFailure(result));
    try {
      return parseWifi(result.stdout);
    } catch {
      return unknown('no_app');
    }
  });

  const getDevice = cached(3_600_000, async () =>
    platform === 'termux' ? readDevice(run) : null,
  );

  const getTopCpu = cached(config.pm2IntervalMs, async () => {
    const result = await run('top', ['-b', '-n', '1'], { timeoutMs: 8000 });
    return result.ok ? parseTop(result.stdout) : null;
  });

  async function readRam() {
    if (platform === 'linux' || platform === 'termux') {
      return parseMeminfo(await fs.promises.readFile('/proc/meminfo', 'utf8'));
    }
    if (platform === 'macos') {
      const result = await run('vm_stat', [], { timeoutMs: 5000 });
      return (result.ok ? parseVmStat(result.stdout, os.totalmem()) : null) ?? memoryFromOs();
    }
    return memoryFromOs();
  }

  function publicProcess(item, now) {
    return {
      name: item.name,
      status: item.status,
      cpu: round(item.cpu),
      memoryMb: round(item.memoryMb),
      uptimeSec: item.startedAt ? Math.max(0, Math.round((now - item.startedAt) / 1000)) : 0,
      restarts: item.restarts,
      pid: item.pid,
      isAgent: item.isAgent,
    };
  }

  // Источники проверяются по очереди: в Android 10 закрыт /proc/stat.
  async function buildCpu(processes) {
    const noLoad = { load1: null, load5: null, load15: null };
    const load = readLoad(platform);
    if (load) {
      return {
        percent: round(Math.min(100, (load.load1 / cores) * 100)),
        ...load,
        cores,
        source: 'loadavg',
      };
    }
    const sampled = sampleCpu();
    if (sampled !== null) {
      return { percent: round(sampled), ...noLoad, cores, source: 'cpu-times' };
    }
    if (platform === 'termux' || platform === 'linux') {
      const fromTop = await getTopCpu();
      if (fromTop !== null) return { percent: round(fromTop), ...noLoad, cores, source: 'top' };
    }
    if (!processes) {
      return { percent: null, ...noLoad, cores, source: 'unavailable' };
    }
    const sum = processes.reduce((total, item) => total + item.cpu, 0);
    return { percent: round(Math.min(100, sum / cores)), ...noLoad, cores, source: 'pm2' };
  }

  async function collect(backendMs) {
    const [rawProcesses, battery, disk, connection, device, ram, latencyMs] = await Promise.all([
      getRawProcesses(),
      getBattery(),
      getDisk(),
      getConnection(),
      getDevice(),
      readRam().catch(() => null),
      measureLatency().catch(() => null),
    ]);
    const cpu = await buildCpu(rawProcesses);
    const now = Date.now();

    return {
      platform,
      device,
      termuxApi,
      cpu,
      ram,
      disk,
      battery,
      network: {
        latencyMs,
        backendMs: backendMs ?? null,
        wifi: connection?.ssid ?? null,
        connection,
      },
      uptimeSec: readUptimeSec(),
      pm2Available: rawProcesses !== null,
      processes: (rawProcesses || []).map((item) => publicProcess(item, now)),
    };
  }

  // Свежий список перед выполнением команды, с полем cwd для update.
  async function listProcessesFresh() {
    const processes = await getRawProcesses(true);
    if (!processes) throw new Error('Не удалось получить список проектов из pm2 jlist');
    return processes;
  }

  return {
    collect,
    listProcessesFresh,
    invalidateProcesses: getRawProcesses.invalidate,
  };
}

module.exports = {
  createCollector,
  createCpuSampler,
  keepLastBattery,
  parseMeminfo,
  parseVmStat,
  parseDf,
  parseLoadavg,
  parseJlist,
  normalizeProcesses,
  parseBattery,
  parseSysBattery,
  parsePmset,
  parseWindowsBattery,
  parseWifi,
  parseTop,
  readDevice,
  cached,
};
