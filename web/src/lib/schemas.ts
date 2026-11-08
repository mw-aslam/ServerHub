import { z } from 'zod';
import {
  ENV_KEY_PATTERN,
  START_COMMANDS,
  isValidGithubUrl,
  isValidProjectName,
} from './validation';

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

// Новые поля необязательны: агент, который ещё не обновили, должен продолжать работать.
const connectionSchema = z.object({
  type: z.enum(['wifi', 'mobile', 'unknown']),
  ssid: z.string().max(100).nullable(),
  rssi: z.number().nullable(),
  linkSpeedMbps: z.number().nullable(),
  frequencyMhz: z.number().nullable(),
  reason: z.enum(['no_package', 'no_app', 'location']).nullable(),
});

export const snapshotSchema = z.object({
  platform: z.enum(['termux', 'linux', 'macos', 'windows']),
  device: z
    .object({
      model: z.string().max(100).nullable(),
      androidVersion: z.string().max(100).nullable(),
    })
    .nullable()
    .optional(),
  termuxApi: z.enum(['ok', 'no_package', 'no_app']).nullable().optional(),
  cpu: z.object({
    percent: percent.nullable(),
    load1: nonNegative.nullable(),
    load5: nonNegative.nullable(),
    load15: nonNegative.nullable(),
    cores: z.number().int().min(1).max(1024),
    source: z.enum(['loadavg', 'cpu-times', 'top', 'pm2', 'unavailable']),
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
      plugged: z.string().max(40).nullable().optional(),
      currentMa: z.number().nullable().optional(),
    })
    .nullable(),
  network: z.object({
    latencyMs: nonNegative.nullable(),
    backendMs: nonNegative.nullable(),
    wifi: z.string().max(100).nullable(),
    connection: connectionSchema.nullable().optional(),
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

export const addProjectSchema = z.object({
  serverId: uuidSchema,
  name: z.string().refine(isValidProjectName),
  repoUrl: z.string().refine(isValidGithubUrl),
  startCommand: z.enum(START_COMMANDS),
  env: z
    .array(
      z.object({
        key: z.string().regex(ENV_KEY_PATTERN),
        value: z.string().max(4096).regex(/^[^\r\n\0]*$/),
      }),
    )
    .max(50)
    .refine((entries) => new Set(entries.map((entry) => entry.key)).size === entries.length),
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
