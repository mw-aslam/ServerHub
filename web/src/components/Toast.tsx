'use client';

import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

type ShowToast = (kind: ToastKind, message: string) => void;

const ToastContext = createContext<ShowToast>(() => undefined);

export const useToast = () => useContext(ToastContext);

const ICONS = {
  success: <CheckCircle2 className="size-5 shrink-0 text-good" aria-hidden />,
  error: <XCircle className="size-5 shrink-0 text-crit" aria-hidden />,
  info: <Info className="size-5 shrink-0 text-accent" aria-hidden />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((items) => items.filter((item) => item.id !== id));
  }, []);

  const show = useCallback<ShowToast>(
    (kind, message) => {
      const id = nextId.current++;
      setToasts((items) => [...items.slice(-3), { id, kind, message }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 sm:left-auto sm:w-96"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="animate-toast flex items-start gap-3 rounded-xl border border-line-strong bg-raised p-3.5 shadow-2xl shadow-black/50"
          >
            {ICONS[toast.kind]}
            <p className="min-w-0 flex-1 break-words text-sm">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Закрыть уведомление"
              className="text-muted transition-colors hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
