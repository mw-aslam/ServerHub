import { errorJson, json, readJson, requireSession, serverError } from '@/lib/api';
import { rpc } from '@/lib/db';
import { addProjectSchema } from '@/lib/schemas';
import { encryptEnv } from '@/lib/secrets';

export const dynamic = 'force-dynamic';

type EnqueueResult = { ok: true; id: string } | { ok: false; error: string };

const ERRORS: Record<string, { message: string; status: number }> = {
  no_data: { message: 'Агент ещё не присылал данные', status: 409 },
  offline: { message: 'Сервер оффлайн, команда не будет выполнена', status: 409 },
  project_exists: { message: 'Проект с таким именем уже есть', status: 409 },
  duplicate: { message: 'Этот проект уже добавляется', status: 409 },
};

export async function POST(request: Request) {
  try {
    const denied = await requireSession();
    if (denied) return denied;

    // Подробности ошибки проверки не пишем в лог: в них могут быть данные формы.
    const parsed = addProjectSchema.safeParse(await readJson(request));
    if (!parsed.success) return errorJson('Проверьте адрес, имя проекта и переменные .env', 400);

    const { serverId, name, repoUrl, startCommand, env } = parsed.data;
    const result = await rpc<EnqueueResult>('enqueue_add_project', {
      p_server_id: serverId,
      p_project: name,
      p_payload: { repoUrl, startCommand },
      p_secret_env: env.length > 0 ? encryptEnv(env) : null,
    });

    if (!result.ok) {
      const known = ERRORS[result.error] ?? { message: 'Не удалось добавить проект', status: 500 };
      return errorJson(known.message, known.status);
    }
    return json({ id: result.id }, 201);
  } catch (error) {
    return serverError('projects', error);
  }
}
