import { json } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const response = json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
