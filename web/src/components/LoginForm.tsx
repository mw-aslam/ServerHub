'use client';

import { LoaderCircle, Server } from 'lucide-react';
import { type FormEvent, useState } from 'react';

export function LoginForm({ version }: { version: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        window.location.assign('/');
        return;
      }
      const body = await response.json().catch(() => null);
      setError(body?.error ?? 'Не удалось войти');
      setPassword('');
    } catch {
      setError('Нет связи с сервером');
    }
    setBusy(false);
  };

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <form
        onSubmit={submit}
        className="animate-rise w-full max-w-sm rounded-2xl border border-line bg-surface p-6 sm:p-8"
      >
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-accent/15 text-accent">
            <Server className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold">ServerHub</h1>
            <p className="text-sm text-muted">Панель управления серверами</p>
          </div>
        </div>

        <label htmlFor="password" className="mb-2 block text-sm text-ink-2">
          Пароль администратора
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby={error ? 'login-error' : undefined}
          className="w-full rounded-lg border border-line-strong bg-page px-3 py-2.5 text-base outline-none transition-colors focus:border-accent"
        />

        {error && (
          <p id="login-error" role="alert" className="mt-3 text-sm text-serious">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !password}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          Войти
        </button>

        <p className="mt-4 text-center text-xs text-muted">Версия {version}</p>
      </form>
    </main>
  );
}
