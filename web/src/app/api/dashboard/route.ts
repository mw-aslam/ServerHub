import { errorJson, json, requireSession, serverError } from '@/lib/api';
import { rpc } from '@/lib/db';
import { OFFLINE_AFTER_SEC, buildAlerts, buildCapacity } from '@/lib/insights';
import { uuidSchema } from '@/lib/schemas';
import type { CommandRow, DashboardData, Snapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface DashboardRow {
  servers: { id: string; name: string; age_sec: number | null }[];
  server_id: string | null;
  snapshot: Snapshot | null;
  age_sec: number | null;
  commands: CommandRow[];
}

const isOnline = (ageSec: number | null) => ageSec !== null && ageSec <= OFFLINE_AFTER_SEC;

export async function GET(request: Request) {
  try {
    const denied = await requireSession();
    if (denied) return denied;

    const requested = new URL(request.url).searchParams.get('server');
    const server = requested === null ? null : uuidSchema.safeParse(requested);
    if (server && !server.success) return errorJson('Неверный идентификатор сервера', 400);

    const row = await rpc<DashboardRow>('get_dashboard', {
      p_server_id: server?.data ?? null,
      p_commands_limit: 20,
    });
    const hasData = row.snapshot !== null;
    const online = hasData && isOnline(row.age_sec);

    const data: DashboardData = {
      servers: row.servers.map(({ id, name, age_sec }) => ({
        id,
        name,
        online: isOnline(age_sec),
      })),
      serverId: row.server_id,
      hasData,
      online,
      ageSec: row.age_sec,
      snapshot: row.snapshot,
      commands: row.commands,
      alerts: buildAlerts(row.snapshot, online, row.age_sec),
      capacity: buildCapacity(row.snapshot),
    };
    return json(data);
  } catch (error) {
    return serverError('dashboard', error);
  }
}
