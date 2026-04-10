import crypto from 'node:crypto';

import type { Credentials } from '../core/types';

export interface SealedBox {
  encryptedCredentials: Buffer;
  credentialsIv: Buffer;
  credentialsTag: Buffer;
  kdfSalt: Buffer;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, 32);
}

export function sealCredentials(password: string, credentials: Credentials): SealedBox {
  const kdfSalt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, kdfSalt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(credentials), 'utf8');
  const encryptedCredentials = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const credentialsTag = cipher.getAuthTag();

  return {
    encryptedCredentials,
    credentialsIv: iv,
    credentialsTag,
    kdfSalt,
  };
}

export function unsealCredentials(password: string, sealed: SealedBox): Credentials {
  const key = deriveKey(password, sealed.kdfSalt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, sealed.credentialsIv);
  decipher.setAuthTag(sealed.credentialsTag);
  const decrypted = Buffer.concat([
    decipher.update(sealed.encryptedCredentials),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8')) as Credentials;
}
