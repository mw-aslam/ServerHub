// Правила без zod: этот файл используется и в браузере, и на сервере.

const PROJECT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const GITHUB_URL_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}\/?$/;
const RESERVED_PROJECT_NAMES = new Set(['all', 'con', 'prn', 'aux', 'nul']);

export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
export const START_COMMANDS = ['npm start', 'node index.js'] as const;

export function isValidProjectName(name: string): boolean {
  return (
    PROJECT_NAME_PATTERN.test(name) &&
    !/^\d+$/.test(name) &&
    !RESERVED_PROJECT_NAMES.has(name.toLowerCase())
  );
}

export function isValidGithubUrl(url: string): boolean {
  if (!GITHUB_URL_PATTERN.test(url)) return false;
  const repo = url.replace(/\/$/, '').split('/').pop() ?? '';
  return !repo.startsWith('.') && !repo.includes('..');
}
