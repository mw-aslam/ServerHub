import { env } from './env';

// Прямой вызов PostgREST вместо supabase-js: меньше кода в функции
// и меньше расход Active CPU на Vercel. Вся логика лежит в SQL-функциях.
export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const key = env.supabaseServiceKey;
  const headers: Record<string, string> = {
    apikey: key,
    'Content-Type': 'application/json',
  };
  // Старый service_role — это JWT. Новые ключи sb_secret_ передаются только в apikey.
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;

  const response = await fetch(`${env.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${name}: ${response.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}
