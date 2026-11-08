import { CircleCheck, CircleX, Clock3, LoaderCircle, TimerOff } from 'lucide-react';
import { ACTION_LABELS, COMMAND_STATUS_LABELS, formatDateTime } from '@/lib/format';
import type { CommandRow, CommandStatus } from '@/lib/types';

const STATUS_ICONS: Record<CommandStatus, React.ReactNode> = {
  pending: <Clock3 className="size-4 text-muted" aria-hidden />,
  running: <LoaderCircle className="size-4 animate-spin text-accent" aria-hidden />,
  success: <CircleCheck className="size-4 text-good" aria-hidden />,
  error: <CircleX className="size-4 text-crit" aria-hidden />,
  expired: <TimerOff className="size-4 text-warn" aria-hidden />,
};

export function CommandHistory({ commands }: { commands: CommandRow[] }) {
  return (
    <section
      aria-labelledby="commands-title"
      className="animate-rise rounded-2xl border border-line bg-surface p-4 sm:p-5"
    >
      <h2 id="commands-title" className="mb-3 text-base font-semibold">
        История команд
      </h2>

      {commands.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Команд пока не было</p>
      ) : (
        <ul className="max-h-96 divide-y divide-line overflow-y-auto">
          {commands.map((command) => {
            const row = (
              <div className="flex items-center gap-3 py-2.5">
                {STATUS_ICONS[command.status]}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {ACTION_LABELS[command.action]}{' '}
                    <span className="text-ink-2">{command.project}</span>
                  </p>
                  <p className="text-xs text-muted">{formatDateTime(command.created_at)}</p>
                </div>
                <span className="shrink-0 text-xs text-ink-2">
                  {COMMAND_STATUS_LABELS[command.status]}
                </span>
              </div>
            );

            const hasDetails =
              command.action !== 'logs' &&
              Boolean(command.output_preview) &&
              command.status !== 'pending' &&
              command.status !== 'running';

            return (
              <li key={command.id}>
                {hasDetails ? (
                  <details>
                    <summary className="cursor-pointer list-none rounded-md transition-colors hover:bg-raised/50">
                      {row}
                    </summary>
                    <pre className="mb-2 max-h-48 overflow-auto rounded-lg bg-page p-3 font-mono text-xs whitespace-pre-wrap break-words text-ink-2">
                      {command.output_preview}
                    </pre>
                  </details>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
