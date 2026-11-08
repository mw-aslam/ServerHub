'use client';

import {
  CircleCheck,
  CircleDashed,
  CircleStop,
  CircleX,
  Download,
  LoaderCircle,
  type LucideIcon,
  Play,
  Plus,
  RotateCw,
  ScrollText,
  Square,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { formatMb, formatUptime } from '@/lib/format';
import type { CommandAction, ProcessInfo } from '@/lib/types';

function StatusBadge({ status }: { status: string }) {
  let icon = <CircleDashed className="size-3.5 text-warn" aria-hidden />;
  if (status === 'online') icon = <CircleCheck className="size-3.5 text-good" aria-hidden />;
  if (status === 'stopped') icon = <CircleStop className="size-3.5 text-muted" aria-hidden />;
  if (status === 'errored') icon = <CircleX className="size-3.5 text-crit" aria-hidden />;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-0.5 text-xs text-ink">
      {icon}
      {status}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-ink">{value}</dd>
    </div>
  );
}

interface ActionButtonProps {
  label: string;
  icon: LucideIcon;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}

function ActionButton({ label, icon: Icon, busy, disabled, onClick }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-raised hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {busy ? (
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Icon className="size-3.5" aria-hidden />
      )}
      {label}
    </button>
  );
}

function ProjectCard({
  project,
  online,
  isBusy,
  onAction,
  onLogs,
}: {
  project: ProcessInfo;
  online: boolean;
  isBusy: (action: CommandAction, project: string) => boolean;
  onAction: (action: CommandAction, project: ProcessInfo) => void;
  onLogs: (project: string) => void;
}) {
  const running = project.status === 'online';

  const button = (action: CommandAction, label: string, icon: LucideIcon) => (
    <ActionButton
      label={label}
      icon={icon}
      busy={isBusy(action, project.name)}
      disabled={!online}
      onClick={() => onAction(action, project)}
    />
  );

  return (
    <article className="animate-rise flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium" title={project.name}>
            {project.name}
          </h3>
          {project.isAgent && <p className="mt-0.5 text-xs text-muted">Агент ServerHub</p>}
        </div>
        <StatusBadge status={project.status} />
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-x-3 gap-y-3">
        <Stat label="CPU" value={`${project.cpu.toFixed(1)}%`} />
        <Stat label="Память" value={formatMb(project.memoryMb)} />
        <Stat label="Аптайм" value={running ? formatUptime(project.uptimeSec) : '—'} />
        <Stat label="Перезапуски" value={project.restarts} />
        <Stat label="PID" value={project.pid ?? '—'} />
      </dl>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        {running ? button('restart', 'Перезапустить', RotateCw) : button('start', 'Старт', Play)}
        {running && !project.isAgent && button('stop', 'Стоп', Square)}
        {button('update', 'Обновить из GitHub', Download)}
        <ActionButton
          label="Логи"
          icon={ScrollText}
          busy={false}
          disabled={!online}
          onClick={() => onLogs(project.name)}
        />
      </div>
    </article>
  );
}

export function Projects({
  projects,
  pm2Available,
  online,
  isBusy,
  onAction,
  onLogs,
  onAddProject,
}: {
  projects: ProcessInfo[];
  pm2Available: boolean;
  online: boolean;
  isBusy: (action: CommandAction, project: string) => boolean;
  onAction: (action: CommandAction, project: ProcessInfo) => void;
  onLogs: (project: string) => void;
  onAddProject: () => void;
}) {
  return (
    <section aria-labelledby="projects-title">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 id="projects-title" className="text-base font-semibold">
          Проекты
          <span className="ml-2 font-normal text-muted">{projects.length}</span>
        </h2>
        <button
          type="button"
          onClick={onAddProject}
          disabled={!online}
          title={online ? undefined : 'Сервер оффлайн'}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="size-4" aria-hidden />
          Добавить проект
        </button>
      </div>

      {projects.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-ink-2">
          {pm2Available
            ? 'В pm2 пока нет проектов.'
            : 'Агент не смог получить список из pm2. Проверьте, что pm2 установлен и запущен.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.name}
              project={project}
              online={online}
              isBusy={isBusy}
              onAction={onAction}
              onLogs={onLogs}
            />
          ))}
        </div>
      )}
    </section>
  );
}
