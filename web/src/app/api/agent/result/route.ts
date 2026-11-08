import { errorJson, json, readJson, serverError, unauthorized } from '@/lib/api';
import { agentCredentials } from '@/lib/auth';
import { rpc } from '@/lib/db';
import { commandResultSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const credentials = agentCredentials(request);
    if (!credentials) return unauthorized();

    const parsed = commandResultSchema.safeParse(await readJson(request));
    if (!parsed.success) return errorJson('Неверный формат результата', 400);

    const updated = await rpc<boolean | null>('agent_finish_command', {
      p_server_id: credentials.serverId,
      p_key_hash: credentials.keyHash,
      p_id: parsed.data.id,
      p_status: parsed.data.status,
      p_output: parsed.data.output,
    });
    if (updated === null) return unauthorized();

    return json({ ok: true, updated });
  } catch (error) {
    return serverError('agent/result', error);
  }
}
