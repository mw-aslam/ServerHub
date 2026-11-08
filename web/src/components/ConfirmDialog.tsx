'use client';

import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onCancel={onCancel}
      onClick={(event) => {
        if (event.target === ref.current) onCancel();
      }}
      className="animate-rise m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-line-strong bg-surface p-0 text-ink"
    >
      <div className="p-6">
        <div className="flex gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-warn/15 text-warn">
            <TriangleAlert className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1.5 break-words text-sm text-ink-2">{description}</p>
          </div>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="rounded-lg border border-line-strong px-4 py-2 text-sm transition-colors hover:bg-raised"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-crit px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
