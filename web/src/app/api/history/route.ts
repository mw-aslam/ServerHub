import { errorJson, json, requireSession, serverError } from '@/lib/api';
import { rpc } from '@/lib/db';
import { historyQuerySchema } from '@/lib/schemas';
import type { HistoryData, HistoryPoint } from '@/lib/types';

export const dynamic = 'force-dynamic';

const RANGES = {
  '1h': { rangeSec: 3600, bucketSec: 30 },
  '24h': { rangeSec: 86_400, bucketSec: 600 },
} as const;

export async function GET(request: Request) {
  try {
    const denied = await requireSession();
    if (denied) return denied;

    const params = new URL(request.url).searchParams;
    const query = historyQuerySchema.safeParse({
      server: params.get('server'),
      range: params.get('range'),
    });
    if (!query.success) return errorJson('Неверные параметры', 400);

    const { rangeSec, bucketSec } = RANGES[query.data.range];
    const points = await rpc<HistoryPoint[]>('get_metrics_history', {
      p_server_id: query.data.server,
      p_range_seconds: rangeSec,
      p_bucket_seconds: bucketSec,
    });

    const data: HistoryData = {
      serverId: query.data.server,
      points,
      now: Date.now(),
      rangeSec,
      bucketSec,
    };
    return json(data);
  } catch (error) {
    return serverError('history', error);
  }
}
