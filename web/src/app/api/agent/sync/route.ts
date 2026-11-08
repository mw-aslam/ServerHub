import { errorJson, json, readJson, serverError, unauthorized } from '@/lib/api';
import { agentCredentials } from '@/lib/auth';
import { rpc } from '@/lib/db';
import { snapshotSchema } from '@/lib/schemas';
import { decryptEnv } from '@/lib/secrets';

export const dynamic = 'force-dynamic';

// При одном сервере с интервалом 10 с это примерно раз в час. Запасной путь
// на случай, если расширение pg_cron в базе недоступно.
const CLEANUP_PROBABILITY = 1 / 360;

interface ClaimedCommand {
  secret_env?: string | null;
  [field: string]: unknown;
}

// Шифротекст остаётся на сервере, агент получает значения только по HTTPS.
function revealEnv({ secret_env: secretEnv, ...command }: ClaimedCommand) {
  if (!secretEnv) return command;
  try {
    return { ...command, env: decryptEnv(secretEnv) };
  } catch {
    return { ...command, envError: true };
  }
}

export async function POST(request: Request) {
  try {
    const credentials = agentCredentials(request);
    if (!credentials) return unauthorized();

    const parsed = snapshotSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      console.error('[agent/sync] неверные данные', parsed.error.issues.slice(0, 5));
      return errorJson('Неверный формат метрик', 400);
    }

    // Ключ проверяется внутри этого же вызова, чтобы не тратить второй запрос к базе.
    const result = await rpc<{ authorized: boolean; commands?: ClaimedCommand[] }>('agent_sync', {
      p_server_id: credentials.serverId,
      p_key_hash: credentials.keyHash,
      p_snapshot: parsed.data,
      p_limit: 5,
    });
    if (!result.authorized) return unauthorized();

    if (Math.random() < CLEANUP_PROBABILITY) {
      await rpc('cleanup_old_data').catch((error) => console.error('[cleanup]', error));
    }

    return json({ commands: (result.commands ?? []).map(revealEnv) });
  } catch (error) {
    return serverError('agent/sync', error);
  }
}
