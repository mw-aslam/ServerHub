'use client';

import { ChevronDown, Clock, LogOut, Monitor, Plus, Server, Timer, Wifi, WifiOff } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { logout } from '@/lib/client';
import { PLATFORM_LABELS, formatAgo, formatUptime } from '@/lib/format';
import { OFFLINE_AFTER_SEC } from '@/lib/insights';
import type { Platform, ServerSummary } from '@/lib/types';

interface HeaderProps {
  servers: ServerSummary[];
  serverId: string | null;
  onSelectServer: (id: string) => void;
  onAddServer: () => void;
  hasData: boolean;
  ageSec: number | null;
  uptimeSec: number | null;
  wifi: string | null;
  platform: Platform | null;
}

// Возраст данных идёт между запросами, поэтому статус сменится
// на оффлайн вовремя, даже если сама панель потеряла связь.
function useLiveAge(ageSec: number | null): number | null {
  const base = useRef({ ageSec, at: 0 });
  const [age, setAge] = useState(ageSec);

  useEffect(() => {
    base.current = { ageSec, at: performance.now() };
    setAge(ageSec);
  }, [ageSec]);

  useEffect(() => {
    const timer = setInterval(() => {
      const { ageSec: value, at } = base.current;
      if (value != null) setAge(value + (performance.now() - at) / 1000);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return age;
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <span className="text-muted">{icon}</span>
      <span className="text-muted">{label}</span>
      <span className="truncate text-ink">{value}</span>
    </div>
  );
}

export function Header({
  servers,
  serverId,
  onSelectServer,
  onAddServer,
  hasData,
  ageSec,
  uptimeSec,
  wifi,
  platform,
}: HeaderProps) {
  const liveAge = useLiveAge(ageSec);
  const online = hasData && liveAge != null && liveAge <= OFFLINE_AFTER_SEC;
  const showWifi = wifi !== null || platform === 'termux';

  return (
    <header className="animate-rise rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
          <Server className="size-5" aria-hidden />
        </span>
        <h1 className="text-lg font-semibold">ServerHub</h1>

        <button
          type="button"
          onClick={() => void logout()}
          aria-label="Выйти"
          title="Выйти"
          className="order-2 ml-auto grid size-10 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink sm:order-last sm:ml-0"
        >
          <LogOut className="size-4" aria-hidden />
        </button>

        <div className="order-3 flex w-full min-w-0 flex-wrap items-center gap-3 sm:order-2 sm:ml-2 sm:w-auto sm:flex-1">
          {serverId && (
            <>
              <div className="relative min-w-0 basis-full sm:max-w-72 sm:flex-1 sm:basis-auto">
                <label htmlFor="server-select" className="sr-only">
                  Сервер
                </label>
                <select
                  id="server-select"
                  value={serverId}
                  onChange={(event) => onSelectServer(event.target.value)}
                  className="w-full appearance-none truncate rounded-lg border border-line-strong bg-page py-2 pr-9 pl-3 text-sm font-medium transition-colors hover:border-muted"
                >
                  {servers.map((server) => (
                    <option key={server.id} value={server.id}>
                      {server.name} — {server.online ? 'онлайн' : 'оффлайн'}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted"
                  aria-hidden
                />
              </div>

              <span
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                  online ? 'border-good/40 bg-good/10' : 'border-crit/50 bg-crit/15'
                }`}
              >
                {online ? (
                  <Wifi className="size-4 text-good" aria-hidden />
                ) : (
                  <WifiOff className="size-4 text-crit" aria-hidden />
                )}
                {online ? 'Онлайн' : 'Оффлайн'}
              </span>
            </>
          )}

          <button
            type="button"
            onClick={onAddServer}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-sm text-ink-2 transition-colors hover:bg-raised hover:text-ink sm:ml-auto"
          >
            <Plus className="size-4" aria-hidden />
            Добавить сервер
          </button>
        </div>
      </div>

      {serverId && hasData && (
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-4">
          <Fact icon={<Clock className="size-4" aria-hidden />} label="Ответ" value={formatAgo(liveAge)} />
          <Fact icon={<Timer className="size-4" aria-hidden />} label="Аптайм" value={formatUptime(uptimeSec)} />
          {platform && (
            <Fact
              icon={<Monitor className="size-4" aria-hidden />}
              label="Система"
              value={PLATFORM_LABELS[platform]}
            />
          )}
          {showWifi && (
            <Fact icon={<Wifi className="size-4" aria-hidden />} label="Wi-Fi" value={wifi ?? 'недоступно'} />
          )}
        </div>
      )}
    </header>
  );
}
