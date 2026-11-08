'use strict';

const { loadConfig } = require('./config');
const { createCollector } = require('./collectors');
const { createExecutor, isExpired } = require('./commands');
const { createToolRunner } = require('./process-runner');

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_STORED_RESULTS = 20;

const config = loadConfig();
const run = createToolRunner(config);
const collector = createCollector(config, run);
const executor = createExecutor({
  run,
  listProcesses: collector.listProcessesFresh,
  agentName: config.agentName,
});

const commandQueue = [];
const seenCommandIds = new Set();
const pendingResults = [];

let lastBackendMs = null;
let processingQueue = false;
let syncing = false;
let timer = null;
let failedInARow = 0;

async function post(path, body) {
  const response = await fetch(`${config.backendUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.agentKey}`,
      'X-Server-Id': config.serverId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401) throw new Error('Сервер отклонил SERVER_ID или AGENT_KEY (401)');
  if (!response.ok) throw new Error(`Сервер ответил ${response.status}`);
  return response.json();
}

async function flushResults() {
  while (pendingResults.length > 0) {
    await post('/api/agent/result', pendingResults[0]);
    pendingResults.shift();
  }
}

function storeResult(result) {
  pendingResults.push(result);
  if (pendingResults.length > MAX_STORED_RESULTS) pendingResults.shift();
}

function rememberCommandId(id) {
  seenCommandIds.add(id);
  if (seenCommandIds.size > 200) seenCommandIds.delete(seenCommandIds.values().next().value);
}

function enqueueCommands(commands) {
  for (const command of commands || []) {
    if (seenCommandIds.has(command.id)) continue;
    rememberCommandId(command.id);
    commandQueue.push({ ...command, receivedAt: performance.now() });
  }
  void processQueue();
}

async function runCommand(command) {
  const currentAge = command.ageMs + (performance.now() - command.receivedAt);
  if (isExpired(currentAge)) {
    return { status: 'expired', output: 'Команда старше 60 секунд и не была выполнена.' };
  }
  try {
    return await executor.execute(command);
  } catch (error) {
    return { status: 'error', output: `Внутренняя ошибка агента: ${error.message}` };
  }
}

// Команды выполняются строго по одной и не мешают отправке метрик.
async function processQueue() {
  if (processingQueue) return;
  processingQueue = true;
  try {
    while (commandQueue.length > 0) {
      const command = commandQueue.shift();
      const { status, output, afterReport } = await runCommand(command);
      storeResult({ id: command.id, status, output: output || '' });
      await flushResults().catch(logFailure);
      if (afterReport) await afterReport();
      collector.invalidateProcesses();
      scheduleSync(200);
    }
  } finally {
    processingQueue = false;
  }
}

function logFailure(error) {
  if (failedInARow === 0) console.error(`[agent] нет связи с сервером: ${error.message}`);
}

function scheduleSync(delayMs) {
  clearTimeout(timer);
  timer = setTimeout(sync, delayMs);
}

async function sync() {
  if (syncing) return;
  syncing = true;
  let nextDelay = config.syncIntervalMs;

  try {
    const snapshot = await collector.collect(lastBackendMs);
    const startedAt = performance.now();
    const response = await post('/api/agent/sync', snapshot);
    lastBackendMs = Math.round(performance.now() - startedAt);

    enqueueCommands(response.commands);
    await flushResults();

    if (failedInARow > 0) console.log('[agent] связь с сервером восстановлена');
    failedInARow = 0;
  } catch (error) {
    // Пишем только первую ошибку подряд, чтобы не забивать память телефона логами.
    logFailure(error);
    failedInARow += 1;
    nextDelay = Math.min(MAX_BACKOFF_MS, config.syncIntervalMs * 2 ** Math.min(failedInARow, 3));
  } finally {
    syncing = false;
    scheduleSync(nextDelay);
  }
}

console.log(`[agent] запущен: ${config.platform}, интервал ${config.syncIntervalMs / 1000} с`);
void sync();
