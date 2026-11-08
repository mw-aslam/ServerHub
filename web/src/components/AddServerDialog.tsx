'use client';

import { Check, Copy, LoaderCircle, TriangleAlert } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { createServer } from '@/lib/client';

interface CreatedServer {
  id: string;
  name: string;
  agentKey: string;
}

export function AddServerDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<CreatedServer | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await createServer(name);
    setBusy(false);
    if (result.ok) setCreated(result);
    else setError(result.message);
  };

  const envText = created
    ? `BACKEND_URL=${window.location.origin}\nSERVER_ID=${created.id}\nAGENT_KEY=${created.agentKey}`
    : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(envText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="add-server-title"
      onCancel={(event) => {
        // Ключ больше нигде не показать, поэтому случайно закрыть окно нельзя.
        if (created) event.preventDefault();
        else onClose();
      }}
      className="animate-rise m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-line-strong bg-surface p-0 text-ink"
    >
      {!created ? (
        <form onSubmit={submit} className="p-6">
          <h2 id="add-server-title" className="font-semibold">
            Добавить сервер
          </h2>
          <label htmlFor="server-name" className="mt-4 mb-2 block text-sm text-ink-2">
            Название
          </label>
          <input
            id="server-name"
            autoFocus
            required
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Например, Телефон или VPS"
            className="w-full rounded-lg border border-line-strong bg-page px-3 py-2.5 text-base outline-none transition-colors placeholder:text-muted focus:border-accent"
          />
          {error && (
            <p role="alert" className="mt-3 text-sm text-serious">
              {error}
            </p>
          )}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line-strong px-4 py-2 text-sm transition-colors hover:bg-raised"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
              Создать ключ
            </button>
          </div>
        </form>
      ) : (
        <div className="p-6">
          <h2 id="add-server-title" className="break-words font-semibold">
            Сервер «{created.name}» создан
          </h2>

          <div className="mt-4 flex gap-3 rounded-xl border border-warn/40 bg-warn/10 p-3.5">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
            <p className="text-sm">
              Ключ показывается только один раз. В базе хранится лишь его хэш, восстановить ключ
              будет невозможно.
            </p>
          </div>

          <p className="mt-4 text-sm text-ink-2">Добавьте эти строки в файл agent/.env:</p>
          <pre
            data-testid="agent-env"
            className="mt-2 rounded-lg bg-page p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-ink"
          >
            {envText}
          </pre>

          <button
            type="button"
            onClick={() => void copy()}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-line-strong px-3 py-1.5 text-sm transition-colors hover:bg-raised"
          >
            {copied ? (
              <Check className="size-4 text-good" aria-hidden />
            ) : (
              <Copy className="size-4" aria-hidden />
            )}
            {copied ? 'Скопировано' : 'Копировать'}
          </button>
          {copied === false && (
            <p role="alert" className="mt-2 text-sm text-serious">
              Браузер не дал доступ к буферу обмена. Выделите текст и скопируйте вручную.
            </p>
          )}

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={() => onCreated(created.id)}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Я сохранил ключ
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
