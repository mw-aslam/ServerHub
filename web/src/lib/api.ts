import { NextResponse } from 'next/server';
import { hasSession } from './auth';

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function errorJson(message: string, status: number): NextResponse {
  return json({ error: message }, status);
}

export function unauthorized(): NextResponse {
  return errorJson('Требуется вход', 401);
}

export function serverError(route: string, error: unknown): NextResponse {
  console.error(`[${route}]`, error);
  return errorJson('Внутренняя ошибка сервера', 500);
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<NextResponse | null> {
  return (await hasSession()) ? null : unauthorized();
}
