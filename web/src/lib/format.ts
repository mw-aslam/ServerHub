import type { CommandAction, CommandStatus, Platform } from './types';

const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export function formatMb(value: number): string {
  return `${numberFormat.format(value)} МБ`;
}

export function formatGb(valueMb: number): string {
  return `${(valueMb / 1024).toLocaleString('ru-RU', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} ГБ`;
}

export function formatUptime(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null) return '—';
  const seconds = Math.floor(totalSeconds);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  if (minutes > 0) return `${minutes} мин`;
  return `${seconds} с`;
}

export function formatAgo(seconds: number | null): string {
  if (seconds == null) return 'нет данных';
  if (seconds < 2) return 'только что';
  if (seconds < 60) return `${Math.floor(seconds)} с назад`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин назад`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} ч назад`;
  return `${Math.floor(seconds / 86_400)} д назад`;
}

export function formatTime(value: number | string, withSeconds = false): string {
  return new Date(value).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
  });
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const ACTION_LABELS: Record<CommandAction, string> = {
  start: 'Старт',
  stop: 'Стоп',
  restart: 'Перезапуск',
  update: 'Обновление',
  logs: 'Логи',
};

export const COMMAND_STATUS_LABELS: Record<CommandStatus, string> = {
  pending: 'В очереди',
  running: 'Выполняется',
  success: 'Успешно',
  error: 'Ошибка',
  expired: 'Устарела',
};

const BATTERY_STATUS: Record<string, string> = {
  CHARGING: 'Заряжается',
  DISCHARGING: 'Разряжается',
  FULL: 'Заряжена полностью',
  NOT_CHARGING: 'Не заряжается',
  PLUGGED: 'Подключена к сети',
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  termux: 'Android (Termux)',
  linux: 'Linux',
  macos: 'macOS',
  windows: 'Windows',
};

const BATTERY_HEALTH: Record<string, string> = {
  GOOD: 'хорошее',
  OVERHEAT: 'перегрев',
  DEAD: 'неисправна',
  COLD: 'переохлаждение',
  OVER_VOLTAGE: 'перенапряжение',
  UNSPECIFIED_FAILURE: 'сбой',
};

export function batteryStatusLabel(status: string | null): string {
  if (!status) return 'Неизвестно';
  return BATTERY_STATUS[status] ?? 'Неизвестно';
}

export function batteryHealthLabel(health: string | null): string {
  if (!health) return 'неизвестно';
  return BATTERY_HEALTH[health] ?? 'неизвестно';
}
