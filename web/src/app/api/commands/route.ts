import { errorJson, json, readJson, requireSession, serverError } from '@/lib/api';
import { rpc } from '@/lib/db';
import { commandRequestSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

type EnqueueResult = { ok: true; id: string } | { ok: false; error: string };

const ERRORS: Record<string, { message: string; status: number }> = {
  no_data: { message: 'Агент ещё не присылал данные', status: 409 },
  offline: { message: 'Сервер оффлайн, команда не будет выполнена', status: 409 },
  unknown_project: { message: 'Такого проекта нет в pm2', status: 404 },
  protected: { message: 'Агента нельзя остановить из панели', status: 403 },
  duplicate: { message: 'Такая команда уже выполняется', status: 409 },
};

export async function POST(request: Request) {
  try {
    const denied = await requireSession();
    if (denied) return denied;

    const parsed = commandRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) return errorJson('Неверная команда', 400);

    const result = await rpc<EnqueueResult>('enqueue_command', {
      p_server_id: parsed.data.serverId,
      p_action: parsed.data.action,
      p_project: parsed.data.project,
    });

    if (!result.ok) {
      const known = ERRORS[result.error] ?? { message: 'Не удалось поставить команду', status: 500 };
      return errorJson(known.message, known.status);
    }
    return json({ id: result.id }, 201);
  } catch (error) {
    return serverError('commands', error);
  }
}
