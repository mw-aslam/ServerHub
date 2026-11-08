import { errorJson, json, requireSession, serverError } from '@/lib/api';
import { rpc } from '@/lib/db';
import { uuidSchema } from '@/lib/schemas';
import type { CommandDetails } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const denied = await requireSession();
    if (denied) return denied;

    const id = uuidSchema.safeParse((await context.params).id);
    if (!id.success) return errorJson('Неверный идентификатор', 400);

    const command = await rpc<CommandDetails | null>('get_command', { p_id: id.data });
    if (!command) return errorJson('Команда не найдена', 404);
    return json(command);
  } catch (error) {
    return serverError('commands/id', error);
  }
}
