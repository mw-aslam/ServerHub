import { errorJson, json, readJson, requireSession, serverError } from '@/lib/api';
import { generateAgentKey, hashAgentKey } from '@/lib/auth';
import { rpc } from '@/lib/db';
import { createServerSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

type CreateResult = { ok: true; id: string } | { ok: false; error: string };

export async function POST(request: Request) {
  try {
    const denied = await requireSession();
    if (denied) return denied;

    const parsed = createServerSchema.safeParse(await readJson(request));
    if (!parsed.success) return errorJson('Укажите название до 60 символов', 400);

    // Ключ существует в открытом виде только в этом ответе.
    const agentKey = generateAgentKey();
    const result = await rpc<CreateResult>('create_server', {
      p_name: parsed.data.name,
      p_key_hash: hashAgentKey(agentKey),
    });

    if (!result.ok) return errorJson('Сервер с таким названием уже есть', 409);
    return json({ id: result.id, name: parsed.data.name, agentKey }, 201);
  } catch (error) {
    return serverError('servers', error);
  }
}
