'use client';

import { LoaderCircle, Plus, TriangleAlert, X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { createProject } from '@/lib/client';
import {
  ENV_KEY_PATTERN,
  START_COMMANDS,
  isValidGithubUrl,
  isValidProjectName,
} from '@/lib/validation';

interface EnvRow {
  id: number;
  key: string;
  value: string;
}

const inputClass =
  'w-full min-w-0 rounded-lg border border-line-strong bg-page px-3 py-2 text-base outline-none transition-colors placeholder:text-muted focus:border-accent sm:text-sm';

export function AddProjectDialog({
  serverId,
  onClose,
  onCreated,
}: {
  serverId: string;
  onClose: () => void;
  onCreated: (id: string, name: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nextRowId = useRef(1);
  const [repoUrl, setRepoUrl] = useState('');
  const [name, setName] = useState('');
  const [startCommand, setStartCommand] = useState<string>(START_COMMANDS[0]);
  const [rows, setRows] = useState<EnvRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const addRow = () => {
    setRows((current) => [...current, { id: nextRowId.current++, key: '', value: '' }]);
  };

  const updateRow = (id: number, field: 'key' | 'value', text: string) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: text } : row)));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const url = repoUrl.trim();
    const projectName = name.trim();
    const env = rows
      .filter((row) => row.key.trim() || row.value)
      .map((row) => ({ key: row.key.trim(), value: row.value }));

    if (!isValidGithubUrl(url)) {
      setError('Разрешены только адреса вида https://github.com/владелец/репозиторий');
      return;
    }
    if (!isValidProjectName(projectName)) {
      setError('Имя: латинские буквы, цифры, - и _, не только цифры, начинается с буквы или цифры');
      return;
    }
    if (env.some((entry) => !ENV_KEY_PATTERN.test(entry.key))) {
      setError('Имя переменной: латинские буквы, цифры и _, не начинается с цифры');
      return;
    }
    if (new Set(env.map((entry) => entry.key)).size !== env.length) {
      setError('Имена переменных не должны повторяться');
      return;
    }

    setBusy(true);
    setError('');
    const result = await createProject({ serverId, name: projectName, repoUrl: url, startCommand, env });
    setBusy(false);
    if (result.ok) onCreated(result.id, projectName);
    else setError(result.message);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="add-project-title"
      onCancel={onClose}
      className="animate-rise m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-line-strong bg-surface p-0 text-ink"
    >
      <form onSubmit={submit} className="space-y-4 p-6" autoComplete="off">
        <h2 id="add-project-title" className="font-semibold">
          Добавить проект
        </h2>

        <div className="flex gap-3 rounded-xl border border-warn/40 bg-warn/10 p-3.5">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
          <p className="text-sm">
            Код из репозитория и его скрипты установки будут запущены на сервере. Добавляйте только
            те репозитории, которым доверяете.
          </p>
        </div>

        <div>
          <label htmlFor="project-url" className="mb-1.5 block text-sm text-ink-2">
            Репозиторий GitHub
          </label>
          <input
            id="project-url"
            autoFocus
            required
            inputMode="url"
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            placeholder="https://github.com/user/project"
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor="project-name" className="mb-1.5 block text-sm text-ink-2">
              Имя проекта
            </label>
            <input
              id="project-name"
              required
              maxLength={64}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="my-bot"
              className={inputClass}
            />
          </div>
          <div className="min-w-0">
            <label htmlFor="project-start" className="mb-1.5 block text-sm text-ink-2">
              Команда запуска
            </label>
            <select
              id="project-start"
              value={startCommand}
              onChange={(event) => setStartCommand(event.target.value)}
              className={inputClass}
            >
              {START_COMMANDS.map((command) => (
                <option key={command} value={command}>
                  {command}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className="min-w-0">
          <legend className="text-sm text-ink-2">Переменные .env</legend>
          <p className="mt-1 text-xs text-muted">
            Значения скрыты и не показываются после отправки. Проект должен сам читать файл .env,
            например через dotenv.
          </p>
          <div className="mt-2 space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="flex items-center gap-2">
                <input
                  aria-label="Имя переменной"
                  value={row.key}
                  onChange={(event) => updateRow(row.id, 'key', event.target.value)}
                  placeholder="KEY"
                  autoComplete="off"
                  spellCheck={false}
                  className={inputClass}
                />
                <input
                  aria-label="Значение переменной"
                  type="password"
                  value={row.value}
                  onChange={(event) => updateRow(row.id, 'value', event.target.value)}
                  placeholder="VALUE"
                  autoComplete="new-password"
                  className={inputClass}
                />
                <button
                  type="button"
                  aria-label="Удалить переменную"
                  onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                  className="grid size-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addRow}
            disabled={rows.length >= 50}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-raised disabled:opacity-40"
          >
            <Plus className="size-4" aria-hidden />
            Добавить переменную
          </button>
        </fieldset>

        {error && (
          <p role="alert" className="text-sm text-serious">
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line-strong px-4 py-2 text-sm transition-colors hover:bg-raised"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
            Установить
          </button>
        </div>
      </form>
    </dialog>
  );
}
