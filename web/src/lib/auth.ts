import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { env } from './env';
import { uuidSchema } from './schemas';

export const SESSION_COOKIE = 'serverhub_session';
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7;

function sign(payload: string): string {
  return createHmac('sha256', env.sessionSecret).update(payload).digest('base64url');
}

// Хэши одинаковой длины: сравнение не выдаёт длину секрета по времени ответа.
export function safeEqual(a: string, b: string): boolean {
  const first = createHash('sha256').update(a).digest();
  const second = createHash('sha256').update(b).digest();
  return timingSafeEqual(first, second);
}

export function createSessionToken(): string {
  const expires = String(Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC);
  return `${expires}.${sign(expires)}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const [expires, signature, extra] = token.split('.');
  if (!expires || !signature || extra !== undefined) return false;
  if (!safeEqual(signature, sign(expires))) return false;
  const expiresAt = Number(expires);
  return Number.isFinite(expiresAt) && expiresAt > Date.now() / 1000;
}

export async function hasSession(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

export function generateAgentKey(): string {
  return `shk_${randomBytes(32).toString('base64url')}`;
}

// У ключа 256 бит случайности, поэтому SHA-256 достаточно: подбор невозможен,
// а медленный хэш расходовал бы лимит CPU при каждом запросе агента.
export function hashAgentKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export interface AgentCredentials {
  serverId: string;
  keyHash: string;
}

export function agentCredentials(request: Request): AgentCredentials | null {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return null;
  const key = header.slice('Bearer '.length);
  if (!key) return null;
  const serverId = uuidSchema.safeParse(request.headers.get('x-server-id'));
  if (!serverId.success) return null;
  return { serverId: serverId.data, keyHash: hashAgentKey(key) };
}

// На Vercel эти заголовки выставляет платформа, клиент не может их подменить.
export function loginAttemptKey(request: Request): string {
  const ip =
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  return createHmac('sha256', env.sessionSecret).update(ip).digest('hex');
}
