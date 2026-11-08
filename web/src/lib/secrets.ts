import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env } from './env';

export interface EnvEntry {
  key: string;
  value: string;
}

function encryptionKey(): Buffer {
  return Buffer.from(hkdfSync('sha256', env.sessionSecret, 'serverhub', 'project-env', 32));
}

// В базе значения .env лежат только зашифрованными и только пока агент не забрал команду.
export function encryptEnv(entries: EnvEntry[]): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(entries), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decryptEnv(token: string): EnvEntry[] {
  const [iv, tag, ciphertext] = token.split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plain) as EnvEntry[];
}
