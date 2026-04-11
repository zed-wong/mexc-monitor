import type { Database } from 'bun:sqlite';

import { LOG_LIMIT } from '../../config/constants';
import type { WithdrawHistoryItem } from '../../core/types';

export class WithdrawHistoryRepo {
  constructor(private readonly db: Database) {}

  append(item: WithdrawHistoryItem): void {
    this.db.prepare(
      `INSERT INTO withdraw_history (
        account_name, created_at, operation_id, exchange_id, mode, asset, network, amount,
        address_masked, status, txid, reason, error_message, raw_response_json
      ) VALUES (
        @account_name, @created_at, @operation_id, @exchange_id, @mode, @asset, @network, @amount,
        @address_masked, @status, @txid, @reason, @error_message, @raw_response_json
      )`,
    ).run({
      account_name: item.accountName,
      created_at: item.createdAt,
      operation_id: item.operationId,
      exchange_id: item.exchangeId,
      mode: item.mode,
      asset: item.asset,
      network: item.network,
      amount: item.amount,
      address_masked: item.addressMasked,
      status: item.status,
      txid: item.txid ?? null,
      reason: item.reason ?? null,
      error_message: item.errorMessage ?? null,
      raw_response_json: item.rawResponseJson ?? null,
    });
  }

  listRecent(options?: { limit?: number; accountName?: string; asset?: string; status?: WithdrawHistoryItem['status'] }): WithdrawHistoryItem[] {
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (options?.accountName) {
      where.push('account_name = ?');
      params.push(options.accountName);
    }

    if (options?.asset) {
      where.push('asset = ?');
      params.push(options.asset);
    }

    if (options?.status) {
      where.push('status = ?');
      params.push(options.status);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const limit = options?.limit ?? LOG_LIMIT;
    const rows = this.db
      .prepare(`SELECT * FROM withdraw_history ${clause} ORDER BY id DESC LIMIT ?`)
      .all(...params, limit) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: Number(row.id),
      accountName: String(row.account_name),
      createdAt: String(row.created_at),
      operationId: String(row.operation_id),
      exchangeId: String(row.exchange_id),
      mode: row.mode as WithdrawHistoryItem['mode'],
      asset: String(row.asset),
      network: String(row.network),
      amount: String(row.amount),
      addressMasked: String(row.address_masked),
      status: row.status as WithdrawHistoryItem['status'],
      txid: row.txid ? String(row.txid) : undefined,
      reason: row.reason ? String(row.reason) : undefined,
      errorMessage: row.error_message ? String(row.error_message) : undefined,
      rawResponseJson: row.raw_response_json ? String(row.raw_response_json) : undefined,
    }));
  }
}
