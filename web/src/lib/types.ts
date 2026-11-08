import type { z } from 'zod';
import type { commandActionSchema, snapshotSchema } from './schemas';

export type Snapshot = z.infer<typeof snapshotSchema>;
export type ProcessInfo = Snapshot['processes'][number];
export type CommandAction = z.infer<typeof commandActionSchema>;
export type HistoryAction = CommandAction | 'add_project';
export type Battery = NonNullable<Snapshot['battery']>;
export type Connection = NonNullable<Snapshot['network']['connection']>;
export type CommandStatus = 'pending' | 'running' | 'success' | 'error' | 'expired';

export interface CommandRow {
  id: string;
  action: HistoryAction;
  project: string;
  status: CommandStatus;
  output_preview: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface CommandDetails extends Omit<CommandRow, 'output_preview'> {
  output: string | null;
}

export interface Alert {
  id: string;
  level: 'critical' | 'warning';
  title: string;
  detail: string;
}

export interface Capacity {
  freeMb: number;
  reserveMb: number;
  averageMb: number | null;
  projectCount: number;
  fits: number | null;
}

export interface ServerSummary {
  id: string;
  name: string;
  online: boolean;
}

export type Platform = Snapshot['platform'];

export interface DashboardData {
  servers: ServerSummary[];
  serverId: string | null;
  hasData: boolean;
  online: boolean;
  ageSec: number | null;
  snapshot: Snapshot | null;
  commands: CommandRow[];
  alerts: Alert[];
  capacity: Capacity | null;
}

export interface HistoryPoint {
  t: string;
  cpu: number | null;
  ram: number | null;
  battery: number | null;
  temperature: number | null;
  latency: number | null;
}

export interface HistoryData {
  serverId: string;
  points: HistoryPoint[];
  now: number;
  rangeSec: number;
  bucketSec: number;
}

export type HistoryRange = '1h' | '24h';
