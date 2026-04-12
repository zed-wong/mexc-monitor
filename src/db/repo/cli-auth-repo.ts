import type { Database } from 'bun:sqlite';

import type { StoredCliAuth } from '../types';
import { nowIso } from '../../utils/time';

export class CliAuthRepo {
  constructor(private readonly db: Database) {}

  get(): StoredCliAuth | null {
    const row = this.db.prepare('SELECT * FROM cli_auth WHERE id = 1').get() as Record<string, unknown> | null;
    if (!row) {
      return null;
    }

    return {
      passwordHash: row.password_hash as Buffer,
      kdfSalt: row.kdf_salt as Buffer,
    };
  }

  save(auth: StoredCliAuth): void {
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO cli_auth (id, password_hash, kdf_salt, created_at, updated_at)
      VALUES (1, @password_hash, @kdf_salt, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        password_hash = excluded.password_hash,
        kdf_salt = excluded.kdf_salt,
        updated_at = excluded.updated_at
    `).run({
      password_hash: auth.passwordHash,
      kdf_salt: auth.kdfSalt,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }
}
