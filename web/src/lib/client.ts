import type { CommandAction, CommandDetails } from './types';

export type EnqueueOutcome = { ok: true; id: string } | { ok: false; message: string };

export type CreateServerOutcome =
  | { ok: true; id: string; name: string; agentKey: string }
  | { ok: false; message: string };

function redirectToLogin() {
  window.location.assign('/login');
}

export async function enqueueCommand(
  serverId: string,
  action: CommandAction,
  project: string,
): Promise<EnqueueOutcome> {
  try {
    const response = await fetch('/api/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId, action, project }),
    });
    if (response.status === 401) {
      redirectToLogin();
      return { ok: false, message: 'Требуется вход' };
    }
    const body = await response.json();
    if (!response.ok) return { ok: false, message: body.error ?? 'Не удалось отправить команду' };
    return { ok: true, id: body.id };
  } catch {
    return { ok: false, message: 'Нет связи с панелью' };
  }
}

export async function createServer(name: string): Promise<CreateServerOutcome> {
  try {
    const response = await fetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (response.status === 401) {
      redirectToLogin();
      return { ok: false, message: 'Требуется вход' };
    }
    const body = await response.json();
    if (!response.ok) return { ok: false, message: body.error ?? 'Не удалось добавить сервер' };
    return { ok: true, id: body.id, name: body.name, agentKey: body.agentKey };
  } catch {
    return { ok: false, message: 'Нет связи с панелью' };
  }
}

export async function fetchCommand(id: string): Promise<CommandDetails | null> {
  const response = await fetch(`/api/commands/${id}`, { cache: 'no-store' });
  if (response.status === 401) {
    redirectToLogin();
    return null;
  }
  return response.ok ? response.json() : null;
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
  redirectToLogin();
}
