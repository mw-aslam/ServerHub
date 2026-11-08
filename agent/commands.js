'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAddProjectRunner } = require('./add-project');
const { formatStep, trimOutput, MAX_OUTPUT_CHARS } = require('./output');

const MAX_COMMAND_AGE_MS = 60_000;
const ALLOWED_ACTIONS = new Set(['start', 'stop', 'restart', 'update', 'logs', 'add_project']);

function isExpired(ageMs) {
  return !Number.isFinite(ageMs) || ageMs > MAX_COMMAND_AGE_MS;
}

// pm2 трактует "all" как все проекты, а число как id процесса,
// имя с дефисом в начале он прочитает как флаг.
function hasAmbiguousName(name) {
  return name === 'all' || /^\d+$/.test(name) || name.startsWith('-');
}

function createExecutor({
  run,
  listProcesses,
  agentName,
  pathExists = fs.existsSync,
  projectsRoot = path.join(os.homedir(), 'projects'),
  npmEntry = 'npm',
  projectFiles,
}) {
  const fail = (output) => ({ status: 'error', output });
  const addProject = createAddProjectRunner({
    run,
    listProcesses,
    projectsRoot,
    npmEntry,
    files: projectFiles,
  });

  async function pm2Action(args) {
    const result = await run('pm2', args, { timeoutMs: 60_000 });
    return {
      status: result.ok ? 'success' : 'error',
      output: trimOutput(formatStep(`pm2 ${args.join(' ')}`, result)),
    };
  }

  async function runUpdate(project, isSelf) {
    if (!project.cwd || !pathExists(project.cwd)) {
      return fail(`Не найдена папка проекта: ${project.cwd || 'не указана в pm2'}`);
    }

    const steps = [{ file: 'git', args: ['pull', '--ff-only'], timeoutMs: 120_000 }];
    if (pathExists(path.join(project.cwd, 'package.json'))) {
      steps.push({ file: 'npm', args: ['install', '--no-audit', '--no-fund'], timeoutMs: 600_000 });
    }

    const log = [];
    for (const step of steps) {
      const result = await run(step.file, step.args, { cwd: project.cwd, timeoutMs: step.timeoutMs });
      log.push(formatStep(`${step.file} ${step.args.join(' ')}`, result));
      if (!result.ok) return fail(trimOutput(log.join('\n\n')));
    }

    if (isSelf) return selfRestart(trimOutput(`${log.join('\n\n')}\n\nАгент перезапускается.`));

    const restart = await pm2Action(['restart', project.name]);
    log.push(restart.output);
    return { status: restart.status, output: trimOutput(log.join('\n\n')) };
  }

  // Сначала отправляем результат, потом перезапускаем себя:
  // после перезапуска отправить его будет некому.
  function selfRestart(output) {
    return {
      status: 'success',
      output,
      afterReport: () => run('pm2', ['restart', agentName], { timeoutMs: 60_000 }),
    };
  }

  async function execute(command) {
    const { action, project: name } = command;

    if (!ALLOWED_ACTIONS.has(action)) return fail('Действие не входит в белый список');
    if (action === 'add_project') return addProject(command);
    if (typeof name !== 'string' || !name) return fail('Не указано имя проекта');
    if (hasAmbiguousName(name)) return fail(`Имя "${name}" нельзя использовать в команде pm2`);

    let processes;
    try {
      processes = await listProcesses();
    } catch (error) {
      return fail(error.message);
    }

    const project = processes.find((item) => item.name === name);
    if (!project) return fail(`Проекта "${name}" нет в pm2 jlist`);
    const isSelf = name === agentName;

    switch (action) {
      case 'start':
        return pm2Action(['start', name]);
      case 'stop':
        if (isSelf) return fail('Агента нельзя остановить из панели: пропадёт удалённое управление');
        return pm2Action(['stop', name]);
      case 'restart':
        if (isSelf) return selfRestart('Агент перезапускается.');
        return pm2Action(['restart', name]);
      case 'update':
        return runUpdate(project, isSelf);
      case 'logs':
        return pm2Action(['logs', name, '--lines', '100', '--nostream']);
      default:
        return fail('Действие не входит в белый список');
    }
  }

  return { execute };
}

module.exports = { createExecutor, isExpired, trimOutput, MAX_COMMAND_AGE_MS, MAX_OUTPUT_CHARS };
