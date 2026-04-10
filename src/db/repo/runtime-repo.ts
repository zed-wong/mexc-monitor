import type { Database } from 'bun:sqlite';

import { RUNTIME_ROW_ID } from '../../config/constants';
import type { RuntimeState } from '../../core/types';
import { nowIso } from '../../utils/time';

export class RuntimeRepo {
  constructor(private readonly db: Database) {}

  init(): void {
    this.db.prepare(
      `INSERT INTO runtime_state (
        id, paused, withdraw_in_progress, api_status, updated_at
      ) VALUES (?, 0, 0, 'unknown', ?)
      ON CONFLICT(id) DO NOTHING`,
    ).run(RUNTIME_ROW_ID, nowIso());
  }

  get(): RuntimeState {
    const row = this.db
      .prepare(`SELECT * FROM runtime_state WHERE id = ?`)
      .get(RUNTIME_ROW_ID) as Record<string, unknown>;

    return {
      paused: Boolean(row.paused),
      lastBalance: row.last_balance ? String(row.last_balance) : undefined,
      lastCheckAt: row.last_check_at ? String(row.last_check_at) : undefined,
      lastSuccessCheckAt: row.last_success_check_at ? String(row.last_success_check_at) : undefined,
      cooldownUntil: row.cooldown_until ? String(row.cooldown_until) : undefined,
      withdrawInProgress: Boolean(row.withdraw_in_progress),
      apiStatus: row.api_status as RuntimeState['apiStatus'],
      lastError: row.last_error ? String(row.last_error) : undefined,
    };
  }

  update(runtime: RuntimeState): void {
    this.db.prepare(
      `UPDATE runtime_state
       SET paused = @paused,
           last_balance = @last_balance,
           last_check_at = @last_check_at,
           last_success_check_at = @last_success_check_at,
           cooldown_until = @cooldown_until,
           withdraw_in_progress = @withdraw_in_progress,
           api_status = @api_status,
           last_error = @last_error,
           updated_at = @updated_at
       WHERE id = @id`,
    ).run({
      id: RUNTIME_ROW_ID,
      paused: runtime.paused ? 1 : 0,
      last_balance: runtime.lastBalance ?? null,
      last_check_at: runtime.lastCheckAt ?? null,
      last_success_check_at: runtime.lastSuccessCheckAt ?? null,
      cooldown_until: runtime.cooldownUntil ?? null,
      withdraw_in_progress: runtime.withdrawInProgress ? 1 : 0,
      api_status: runtime.apiStatus,
      last_error: runtime.lastError ?? null,
      updated_at: nowIso(),
    });
  }
}
