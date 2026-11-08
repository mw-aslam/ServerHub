// Vercel сам задаёт эту переменную: по ней видно, какой коммит сейчас в production.
export function appVersion(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local';
}
