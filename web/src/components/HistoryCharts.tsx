'use client';

import { useMemo, useState } from 'react';
import { formatDateTime } from '@/lib/format';
import type { HistoryData, HistoryPoint, HistoryRange } from '@/lib/types';
import { type ChartPoint, LineChart } from './LineChart';
import { Skeleton } from './Skeleton';

const percent = (value: number) => `${Math.round(value)}%`;
const milliseconds = (value: number) => `${Math.round(value)} мс`;

const RANGE_OPTIONS: { value: HistoryRange; label: string }[] = [
  { value: '1h', label: '1 час' },
  { value: '24h', label: '24 часа' },
];

function toSeries(points: HistoryPoint[], key: 'cpu' | 'ram' | 'battery' | 'latency'): ChartPoint[] {
  return points.map((point) => ({ t: new Date(point.t).getTime(), value: point[key] }));
}

const cell = (value: number | null, format: (value: number) => string) =>
  value === null ? '—' : format(value);

export function HistoryCharts({
  range,
  onRangeChange,
  data,
}: {
  range: HistoryRange;
  onRangeChange: (range: HistoryRange) => void;
  data: HistoryData | null;
}) {
  const [showTable, setShowTable] = useState(false);
  const hasBattery = data?.points.some((point) => point.battery !== null) ?? false;
  const headings = ['Время', 'CPU', 'RAM', ...(hasBattery ? ['Батарея'] : []), 'Задержка'];

  const series = useMemo(() => {
    if (!data) return null;
    return {
      domain: [data.now - data.rangeSec * 1000, data.now] as [number, number],
      cpu: toSeries(data.points, 'cpu'),
      ram: toSeries(data.points, 'ram'),
      battery: toSeries(data.points, 'battery'),
      latency: toSeries(data.points, 'latency'),
    };
  }, [data]);

  return (
    <section aria-labelledby="history-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="history-title" className="text-base font-semibold">
          История
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowTable((value) => !value)}
            aria-pressed={showTable}
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-raised"
          >
            {showTable ? 'Графики' : 'Таблица'}
          </button>
          <div role="group" aria-label="Период" className="flex rounded-lg border border-line-strong p-0.5">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={range === option.value}
                onClick={() => onRangeChange(option.value)}
                className={`rounded-md px-3 py-1 text-sm transition-colors ${
                  range === option.value ? 'bg-raised text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!series || !data ? (
        <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-[262px]" />
          ))}
        </div>
      ) : showTable ? (
        <div className="max-h-[28rem] overflow-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[32rem] text-right text-sm tabular-nums">
            <thead className="sticky top-0 bg-raised text-muted">
              <tr>
                {headings.map((heading) => (
                  <th key={heading} scope="col" className="px-4 py-2.5 font-medium first:text-left">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...data.points].reverse().map((point) => (
                <tr key={point.t} className="border-t border-line">
                  <td className="px-4 py-2 text-left text-ink-2">{formatDateTime(point.t)}</td>
                  <td className="px-4 py-2">{cell(point.cpu, percent)}</td>
                  <td className="px-4 py-2">{cell(point.ram, percent)}</td>
                  {hasBattery && <td className="px-4 py-2">{cell(point.battery, percent)}</td>}
                  <td className="px-4 py-2">{cell(point.latency, milliseconds)}</td>
                </tr>
              ))}
              {data.points.length === 0 && (
                <tr>
                  <td colSpan={headings.length} className="px-4 py-8 text-center text-muted">
                    Данных за этот период пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
          <LineChart title="CPU, %" points={series.cpu} domain={series.domain} bucketSec={data.bucketSec} fixedMax={100} format={percent} />
          <LineChart title="RAM, %" points={series.ram} domain={series.domain} bucketSec={data.bucketSec} fixedMax={100} format={percent} />
          {hasBattery && (
            <LineChart title="Батарея, %" points={series.battery} domain={series.domain} bucketSec={data.bucketSec} fixedMax={100} format={percent} />
          )}
          <LineChart
            title="Задержка, мс"
            points={series.latency}
            domain={series.domain}
            bucketSec={data.bucketSec}
            format={milliseconds}
            className={hasBattery ? '' : 'lg:col-span-2'}
          />
        </div>
      )}
    </section>
  );
}
