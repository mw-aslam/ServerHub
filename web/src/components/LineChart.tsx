'use client';

import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react';
import { formatDateTime, formatTime } from '@/lib/format';

export interface ChartPoint {
  t: number;
  value: number | null;
}

interface LineChartProps {
  title: string;
  points: ChartPoint[];
  domain: [number, number];
  bucketSec: number;
  fixedMax?: number;
  format: (value: number) => string;
  className?: string;
}

const HEIGHT = 190;
const MARGIN = { top: 10, right: 12, bottom: 26, left: 44 };

function niceCeil(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(value, 1)));
  for (const multiple of [1, 2, 4, 8, 10]) {
    if (multiple * magnitude >= value) return multiple * magnitude;
  }
  return 10 * magnitude;
}

// Подписи времени выравниваются по местному времени: 12:00, 12:15, 12:30.
function timeTicks(domain: [number, number], width: number): number[] {
  const span = domain[1] - domain[0];
  const isDay = span > 2 * 3_600_000;
  let step = isDay ? 6 * 3_600_000 : 15 * 60_000;
  if (width < 340) step *= 2;
  const offset = new Date().getTimezoneOffset() * 60_000;
  const ticks: number[] = [];
  for (
    let tick = Math.ceil((domain[0] - offset) / step) * step + offset;
    tick <= domain[1];
    tick += step
  ) {
    ticks.push(tick);
  }
  return ticks;
}

export function LineChart({
  title,
  points,
  domain,
  bucketSec,
  fixedMax,
  format,
  className = '',
}: LineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const known = points.filter(
    (point): point is { t: number; value: number } => point.value !== null,
  );
  const latest = known.at(-1)?.value ?? null;
  // Минимум 4, чтобы подписи оси были разными целыми числами.
  const yMax = fixedMax ?? niceCeil(Math.max(...known.map((point) => point.value), 4));
  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 1);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const baseline = MARGIN.top + plotHeight;

  const x = (t: number) =>
    MARGIN.left + ((t - domain[0]) / Math.max(domain[1] - domain[0], 1)) * plotWidth;
  const y = (value: number) => MARGIN.top + (1 - Math.min(value, yMax) / yMax) * plotHeight;

  // Разрывы линии показывают время, когда сервер не присылал данных.
  const segments: { t: number; value: number }[][] = [];
  let current: { t: number; value: number }[] = [];
  for (const point of known) {
    const previous = current.at(-1);
    if (previous && point.t - previous.t > bucketSec * 2500) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) segments.push(current);

  const line = (segment: { t: number; value: number }[]) =>
    segment
      .map((point, index) => `${index ? 'L' : 'M'}${x(point.t).toFixed(1)} ${y(point.value).toFixed(1)}`)
      .join('');
  const area = (segment: { t: number; value: number }[]) =>
    `${line(segment)}L${x(segment.at(-1)!.t).toFixed(1)} ${baseline}L${x(segment[0].t).toFixed(1)} ${baseline}Z`;

  const active = activeIndex !== null ? known[activeIndex] : null;
  const activeX = active ? x(active.t) : 0;

  const onPointer = (event: PointerEvent<SVGSVGElement>) => {
    if (known.length === 0) return;
    const pointerX = event.clientX - event.currentTarget.getBoundingClientRect().left;
    let nearest = 0;
    let nearestDistance = Infinity;
    known.forEach((point, index) => {
      const distance = Math.abs(x(point.t) - pointerX);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    });
    setActiveIndex(nearest);
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (known.length === 0) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      setActiveIndex((index) =>
        Math.min(known.length - 1, Math.max(0, (index ?? known.length - 1) + direction)),
      );
    }
  };

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((part) => part * yMax);

  return (
    <article className={`min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5 ${className}`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-ink-2">{title}</h3>
        <span className="text-lg font-semibold">{latest === null ? '—' : format(latest)}</span>
      </div>

      <div ref={containerRef} className="relative" style={{ height: HEIGHT }}>
        {known.length === 0 && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted">
            Данных за этот период пока нет
          </div>
        )}
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`${title}. Стрелки влево и вправо переключают точки графика.`}
            tabIndex={known.length > 0 ? 0 : -1}
            style={{ touchAction: 'pan-y' }}
            className="block rounded-md"
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setActiveIndex(null)}
            onKeyDown={onKeyDown}
            onBlur={() => setActiveIndex(null)}
          >
            {yTicks.map((tick) => (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={width - MARGIN.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke={tick === 0 ? 'var(--color-line-strong)' : 'var(--color-line)'}
                  strokeWidth="1"
                />
                <text
                  x={MARGIN.left - 8}
                  y={y(tick) + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="var(--color-muted)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {Math.round(tick)}
                </text>
              </g>
            ))}

            {timeTicks(domain, width).map((tick) => {
              const tickX = x(tick);
              if (tickX > width - 20 || tickX < MARGIN.left + 16) return null;
              return (
                <text
                  key={tick}
                  x={tickX}
                  y={HEIGHT - 6}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--color-muted)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatTime(tick)}
                </text>
              );
            })}

            {segments.map((segment) =>
              segment.length === 1 ? (
                <circle
                  key={segment[0].t}
                  cx={x(segment[0].t)}
                  cy={y(segment[0].value)}
                  r="2"
                  fill="var(--color-accent)"
                />
              ) : (
                <g key={segment[0].t}>
                  <path d={area(segment)} fill="var(--color-accent)" opacity="0.1" />
                  <path
                    d={line(segment)}
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              ),
            )}

            {active && (
              <g pointerEvents="none">
                <line
                  x1={activeX}
                  x2={activeX}
                  y1={MARGIN.top}
                  y2={baseline}
                  stroke="var(--color-muted)"
                  strokeWidth="1"
                />
                <circle
                  cx={activeX}
                  cy={y(active.value)}
                  r="4.5"
                  fill="var(--color-accent)"
                  stroke="var(--color-surface)"
                  strokeWidth="2"
                />
              </g>
            )}
          </svg>
        )}

        {active && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-lg border border-line-strong bg-raised px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg shadow-black/40"
            style={
              activeX > width / 2
                ? { right: width - activeX + 10 }
                : { left: activeX + 10 }
            }
          >
            <div className="font-semibold text-ink">{format(active.value)}</div>
            <div className="text-muted">{formatDateTime(new Date(active.t).toISOString())}</div>
          </div>
        )}
      </div>
    </article>
  );
}
