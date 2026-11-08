import { formatMb } from '@/lib/format';
import type { Capacity } from '@/lib/types';

export function CapacityCard({ capacity }: { capacity: Capacity | null }) {
  return (
    <section
      aria-labelledby="capacity-title"
      className="animate-rise rounded-2xl border border-line bg-surface p-4 sm:p-5"
    >
      <h2 id="capacity-title" className="text-base font-semibold">
        Вместится ли ещё проектов
      </h2>

      {capacity?.fits == null || capacity.averageMb === null ? (
        <p className="mt-3 text-sm text-ink-2">
          Оценка появится, когда в pm2 будет запущен хотя бы один проект, кроме агента.
        </p>
      ) : (
        <>
          <p className="mt-3 text-5xl font-semibold">{capacity.fits}</p>
          <p className="mt-3 text-sm text-ink-2">
            ({formatMb(capacity.freeMb)} свободно − {formatMb(capacity.reserveMb)} резерв) ÷{' '}
            {formatMb(capacity.averageMb)} средний расход
          </p>
          <p className="mt-2 text-sm text-muted">
            Средний расход считается по запущенным проектам ({capacity.projectCount}), агент не
            учитывается. Это приблизительная оценка: новый проект может занимать больше памяти,
            чем нынешние.
          </p>
        </>
      )}
    </section>
  );
}
