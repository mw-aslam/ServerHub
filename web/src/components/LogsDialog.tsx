'use client';

import { LoaderCircle, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { enqueueCommand, fetchCommand } from '@/lib/client';

const POLL_INTERVAL_MS = 2000;
const POLL_LIMIT_MS = 90_000;
const LONG_COMMAND_LIMIT_MS = 20 * 60_000;

type LogsState =
  | { phase: 'loading' }
  | { phase: 'done'; output: string }
  | { phase: 'failed'; message: string };

export function LogsDialog({
  serverId,
  project,
  commandId,
  title,
  onClose,
}: {
  serverId: string;
  project: string;
  // Если задан, окно показывает вывод этой команды и не запрашивает логи заново.
  commandId?: string;
  title?: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const mounted = useRef(false);
  const started = useRef(false);
  const [state, setState] = useState<LogsState>({ phase: 'loading' });

  const load = useCallback(async () => {
    setState({ phase: 'loading' });

    let id = commandId;
    if (!id) {
      const queued = await enqueueCommand(serverId, 'logs', project);
      if (!queued.ok) {
        if (mounted.current) setState({ phase: 'failed', message: queued.message });
        return;
      }
      id = queued.id;
    }

    const deadline = Date.now() + (commandId ? LONG_COMMAND_LIMIT_MS : POLL_LIMIT_MS);
    while (mounted.current && Date.now() < deadline) {
      const command = await fetchCommand(id).catch(() => null);
      if (!mounted.current) return;

      if (command?.status === 'success') {
        setState({ phase: 'done', output: command.output || 'Вывод пуст.' });
        return;
      }
      if (command?.status === 'error' || command?.status === 'expired') {
        const output = command.output || 'Команда не выполнена';
        // Журнал установки длинный, поэтому показываем его в области с прокруткой.
        setState(commandId ? { phase: 'done', output } : { phase: 'failed', message: output });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    if (mounted.current) setState({ phase: 'failed', message: 'Агент не ответил вовремя' });
  }, [serverId, project, commandId]);

  useEffect(() => {
    mounted.current = true;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // В режиме разработки React запускает эффект дважды, а команда нужна одна.
    if (!started.current) {
      started.current = true;
      void load();
    }
    return () => {
      mounted.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (state.phase === 'done' && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [state]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className="animate-rise m-auto h-[80dvh] w-[calc(100%-2rem)] max-w-4xl rounded-2xl border border-line-strong bg-surface p-0 text-ink"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
          <h2 className="min-w-0 flex-1 truncate font-semibold">{title ?? `Логи: ${project}`}</h2>
          {!commandId && (
            <button
              type="button"
              onClick={() => void load()}
              disabled={state.phase === 'loading'}
              aria-label="Обновить логи"
              className="grid size-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-raised disabled:opacity-40"
            >
              <RefreshCw className="size-4" aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="grid size-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-raised"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        {state.phase === 'loading' && (
          <div className="grid flex-1 place-items-center p-6 text-center text-sm text-ink-2">
            <div>
              <LoaderCircle className="mx-auto mb-3 size-6 animate-spin text-accent" aria-hidden />
              {commandId
                ? 'Клонирование, установка зависимостей и запуск. На телефоне это может занять несколько минут.'
                : 'Ждём ответа от сервера. Обычно это занимает до одного интервала агента.'}
            </div>
          </div>
        )}

        {state.phase === 'failed' && (
          <div className="grid flex-1 place-items-center p-6">
            <p role="alert" className="max-w-lg break-words text-center text-sm text-ink-2">
              {state.message}
            </p>
          </div>
        )}

        {state.phase === 'done' && (
          <pre
            ref={outputRef}
            tabIndex={0}
            className="min-h-0 flex-1 overflow-auto bg-page p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-ink-2 sm:p-5"
          >
            {state.output}
          </pre>
        )}
      </div>
    </dialog>
  );
}
