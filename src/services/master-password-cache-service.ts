import fs from 'node:fs';
import path from 'node:path';

import { MASTER_PASSWORD_CACHE_PATH, MASTER_PASSWORD_CACHE_TTL_MS } from '../config/constants';

type CachedMasterPassword = {
  password: string;
  expiresAt: string;
};

export class MasterPasswordCacheService {
  getCachedPassword(now = Date.now()): string | undefined {
    const cached = this.readCache();
    if (!cached) {
      return undefined;
    }

    const expiresAt = Date.parse(cached.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      this.clear();
      return undefined;
    }

    return cached.password || undefined;
  }

  remember(password: string, now = Date.now(), ttlMs = MASTER_PASSWORD_CACHE_TTL_MS): void {
    fs.mkdirSync(path.dirname(MASTER_PASSWORD_CACHE_PATH), { recursive: true });
    fs.writeFileSync(
      MASTER_PASSWORD_CACHE_PATH,
      JSON.stringify({
        password,
        expiresAt: new Date(now + ttlMs).toISOString(),
      } satisfies CachedMasterPassword),
      { encoding: 'utf8', mode: 0o600 },
    );
    fs.chmodSync(MASTER_PASSWORD_CACHE_PATH, 0o600);
  }

  clear(): void {
    fs.rmSync(MASTER_PASSWORD_CACHE_PATH, { force: true });
  }

  private readCache(): CachedMasterPassword | null {
    try {
      const raw = fs.readFileSync(MASTER_PASSWORD_CACHE_PATH, 'utf8');
      return JSON.parse(raw) as CachedMasterPassword;
    } catch {
      return null;
    }
  }
}
