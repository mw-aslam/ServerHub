'use strict';

const fs = require('node:fs');

const PLATFORM_LABELS = { win32: 'windows', darwin: 'macos', android: 'termux' };

function detectPlatform(
  nodePlatform = process.platform,
  env = process.env,
  pathExists = fs.existsSync,
) {
  if (PLATFORM_LABELS[nodePlatform]) return PLATFORM_LABELS[nodePlatform];
  // Сборка Node для Termux может сообщать linux, поэтому проверяем и окружение.
  const isTermux =
    Boolean(env.TERMUX_VERSION) ||
    String(env.PREFIX || '').includes('com.termux') ||
    pathExists('/data/data/com.termux/files/usr/bin');
  return isTermux ? 'termux' : 'linux';
}

module.exports = { detectPlatform };
