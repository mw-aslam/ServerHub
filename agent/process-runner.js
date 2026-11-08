'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');

const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function childEnv() {
  const env = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
  delete env.AGENT_KEY;
  return env;
}

// Единственная точка запуска внешних программ. shell всегда выключен,
// поэтому аргументы передаются как есть и не интерпретируются.
function runProcess(file, args, options = {}) {
  const { cwd, timeoutMs = 60_000, maxBuffer = 16 * 1024 * 1024 } = options;
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd, timeout: timeoutMs, maxBuffer, shell: false, env: childEnv(), windowsHide: true },
      (error, stdout, stderr) => {
        const out = String(stdout || '').replace(ANSI_PATTERN, '');
        const err = String(stderr || '').replace(ANSI_PATTERN, '');
        resolve({
          ok: !error,
          code: error ? error.code : 0,
          timedOut: Boolean(error && error.killed),
          stdout: out,
          stderr: err,
          errorMessage: error ? error.message : '',
        });
      },
    );
  });
}

// В Windows pm2 и npm — это .cmd-файлы, а их нельзя запустить без shell.
// Поэтому запускаем их JS-точку входа напрямую через node.
function resolveTool(tool, { platform, pm2Script, env = process.env, execPath = process.execPath }) {
  if (platform === 'windows' && tool === 'pm2') {
    const script =
      pm2Script || path.win32.join(env.APPDATA || '', 'npm', 'node_modules', 'pm2', 'bin', 'pm2');
    return { file: execPath, prefix: [script] };
  }
  if (platform === 'windows' && tool === 'npm') {
    const script = path.win32.join(
      path.win32.dirname(execPath),
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js',
    );
    return { file: execPath, prefix: [script] };
  }
  return { file: tool, prefix: [] };
}

function createToolRunner(options, runFile = runProcess) {
  return (tool, args, runOptions) => {
    const { file, prefix } = resolveTool(tool, options);
    return runFile(file, [...prefix, ...args], runOptions);
  };
}

module.exports = { runProcess, resolveTool, createToolRunner };
