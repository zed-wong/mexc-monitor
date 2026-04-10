import type { Database } from 'bun:sqlite';

export function runSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account (
      name TEXT PRIMARY KEY,
      exchange_id TEXT NOT NULL,
      check_interval_ms INTEGER NOT NULL,
      withdraw_cooldown_ms INTEGER NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'live')),
      encrypted_credentials BLOB NOT NULL,
      credentials_iv BLOB NOT NULL,
      credentials_tag BLOB NOT NULL,
      kdf_salt BLOB NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_rules (
      account_name TEXT NOT NULL,
      asset TEXT NOT NULL,
      exchange_id TEXT NOT NULL,
      network TEXT NOT NULL,
      withdraw_address TEXT NOT NULL,
      withdraw_tag TEXT,
      target_balance TEXT NOT NULL,
      max_balance TEXT NOT NULL,
      min_withdraw_amount TEXT NOT NULL,
      max_withdraw_amount TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (account_name, asset)
    );

    CREATE TABLE IF NOT EXISTS runtime_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      paused INTEGER NOT NULL DEFAULT 0,
      last_balance TEXT,
      last_check_at TEXT,
      last_success_check_at TEXT,
      cooldown_until TEXT,
      withdraw_in_progress INTEGER NOT NULL DEFAULT 0,
      api_status TEXT NOT NULL DEFAULT 'unknown',
      last_error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS withdraw_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      exchange_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'live')),
      asset TEXT NOT NULL,
      network TEXT NOT NULL,
      amount TEXT NOT NULL,
      address_masked TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('simulated', 'success', 'failed', 'rejected')),
      txid TEXT,
      reason TEXT,
      error_message TEXT,
      raw_response_json TEXT
    );

    CREATE TABLE IF NOT EXISTS event_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      meta_json TEXT
    );
  `);
}
