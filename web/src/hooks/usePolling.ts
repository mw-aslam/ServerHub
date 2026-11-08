'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface PollingState<T> {
  data: T | null;
  failed: boolean;
  refresh: () => void;
}

// Следующий запрос уходит только после завершения предыдущего.
// На скрытой вкладке опрос останавливается, чтобы экономить лимиты Vercel.
export function usePolling<T>(url: string | null, intervalMs: number): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!url) return;

    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      if (inFlight || cancelled || document.hidden) return;
      inFlight = true;
      clearTimeout(timer);
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (response.status === 401) {
          window.location.assign('/login');
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as T;
        if (!cancelled) {
          setData(body);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        inFlight = false;
        if (!cancelled && !document.hidden) timer = setTimeout(load, intervalMs);
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) clearTimeout(timer);
      else void load();
    };

    refreshRef.current = () => void load();
    document.addEventListener('visibilitychange', onVisibilityChange);
    void load();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [url, intervalMs]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { data, failed, refresh };
}
