import type { Database } from 'bun:sqlite';

import type { RuntimeScope, RuntimeState, ScopedRuntimeState } from '../../core/types';
import { nowIso } from '../../utils/time';

export class RuntimeRepo {
  constructor(private readonly db: Database) {}

  private ensureScope(scope: RuntimeScope): void {
    this.db.prepare(
      `INSERT INTO runtime_state (
        account_name, asset, paused, withdraw_in_progress, api_status, updated_at
      ) VALUES (@account_name, @asset, 0, 0, 'unknown', @updated_at)
      ON CONFLICT(account_name, asset) DO NOTHING`,
    ).run({
      account_name: scope.accountName,
      asset: scope.asset,
      updated_at: nowIso(),
    });
  }

  get(scope: RuntimeScope): RuntimeState {
    this.ensureScope(scope);
    const row = this.db
      .prepare(`SELECT * FROM runtime_state WHERE account_name = ? AND asset = ?`)
      .get(scope.accountName, scope.asset) as Record<string, unknown>;

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

  update(scope: RuntimeScope, runtime: RuntimeState): void {
    this.ensureScope(scope);
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
       WHERE account_name = @account_name AND asset = @asset`,
    ).run({
      account_name: scope.accountName,
      asset: scope.asset,
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

  list(filter?: Partial<RuntimeScope>): ScopedRuntimeState[] {
    const where: string[] = [];
    const params: Array<string> = [];

    if (filter?.accountName) {
      where.push('account_name = ?');
      params.push(filter.accountName);
    }

    if (filter?.asset) {
      where.push('asset = ?');
      params.push(filter.asset);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const rows = this.db.prepare(
      `SELECT * FROM runtime_state ${clause} ORDER BY account_name ASC, asset ASC`,
    ).all(...params) as Record<string, unknown>[];

    return rows.map((row) => ({
      accountName: String(row.account_name),
      asset: String(row.asset),
      paused: Boolean(row.paused),
      lastBalance: row.last_balance ? String(row.last_balance) : undefined,
      lastCheckAt: row.last_check_at ? String(row.last_check_at) : undefined,
      lastSuccessCheckAt: row.last_success_check_at ? String(row.last_success_check_at) : undefined,
      cooldownUntil: row.cooldown_until ? String(row.cooldown_until) : undefined,
      withdrawInProgress: Boolean(row.withdraw_in_progress),
      apiStatus: row.api_status as RuntimeState['apiStatus'],
      lastError: row.last_error ? String(row.last_error) : undefined,
    }));
  }
}
