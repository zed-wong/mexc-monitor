import type { Database } from 'bun:sqlite';

import type { AccountConfig } from '../../core/types';
import type { StoredSecrets } from '../types';
import { nowIso } from '../../utils/time';

export interface StoredAccount extends AccountConfig, StoredSecrets {}

export class AccountRepo {
  constructor(private readonly db: Database) {}

  get(name: string): StoredAccount | null {
    const row = this.db.prepare('SELECT * FROM account WHERE name = ?').get(name) as Record<string, unknown> | null;
    if (!row) {
      return null;
    }

    return {
      name: String(row.name),
      exchangeId: String(row.exchange_id),
      checkIntervalMs: Number(row.check_interval_ms),
      withdrawCooldownMs: Number(row.withdraw_cooldown_ms),
      mode: row.mode as AccountConfig['mode'],
      encryptedCredentials: row.encrypted_credentials as Buffer,
      credentialsIv: row.credentials_iv as Buffer,
      credentialsTag: row.credentials_tag as Buffer,
      kdfSalt: row.kdf_salt as Buffer,
    };
  }

  list(): StoredAccount[] {
    const rows = this.db.prepare('SELECT * FROM account ORDER BY name ASC').all() as Record<string, unknown>[];
    return rows.map((row) => ({
      name: String(row.name),
      exchangeId: String(row.exchange_id),
      checkIntervalMs: Number(row.check_interval_ms),
      withdrawCooldownMs: Number(row.withdraw_cooldown_ms),
      mode: row.mode as AccountConfig['mode'],
      encryptedCredentials: row.encrypted_credentials as Buffer,
      credentialsIv: row.credentials_iv as Buffer,
      credentialsTag: row.credentials_tag as Buffer,
      kdfSalt: row.kdf_salt as Buffer,
    }));
  }

  save(account: AccountConfig, secrets: StoredSecrets): void {
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO account (
        name, exchange_id, check_interval_ms, withdraw_cooldown_ms, mode,
        encrypted_credentials, credentials_iv, credentials_tag, kdf_salt, created_at, updated_at
      ) VALUES (
        @name, @exchange_id, @check_interval_ms, @withdraw_cooldown_ms, @mode,
        @encrypted_credentials, @credentials_iv, @credentials_tag, @kdf_salt, @created_at, @updated_at
      )
      ON CONFLICT(name) DO UPDATE SET
        exchange_id = excluded.exchange_id,
        check_interval_ms = excluded.check_interval_ms,
        withdraw_cooldown_ms = excluded.withdraw_cooldown_ms,
        mode = excluded.mode,
        encrypted_credentials = excluded.encrypted_credentials,
        credentials_iv = excluded.credentials_iv,
        credentials_tag = excluded.credentials_tag,
        kdf_salt = excluded.kdf_salt,
        updated_at = excluded.updated_at
    `).run({
      name: account.name,
      exchange_id: account.exchangeId,
      check_interval_ms: account.checkIntervalMs,
      withdraw_cooldown_ms: account.withdrawCooldownMs,
      mode: account.mode,
      encrypted_credentials: secrets.encryptedCredentials,
      credentials_iv: secrets.credentialsIv,
      credentials_tag: secrets.credentialsTag,
      kdf_salt: secrets.kdfSalt,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  remove(name: string): void {
    this.db.prepare('DELETE FROM account WHERE name = ?').run(name);
  }

  rename(from: string, to: string): void {
    const existing = this.get(from);
    if (!existing) {
      throw new Error(`Account not found: ${from}`);
    }

    if (from === to) {
      return;
    }

    if (this.get(to)) {
      throw new Error(`Account already exists: ${to}`);
    }

    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO account (
        name, exchange_id, check_interval_ms, withdraw_cooldown_ms, mode,
        encrypted_credentials, credentials_iv, credentials_tag, kdf_salt, created_at, updated_at
      ) VALUES (
        @name, @exchange_id, @check_interval_ms, @withdraw_cooldown_ms, @mode,
        @encrypted_credentials, @credentials_iv, @credentials_tag, @kdf_salt, @created_at, @updated_at
      )
    `).run({
      name: to,
      exchange_id: existing.exchangeId,
      check_interval_ms: existing.checkIntervalMs,
      withdraw_cooldown_ms: existing.withdrawCooldownMs,
      mode: existing.mode,
      encrypted_credentials: existing.encryptedCredentials,
      credentials_iv: existing.credentialsIv,
      credentials_tag: existing.credentialsTag,
      kdf_salt: existing.kdfSalt,
      created_at: timestamp,
      updated_at: timestamp,
    });

    this.remove(from);
  }
}
