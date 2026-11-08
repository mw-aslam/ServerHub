import { errorJson, json, readJson, serverError } from '@/lib/api';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  createSessionToken,
  loginAttemptKey,
  safeEqual,
} from '@/lib/auth';
import { rpc } from '@/lib/db';
import { env } from '@/lib/env';
import { loginSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const parsed = loginSchema.safeParse(await readJson(request));
    if (!parsed.success) return errorJson('Введите пароль', 400);

    // Попытка учитывается до проверки пароля, поэтому параллельные запросы
    // не могут обойти ограничение.
    const key = loginAttemptKey(request);
    const retryAfter = await rpc<number>('consume_login_attempt', { p_key: key });
    if (retryAfter > 0) {
      const minutes = Math.ceil(retryAfter / 60);
      return errorJson(`Слишком много попыток. Повторите через ${minutes} мин.`, 429);
    }

    if (!safeEqual(parsed.data.password, env.adminPassword)) {
      return errorJson('Неверный пароль', 401);
    }

    await rpc('reset_login_attempts', { p_key: key });

    const response = json({ ok: true });
    response.cookies.set(SESSION_COOKIE, createSessionToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SEC,
    });
    return response;
  } catch (error) {
    return serverError('auth/login', error);
  }
}
