import type { Battery, CommandStatus, Connection, HistoryAction, Platform } from './types';

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

export const ACTION_LABELS: Record<HistoryAction, string> = {
  start: 'Старт',
  stop: 'Стоп',
  restart: 'Перезапуск',
  update: 'Обновление',
  logs: 'Логи',
  add_project: 'Добавление',
};

export const COMMAND_STATUS_LABELS: Record<CommandStatus, string> = {
  pending: 'В очереди',
  running: 'Выполняется',
  success: 'Успешно',
  error: 'Ошибка',
  expired: 'Устарела',
};

const PLUGGED_LABELS: Record<string, string> = {
  PLUGGED_AC: 'сеть',
  PLUGGED_USB: 'USB',
  PLUGGED_WIRELESS: 'беспроводная',
};

const CONNECTION_REASONS: Record<NonNullable<Connection['reason']>, string> = {
  no_package: 'Установите пакет: pkg install termux-api',
  no_app: 'Установите приложение Termux:API и разрешите ему геолокацию',
  location: 'Имя сети скрыто: дайте Termux:API разрешение на геолокацию и включите её',
};

export function describeConnection(connection: Connection): { value: string; note: string | null } {
  const note = connection.reason ? CONNECTION_REASONS[connection.reason] : null;
  if (connection.type === 'mobile') return { value: 'Мобильная сеть', note };
  if (connection.type === 'unknown') return { value: 'Тип сети неизвестен', note };

  const parts = [connection.ssid ?? 'Wi-Fi подключён'];
  if (connection.rssi !== null) parts.push(`${connection.rssi} дБм`);
  if (connection.linkSpeedMbps !== null) parts.push(`${connection.linkSpeedMbps} Мбит/с`);
  return { value: parts.join(' · '), note };
}

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

export function batteryStateLabel(battery: Battery): string {
  if (!battery.charging) return 'От батареи';
  const source = battery.plugged ? PLUGGED_LABELS[battery.plugged] : undefined;
  const suffix = source ? ` (${source})` : '';
  if (battery.status === 'FULL') return `Заряжена${suffix}`;
  if (battery.status === 'PLUGGED' || battery.status === 'NOT_CHARGING') return `От сети${suffix}`;
  return `Заряжается${suffix}`;
}

export function batteryHealthLabel(health: string | null): string {
  if (!health) return 'неизвестно';
  return BATTERY_HEALTH[health] ?? 'неизвестно';
}
