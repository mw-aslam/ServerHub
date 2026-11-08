import type { Alert, Capacity, Snapshot } from './types';

export const OFFLINE_AFTER_SEC = 30;
export const RAM_RESERVE_MB = 300;

export function ramPercent(ram: Snapshot['ram']): number | null {
  if (!ram || ram.totalMb <= 0) return null;
  return (ram.usedMb / ram.totalMb) * 100;
}

export function buildAlerts(
  snapshot: Snapshot | null,
  online: boolean,
  ageSec: number | null,
): Alert[] {
  if (!snapshot) return [];

  // Пока сервер оффлайн, остальные показатели устарели и только запутают.
  if (!online) {
    return [
      {
        id: 'offline',
        level: 'critical',
        title: 'Сервер оффлайн',
        detail: `Нет данных уже ${Math.round(ageSec ?? 0)} с. Проверьте устройство, сеть и агента в pm2.`,
      },
    ];
  }

  const alerts: Alert[] = [];
  const { battery } = snapshot;

  if (battery && battery.percent < 20 && !battery.charging) {
    alerts.push({
      id: 'battery-low',
      level: 'critical',
      title: 'Батарея разряжается',
      detail: `Осталось ${Math.round(battery.percent)}%, зарядка не подключена.`,
    });
  }

  if (battery?.temperature != null && battery.temperature > 42) {
    alerts.push({
      id: 'battery-hot',
      level: 'critical',
      title: 'Устройство перегревается',
      detail: `Температура батареи ${battery.temperature.toFixed(1)} °C при пороге 42 °C.`,
    });
  }

  const ram = ramPercent(snapshot.ram);
  if (ram !== null && ram > 85) {
    alerts.push({
      id: 'ram-high',
      level: 'warning',
      title: 'Мало оперативной памяти',
      detail: `Занято ${Math.round(ram)}% при пороге 85%.`,
    });
  }

  for (const process of snapshot.processes) {
    if (process.status === 'errored') {
      alerts.push({
        id: `crashed-${process.name}`,
        level: 'critical',
        title: `Проект ${process.name} упал`,
        detail: `Статус errored, перезапусков: ${process.restarts}. Откройте логи проекта.`,
      });
    }
  }

  return alerts;
}

// Агент не считается: это служебный процесс, а не типичный проект.
export function buildCapacity(snapshot: Snapshot | null): Capacity | null {
  if (!snapshot?.ram) return null;

  const projects = snapshot.processes.filter(
    (process) => !process.isAgent && process.status === 'online' && process.memoryMb > 0,
  );
  const freeMb = snapshot.ram.freeMb;

  if (projects.length === 0) {
    return { freeMb, reserveMb: RAM_RESERVE_MB, averageMb: null, projectCount: 0, fits: null };
  }

  const averageMb = projects.reduce((sum, item) => sum + item.memoryMb, 0) / projects.length;
  return {
    freeMb,
    reserveMb: RAM_RESERVE_MB,
    averageMb,
    projectCount: projects.length,
    fits: Math.max(0, Math.floor((freeMb - RAM_RESERVE_MB) / averageMb)),
  };
}
