'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { detectPlatform } = require('./platform');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Значения намеренно не попадают в process.env, чтобы AGENT_KEY
// не унаследовали дочерние процессы: git, npm и скрипты установки.
function parseEnv(text) {
  const result = {};
  // Блокнот в Windows может добавить BOM в начало файла.
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (value === undefined || value === '' || !Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function buildConfig(env, platform = detectPlatform()) {
  const backendUrl = String(env.BACKEND_URL || '').replace(/\/+$/, '');
  const serverId = String(env.SERVER_ID || '');
  const agentKey = String(env.AGENT_KEY || '');

  if (!backendUrl) throw new Error('В .env не задан BACKEND_URL');
  if (!UUID_PATTERN.test(serverId)) throw new Error('В .env не задан или неверен SERVER_ID');
  if (!agentKey) throw new Error('В .env не задан AGENT_KEY');

  const url = new URL(backendUrl);
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !isLocal) {
    throw new Error('BACKEND_URL должен начинаться с https://, иначе ключ уйдёт открытым текстом');
  }

  return {
    backendUrl,
    serverId,
    agentKey,
    platform,
    pm2Script: env.PM2_SCRIPT || '',
    // Верхняя граница ниже порога оффлайна на сайте (30 секунд).
    syncIntervalMs: clampNumber(env.SYNC_INTERVAL_SEC, 10, 3, 25) * 1000,
    pm2IntervalMs: clampNumber(env.PM2_INTERVAL_SEC, 15, 5, 300) * 1000,
    batteryIntervalMs: clampNumber(env.BATTERY_INTERVAL_SEC, 30, 10, 600) * 1000,
    diskIntervalMs: clampNumber(env.DISK_INTERVAL_SEC, 60, 10, 3600) * 1000,
    wifiIntervalMs: clampNumber(env.WIFI_INTERVAL_SEC, 60, 10, 3600) * 1000,
    agentName: env.AGENT_PM2_NAME || 'serverhub-agent',
  };
}

function loadConfig() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error(`Не найден файл ${envPath}. Скопируйте .env.example в .env и заполните его`);
  }
  return buildConfig(parseEnv(fs.readFileSync(envPath, 'utf8')));
}

module.exports = { loadConfig, buildConfig, parseEnv };
