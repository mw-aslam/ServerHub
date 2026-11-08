'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { formatStep, trimOutput } = require('./output');

// Сервер уже проверил эти значения, но агент не должен ему доверять.
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const REPO_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}\/?$/;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
const START_COMMANDS = new Set(['npm start', 'node index.js']);
const RESERVED_NAMES = new Set(['all', 'con', 'prn', 'aux', 'nul']);
const MAX_ENV_ENTRIES = 50;
const MAX_ENV_VALUE = 4096;
// Значения короче не похожи на секреты, а их замена исказила бы весь вывод.
const MIN_REDACTED_LENGTH = 4;

const defaultFiles = {
  exists: fs.existsSync,
  mkdir: (dir) => fsp.mkdir(dir, { recursive: true }),
  remove: (dir) => fsp.rm(dir, { recursive: true, force: true, maxRetries: 3 }),
  // Флаг wx не даст записать файл поверх символической ссылки из репозитория.
  writeSecret: (file, content) => fsp.writeFile(file, content, { flag: 'wx', mode: 0o600 }),
};

function isValidName(name) {
  return (
    typeof name === 'string' &&
    NAME_PATTERN.test(name) &&
    !/^\d+$/.test(name) &&
    !RESERVED_NAMES.has(name.toLowerCase())
  );
}

function isValidRepoUrl(url) {
  if (typeof url !== 'string' || !REPO_PATTERN.test(url)) return false;
  const repo = url.replace(/\/$/, '').split('/').pop();
  return repo !== '.git' && !repo.startsWith('.') && !repo.includes('..');
}

function validateEnv(entries) {
  if (entries === undefined || entries === null) return { entries: [] };
  if (!Array.isArray(entries) || entries.length > MAX_ENV_ENTRIES) {
    return { error: 'Неверный список переменных .env' };
  }
  const seen = new Set();
  for (const entry of entries) {
    if (typeof entry?.key !== 'string' || !ENV_KEY_PATTERN.test(entry.key)) {
      return { error: 'Неверное имя переменной .env' };
    }
    if (typeof entry.value !== 'string' || entry.value.length > MAX_ENV_VALUE) {
      return { error: `Неверное значение переменной ${entry.key}` };
    }
    if (/[\r\n\0]/.test(entry.value)) {
      return { error: `Значение ${entry.key} не может содержать перенос строки` };
    }
    if (seen.has(entry.key)) return { error: `Переменная ${entry.key} указана дважды` };
    seen.add(entry.key);
  }
  return { entries };
}

function validateAddProject(command) {
  if (command.envError) return { error: 'Не удалось расшифровать переменные .env на сервере' };
  if (!isValidName(command.project)) return { error: 'Недопустимое имя проекта' };
  const repoUrl = command.payload?.repoUrl;
  const startCommand = command.payload?.startCommand;
  if (!isValidRepoUrl(repoUrl)) return { error: 'Разрешены только адреса https://github.com/...' };
  if (!START_COMMANDS.has(startCommand)) return { error: 'Команда запуска не входит в список' };
  const env = validateEnv(command.env);
  if (env.error) return { error: env.error };
  return { name: command.project, repoUrl, startCommand, env: env.entries };
}

function formatEnvLine({ key, value }) {
  if (/^[^\s#'"`=]*$/.test(value)) return { line: `${key}=${value}` };
  const quote = ['"', "'", '`'].find((candidate) => !value.includes(candidate));
  if (!quote) return { error: `Значение ${key} содержит все виды кавычек` };
  return { line: `${key}=${quote}${value}${quote}` };
}

function formatEnvFile(entries) {
  const lines = [];
  for (const entry of entries) {
    const formatted = formatEnvLine(entry);
    if (formatted.error) return formatted;
    lines.push(formatted.line);
  }
  return { content: `${lines.join('\n')}\n` };
}

function redact(text, entries) {
  const secrets = entries
    .map((entry) => entry.value)
    .filter((value) => value.length >= MIN_REDACTED_LENGTH)
    .sort((a, b) => b.length - a.length);
  return secrets.reduce((result, secret) => result.split(secret).join('***'), text);
}

function pm2StartArgs(startCommand, name, dir, npmEntry) {
  const options = ['--name', name, '--cwd', dir];
  if (startCommand === 'npm start') return ['start', npmEntry, ...options, '--', 'start'];
  return ['start', 'index.js', ...options];
}

function createAddProjectRunner({ run, listProcesses, projectsRoot, npmEntry, files = defaultFiles }) {
  return async function addProject(command) {
    const spec = validateAddProject(command);
    if (spec.error) return { status: 'error', output: spec.error };
    const { name, repoUrl, startCommand, env } = spec;

    const processes = await listProcesses().catch(() => null);
    if (!processes) return { status: 'error', output: 'Не удалось получить список проектов из pm2' };
    if (processes.some((item) => item.name === name)) {
      return { status: 'error', output: `Проект "${name}" уже есть в pm2` };
    }

    const dir = path.join(projectsRoot, name);
    if (files.exists(dir)) return { status: 'error', output: `Папка уже существует: ${dir}` };

    const log = [];
    const finish = (status) => ({ status, output: trimOutput(redact(log.join('\n\n'), env)) });
    const step = async (tool, args, options) => {
      const result = await run(tool, args, options);
      log.push(formatStep(`${tool} ${args.join(' ')}`, result));
      return result.ok;
    };

    // Папка создана этой командой, поэтому при ошибке её безопасно удалить.
    const abort = async (reason) => {
      if (reason) log.push(`Ошибка: ${reason}`);
      await files
        .remove(dir)
        .then(() => log.push('Папка проекта удалена.'))
        .catch(() => log.push(`Не удалось удалить папку: ${dir}`));
      return finish('error');
    };

    await files.mkdir(projectsRoot);

    const cloned = await step('git', ['clone', '--depth', '1', '--', repoUrl, dir], {
      cwd: projectsRoot,
      timeoutMs: 180_000,
    });
    if (!cloned) return abort();

    const hasPackage = files.exists(path.join(dir, 'package.json'));
    if (startCommand === 'npm start' && !hasPackage) return abort('в репозитории нет package.json');
    if (startCommand === 'node index.js' && !files.exists(path.join(dir, 'index.js'))) {
      return abort('в репозитории нет index.js');
    }

    if (env.length > 0) {
      const envFile = formatEnvFile(env);
      if (envFile.error) return abort(envFile.error);
      try {
        await files.writeSecret(path.join(dir, '.env'), envFile.content);
        log.push(`Файл .env создан, переменных: ${env.length}.`);
      } catch (error) {
        return abort(error.code === 'EEXIST' ? 'в репозитории уже есть файл .env' : 'не удалось записать .env');
      }
    }

    if (hasPackage) {
      const installed = await step('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: dir,
        timeoutMs: 600_000,
      });
      if (!installed) return abort();
    }

    const started = await step('pm2', pm2StartArgs(startCommand, name, dir, npmEntry), {
      cwd: dir,
      timeoutMs: 60_000,
    });
    if (!started) return abort();

    const saved = await step('pm2', ['save'], { timeoutMs: 30_000 });
    if (!saved) log.push('Проект запущен, но pm2 save не сработал: после перезагрузки он не запустится.');
    return finish('success');
  };
}

module.exports = {
  createAddProjectRunner,
  validateAddProject,
  isValidName,
  isValidRepoUrl,
  formatEnvFile,
  redact,
  pm2StartArgs,
};
