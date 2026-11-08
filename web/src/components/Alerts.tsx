import { CircleX, TriangleAlert } from 'lucide-react';
import type { Alert } from '@/lib/types';

export function Alerts({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;

  return (
    <section aria-label="Предупреждения" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          role="status"
          className={`animate-rise flex items-start gap-3 rounded-xl border p-3.5 ${
            alert.level === 'critical' ? 'border-crit/50 bg-crit/10' : 'border-warn/40 bg-warn/10'
          }`}
        >
          {alert.level === 'critical' ? (
            <CircleX className="mt-0.5 size-5 shrink-0 text-crit" aria-hidden />
          ) : (
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="break-words text-sm font-medium">{alert.title}</p>
            <p className="mt-0.5 break-words text-sm text-ink-2">{alert.detail}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
