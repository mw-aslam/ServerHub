import { z } from 'zod';

const percent = z.number().min(0).max(100);
const nonNegative = z.number().min(0);

export const uuidSchema = z.uuid();

const processSchema = z.object({
  name: z.string().min(1).max(200),
  status: z.string().min(1).max(40),
  cpu: nonNegative,
  memoryMb: nonNegative,
  uptimeSec: nonNegative,
  restarts: nonNegative,
  pid: nonNegative.nullable(),
  isAgent: z.boolean(),
});

const storageSchema = z.object({
  totalMb: nonNegative,
  usedMb: nonNegative,
  freeMb: nonNegative,
});

export const snapshotSchema = z.object({
  platform: z.enum(['termux', 'linux', 'macos', 'windows']),
  cpu: z.object({
    percent: percent.nullable(),
    load1: nonNegative.nullable(),
    load5: nonNegative.nullable(),
    load15: nonNegative.nullable(),
    cores: z.number().int().min(1).max(1024),
    source: z.enum(['loadavg', 'cpu-times', 'pm2', 'unavailable']),
  }),
  ram: storageSchema.nullable(),
  disk: storageSchema.nullable(),
  battery: z
    .object({
      percent,
      charging: z.boolean(),
      temperature: z.number().min(-40).max(150).nullable(),
      health: z.string().max(40).nullable(),
      status: z.string().max(40).nullable(),
    })
    .nullable(),
  network: z.object({
    latencyMs: nonNegative.nullable(),
    backendMs: nonNegative.nullable(),
    wifi: z.string().max(100).nullable(),
  }),
  uptimeSec: nonNegative.nullable(),
  pm2Available: z.boolean(),
  processes: z.array(processSchema).max(200),
});

export const commandActionSchema = z.enum(['start', 'stop', 'restart', 'update', 'logs']);

export const commandRequestSchema = z.object({
  serverId: uuidSchema,
  action: commandActionSchema,
  project: z.string().min(1).max(200),
});

export const commandResultSchema = z.object({
  id: uuidSchema,
  status: z.enum(['success', 'error', 'expired']),
  output: z.string().max(70_000),
});

export const createServerSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

export const loginSchema = z.object({
  password: z.string().min(1).max(500),
});

export const historyQuerySchema = z.object({
  server: uuidSchema,
  range: z.enum(['1h', '24h']),
});
