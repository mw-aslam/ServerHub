'use client';

import {
  BatteryCharging,
  BatteryFull,
  CircleCheck,
  CircleHelp,
  CircleX,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  batteryHealthLabel,
  batteryStateLabel,
  formatGb,
  formatMb,
} from '@/lib/format';
import { ramPercent } from '@/lib/insights';
import type { HistoryPoint, Snapshot } from '@/lib/types';
import { Sparkline } from './Sparkline';

type Tone = 'normal' | 'warning' | 'critical' | 'unknown';

const TONE_STROKE: Record<Tone, string> = {
  normal: 'var(--color-accent)',
  warning: 'var(--color-warn)',
  critical: 'var(--color-crit)',
  unknown: 'var(--color-line-strong)',
};

const TONE_TAG = {
  normal: { icon: <CircleCheck className="size-3.5 text-good" aria-hidden />, label: 'Норма' },
  warning: { icon: <TriangleAlert className="size-3.5 text-warn" aria-hidden />, label: 'Внимание' },
  critical: { icon: <CircleX className="size-3.5 text-crit" aria-hidden />, label: 'Критично' },
  unknown: { icon: <CircleHelp className="size-3.5 text-muted" aria-hidden />, label: 'Недоступно' },
};

function toneByLimits(value: number | null, warning: number, critical: number): Tone {
  if (value === null) return 'unknown';
  if (value >= critical) return 'critical';
  if (value >= warning) return 'warning';
  return 'normal';
}

function Ring({ percent, tone, label }: { percent: number | null; tone: Tone; label: string }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.min(100, Math.max(0, percent ?? 0)) / 100;

  return (
    <div className="relative size-24 shrink-0" role="img" aria-label={label}>
      <svg viewBox="0 0 96 96" className="size-full -rotate-90" aria-hidden>
        <circle cx="48" cy="48" r={radius} fill="none" stroke="var(--color-line)" strokeWidth="8" />
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          stroke={TONE_STROKE[tone]}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - filled)}
          style={{ transition: 'stroke-dashoffset 0.7s ease, stroke 0.3s ease' }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-lg font-semibold">
        {label}
      </span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-ink">{value}</dd>
    </div>
  );
}

function MetricCard({
  title,
  icon,
  tone,
  percent,
  ringLabel,
  className = '',
  children,
}: {
  title: string;
  icon: ReactNode;
  tone: Tone;
  percent: number | null;
  ringLabel: string;
  className?: string;
  children: ReactNode;
}) {
  const tag = TONE_TAG[tone];
  return (
    <article className={`animate-rise rounded-2xl border border-line bg-surface p-4 sm:p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-ink-2">
          <span className="text-muted">{icon}</span>
          {title}
        </h2>
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
          {tag.icon}
          {tag.label}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <Ring percent={percent} tone={tone} label={ringLabel} />
        <dl className="min-w-0 flex-1 space-y-1.5 text-sm">{children}</dl>
      </div>
    </article>
  );
}

const LATENCY_RING_MAX_MS = 500;

export function Metrics({
  snapshot,
  history,
}: {
  snapshot: Snapshot;
  history: HistoryPoint[];
}) {
  const { ram, disk, battery, cpu, network } = snapshot;

  const ramValue = ramPercent(ram);
  const diskValue = disk && disk.totalMb > 0 ? (disk.usedMb / disk.totalMb) * 100 : null;

  let batteryTone: Tone = 'unknown';
  if (battery) {
    if (battery.percent < 20 && !battery.charging) batteryTone = 'critical';
    else if (battery.temperature != null && battery.temperature > 42) batteryTone = 'critical';
    else if (battery.percent < 35 && !battery.charging) batteryTone = 'warning';
    else batteryTone = 'normal';
  }

  const latency = network.latencyMs;
  const cpuSource = {
    loadavg: 'Load average',
    'cpu-times': 'Загрузка ядер',
    top: 'Команда top',
    pm2: 'По процессам pm2',
    unavailable: 'Система не даёт доступа',
  }[cpu.source];

  // Без батареи остаётся четыре карточки: раскладываем их ровно два на два.
  const memoryWidth = battery ? 'lg:col-span-2' : 'lg:col-span-3';
  const latencyWidth = battery ? 'sm:col-span-2 lg:col-span-3' : 'lg:col-span-3';

  return (
    <section
      aria-label="Текущие показатели"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-6"
    >
      <MetricCard
        className={memoryWidth}
        title="Оперативная память"
        icon={<MemoryStick className="size-4" aria-hidden />}
        tone={toneByLimits(ramValue, 70, 85)}
        percent={ramValue}
        ringLabel={ramValue === null ? '—' : `${Math.round(ramValue)}%`}
      >
        <Row label="Занято" value={ram ? formatMb(ram.usedMb) : '—'} />
        <Row label="Свободно" value={ram ? formatMb(ram.freeMb) : '—'} />
        <Row label="Всего" value={ram ? formatMb(ram.totalMb) : '—'} />
      </MetricCard>

      <MetricCard
        className={memoryWidth}
        title="Хранилище"
        icon={<HardDrive className="size-4" aria-hidden />}
        tone={toneByLimits(diskValue, 75, 90)}
        percent={diskValue}
        ringLabel={diskValue === null ? '—' : `${Math.round(diskValue)}%`}
      >
        <Row label="Занято" value={disk ? formatGb(disk.usedMb) : '—'} />
        <Row label="Свободно" value={disk ? formatGb(disk.freeMb) : '—'} />
        <Row label="Всего" value={disk ? formatGb(disk.totalMb) : '—'} />
      </MetricCard>

      {battery && (
        <MetricCard
          className="lg:col-span-2"
          title="Батарея"
          icon={
            battery.charging ? (
              <BatteryCharging className="size-4 text-good" aria-hidden />
            ) : (
              <BatteryFull className="size-4" aria-hidden />
            )
          }
          tone={batteryTone}
          percent={battery.percent}
          ringLabel={`${Math.round(battery.percent)}%`}
        >
          <Row
            label="Питание"
            value={
              <span className="inline-flex items-center gap-1">
                {battery.charging && <Zap className="size-3.5 text-good" aria-hidden />}
                {batteryStateLabel(battery)}
              </span>
            }
          />
          <Row
            label="Температура"
            value={battery.temperature != null ? `${battery.temperature.toFixed(1)} °C` : '—'}
          />
          <Row label="Состояние" value={batteryHealthLabel(battery.health)} />
          {battery.currentMa != null && (
            <Row label="Ток" value={`${Math.abs(battery.currentMa)} мА`} />
          )}
        </MetricCard>
      )}

      <MetricCard
        className="lg:col-span-3"
        title="Процессор"
        icon={<Cpu className="size-4" aria-hidden />}
        tone={toneByLimits(cpu.percent, 70, 85)}
        percent={cpu.percent}
        ringLabel={cpu.percent === null ? '—' : `${Math.round(cpu.percent)}%`}
      >
        <Row label="Источник" value={cpuSource} />
        <Row label="Нагрузка" value={
          cpu.load1 === null ? '—' : `${cpu.load1} / ${cpu.load5} / ${cpu.load15}`
        } />
        <Row label="Ядер" value={cpu.cores} />
      </MetricCard>

      <MetricCard
        className={latencyWidth}
        title="Задержка сети"
        icon={<Gauge className="size-4" aria-hidden />}
        tone={toneByLimits(latency, 300, 800)}
        percent={latency === null ? null : (latency / LATENCY_RING_MAX_MS) * 100}
        ringLabel={latency === null ? '—' : `${Math.round(latency)} мс`}
      >
        <Row label="До 1.1.1.1" value={latency === null ? '—' : `${Math.round(latency)} мс`} />
        <Row
          label="Ответ панели"
          value={network.backendMs === null ? '—' : `${Math.round(network.backendMs)} мс`}
        />
        <div className="pt-1">
          <Sparkline values={history.map((point) => point.latency)} label="Задержка за последний час" />
        </div>
      </MetricCard>
    </section>
  );
}
