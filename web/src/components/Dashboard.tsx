'use client';

import { Plus, RadioTower, ServerCog } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { enqueueCommand } from '@/lib/client';
import { ACTION_LABELS } from '@/lib/format';
import type {
  Alert,
  CommandAction,
  DashboardData,
  HistoryData,
  HistoryRange,
  ProcessInfo,
} from '@/lib/types';
import { AddProjectDialog } from './AddProjectDialog';
import { AddServerDialog } from './AddServerDialog';
import { Alerts } from './Alerts';
import { CapacityCard } from './CapacityCard';
import { CommandHistory } from './CommandHistory';
import { ConfirmDialog } from './ConfirmDialog';
import { Header } from './Header';
import { HistoryCharts } from './HistoryCharts';
import { LogsDialog } from './LogsDialog';
import { Metrics } from './Metrics';
import { Projects } from './Projects';
import { DashboardSkeleton } from './Skeleton';
import { ToastProvider, useToast } from './Toast';

const DASHBOARD_INTERVAL_MS = 3000;
const HISTORY_INTERVAL_MS = 60_000;
const SELECTED_SERVER_KEY = 'serverhub:selected-server';

const PANEL_ALERT: Alert = {
  id: 'panel',
  level: 'warning',
  title: 'Нет связи с панелью',
  detail: 'Показаны последние полученные данные. Повторяем запрос.',
};

const CONFIRM_TEXT: Partial<Record<CommandAction, { title: string; button: string; text: string }>> = {
  restart: {
    title: 'Перезапустить проект?',
    button: 'Перезапустить',
    text: 'Проект будет недоступен несколько секунд.',
  },
  stop: {
    title: 'Остановить проект?',
    button: 'Остановить',
    text: 'Проект перестанет работать, пока вы не запустите его снова.',
  },
  update: {
    title: 'Обновить из GitHub?',
    button: 'Обновить',
    text: 'Агент выполнит git pull и npm install в папке проекта, затем перезапустит его. Это может занять несколько минут.',
  },
};

function readSelectedServer(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(SELECTED_SERVER_KEY);
  } catch {
    return null;
  }
}

function saveSelectedServer(id: string) {
  try {
    window.localStorage.setItem(SELECTED_SERVER_KEY, id);
  } catch {
    // Выбор просто не запомнится между посещениями.
  }
}

function DashboardContent() {
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(readSelectedServer);
  const [range, setRange] = useState<HistoryRange>('1h');
  const [confirming, setConfirming] = useState<{ action: CommandAction; project: ProcessInfo } | null>(null);
  const [logsProject, setLogsProject] = useState<string | null>(null);
  const [addingServer, setAddingServer] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  const [projectOutput, setProjectOutput] = useState<{ id: string; project: string } | null>(null);

  const dashboard = usePolling<DashboardData>(
    selectedId ? `/api/dashboard?server=${selectedId}` : '/api/dashboard',
    DASHBOARD_INTERVAL_MS,
  );
  const { failed, refresh } = dashboard;

  // Пока приходит ответ по новому серверу, нельзя показывать данные и кнопки прежнего.
  const isSwitching =
    dashboard.data !== null &&
    selectedId !== null &&
    dashboard.data.serverId !== selectedId &&
    dashboard.data.servers.some((server) => server.id === selectedId);
  const data = isSwitching ? null : dashboard.data;
  const serverId = data?.serverId ?? null;

  const hourHistory = usePolling<HistoryData>(
    serverId ? `/api/history?server=${serverId}&range=1h` : null,
    HISTORY_INTERVAL_MS,
  );
  const dayHistory = usePolling<HistoryData>(
    serverId && range === '24h' ? `/api/history?server=${serverId}&range=24h` : null,
    HISTORY_INTERVAL_MS,
  );
  const hourData = hourHistory.data?.serverId === serverId ? hourHistory.data : null;
  const dayData = dayHistory.data?.serverId === serverId ? dayHistory.data : null;

  const knownStatuses = useRef<Map<string, string> | null>(null);
  const submittedIds = useRef(new Set<string>());

  useEffect(() => {
    if (!data) return;
    const previous = knownStatuses.current;

    if (previous) {
      for (const command of data.commands) {
        const before = previous.get(command.id);
        const changed = before !== command.status;
        const finished = ['success', 'error', 'expired'].includes(command.status);
        const relevant = before !== undefined || submittedIds.current.has(command.id);
        if (!changed || !finished || !relevant || command.action === 'logs') continue;

        const name = `${ACTION_LABELS[command.action]} ${command.project}`;
        if (command.status === 'success') toast('success', `${name}: выполнено`);
        else if (command.status === 'expired') toast('error', `${name}: агент не успел получить команду`);
        else toast('error', `${name}: ошибка. Подробности в истории команд`);
      }
    }

    knownStatuses.current = new Map(data.commands.map((command) => [command.id, command.status]));
  }, [data, toast]);

  const activeCommands = useMemo(() => {
    const active = new Set<string>();
    for (const command of data?.commands ?? []) {
      if (command.status === 'pending' || command.status === 'running') {
        active.add(`${command.action}:${command.project}`);
      }
    }
    return active;
  }, [data]);

  const isBusy = useCallback(
    (action: CommandAction, project: string) => activeCommands.has(`${action}:${project}`),
    [activeCommands],
  );

  const sendCommand = useCallback(
    async (action: CommandAction, project: string) => {
      if (!serverId) return;
      const result = await enqueueCommand(serverId, action, project);
      if (!result.ok) {
        toast('error', result.message);
        return;
      }
      submittedIds.current.add(result.id);
      toast('info', `${ACTION_LABELS[action]} ${project}: команда отправлена`);
      refresh();
    },
    [serverId, refresh, toast],
  );

  const onAction = useCallback(
    (action: CommandAction, project: ProcessInfo) => {
      if (CONFIRM_TEXT[action]) setConfirming({ action, project });
      else void sendCommand(action, project.name);
    },
    [sendCommand],
  );

  const selectServer = useCallback((id: string) => {
    saveSelectedServer(id);
    setSelectedId(id);
    setRange('1h');
  }, []);

  if (!data) return <DashboardSkeleton />;

  const historyData = range === '1h' ? hourData : dayData;
  const alerts = failed ? [PANEL_ALERT, ...data.alerts] : data.alerts;
  const confirmText = confirming ? CONFIRM_TEXT[confirming.action] : undefined;

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-4 py-4 sm:space-y-5 sm:py-6">
      <Header
        servers={data.servers}
        serverId={serverId}
        onSelectServer={selectServer}
        onAddServer={() => setAddingServer(true)}
        hasData={data.hasData}
        ageSec={data.ageSec}
        uptimeSec={data.snapshot?.uptimeSec ?? null}
        network={data.snapshot?.network ?? null}
        device={data.snapshot?.device}
        platform={data.snapshot?.platform ?? null}
      />

      <Alerts alerts={alerts} />

      {!serverId ? (
        <div className="animate-rise rounded-2xl border border-line bg-surface p-10 text-center">
          <ServerCog className="mx-auto mb-4 size-8 text-muted" aria-hidden />
          <h2 className="font-semibold">Серверов пока нет</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">
            Добавьте первый сервер, чтобы получить ключ для агента.
          </p>
          <button
            type="button"
            onClick={() => setAddingServer(true)}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" aria-hidden />
            Добавить сервер
          </button>
        </div>
      ) : !data.snapshot ? (
        <div className="animate-rise rounded-2xl border border-line bg-surface p-10 text-center">
          <RadioTower className="mx-auto mb-4 size-8 text-muted" aria-hidden />
          <h2 className="font-semibold">Агент ещё не подключался</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">
            Установите агента на этот сервер по инструкции в README. Данные появятся здесь после
            первой отправки метрик.
          </p>
        </div>
      ) : (
        <>
          <Metrics snapshot={data.snapshot} history={hourData?.points ?? []} />
          <HistoryCharts range={range} onRangeChange={setRange} data={historyData} />
          <Projects
            projects={data.snapshot.processes}
            pm2Available={data.snapshot.pm2Available}
            online={data.online}
            isBusy={isBusy}
            onAction={onAction}
            onLogs={setLogsProject}
            onAddProject={() => setAddingProject(true)}
          />
          <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <CapacityCard capacity={data.capacity} />
            <CommandHistory
              commands={data.commands}
              onOpenOutput={(command) =>
                setProjectOutput({ id: command.id, project: command.project })
              }
            />
          </div>
        </>
      )}

      {confirming && confirmText && (
        <ConfirmDialog
          title={confirmText.title}
          description={`${confirming.project.name}. ${confirmText.text}`}
          confirmLabel={confirmText.button}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            void sendCommand(confirming.action, confirming.project.name);
            setConfirming(null);
          }}
        />
      )}

      {logsProject && serverId && (
        <LogsDialog
          key={`${serverId}:${logsProject}`}
          serverId={serverId}
          project={logsProject}
          onClose={() => setLogsProject(null)}
        />
      )}

      {projectOutput && serverId && (
        <LogsDialog
          key={projectOutput.id}
          serverId={serverId}
          project={projectOutput.project}
          commandId={projectOutput.id}
          title={`Установка: ${projectOutput.project}`}
          onClose={() => setProjectOutput(null)}
        />
      )}

      {addingProject && serverId && (
        <AddProjectDialog
          serverId={serverId}
          onClose={() => setAddingProject(false)}
          onCreated={(id, project) => {
            submittedIds.current.add(id);
            setAddingProject(false);
            setProjectOutput({ id, project });
            refresh();
          }}
        />
      )}

      {addingServer && (
        <AddServerDialog
          onClose={() => setAddingServer(false)}
          onCreated={(id) => {
            setAddingServer(false);
            selectServer(id);
            toast('success', 'Сервер добавлен. Установите на него агента');
          }}
        />
      )}
    </main>
  );
}

export function Dashboard() {
  return (
    <ToastProvider>
      <DashboardContent />
    </ToastProvider>
  );
}
