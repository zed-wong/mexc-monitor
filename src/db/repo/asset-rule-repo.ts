import type { Database } from 'bun:sqlite';

import type { AssetRule } from '../../core/types';

export class AssetRuleRepo {
  constructor(private readonly db: Database) {}

  list(accountName?: string): AssetRule[] {
    const rows = (
      accountName
        ? this.db.prepare('SELECT * FROM asset_rules WHERE account_name = ? ORDER BY asset ASC').all(accountName)
        : this.db.prepare('SELECT * FROM asset_rules ORDER BY account_name ASC, asset ASC').all()
    ) as Record<string, unknown>[];
    return rows.map((row) => ({
      accountName: String(row.account_name),
      exchangeId: String(row.exchange_id),
      asset: String(row.asset),
      network: String(row.network),
      withdrawAddress: String(row.withdraw_address),
      withdrawTag: row.withdraw_tag ? String(row.withdraw_tag) : undefined,
      targetBalance: String(row.target_balance),
      maxBalance: String(row.max_balance),
      targetBalanceUsdt: row.target_balance_usdt ? String(row.target_balance_usdt) : undefined,
      maxBalanceUsdt: row.max_balance_usdt ? String(row.max_balance_usdt) : undefined,
      minWithdrawAmount: String(row.min_withdraw_amount),
      maxWithdrawAmount: String(row.max_withdraw_amount),
      enabled: Boolean(row.enabled),
    }));
  }

  save(rule: AssetRule): void {
    this.db.prepare(`
      INSERT INTO asset_rules (
        account_name, exchange_id, asset, network, withdraw_address, withdraw_tag,
        target_balance, max_balance, target_balance_usdt, max_balance_usdt, min_withdraw_amount, max_withdraw_amount, enabled
      ) VALUES (
        @account_name, @exchange_id, @asset, @network, @withdraw_address, @withdraw_tag,
        @target_balance, @max_balance, @target_balance_usdt, @max_balance_usdt, @min_withdraw_amount, @max_withdraw_amount, @enabled
      )
      ON CONFLICT(account_name, asset) DO UPDATE SET
        exchange_id = excluded.exchange_id,
        network = excluded.network,
        withdraw_address = excluded.withdraw_address,
        withdraw_tag = excluded.withdraw_tag,
        target_balance = excluded.target_balance,
        max_balance = excluded.max_balance,
        target_balance_usdt = excluded.target_balance_usdt,
        max_balance_usdt = excluded.max_balance_usdt,
        min_withdraw_amount = excluded.min_withdraw_amount,
        max_withdraw_amount = excluded.max_withdraw_amount,
        enabled = excluded.enabled
    `).run({
      account_name: rule.accountName,
      exchange_id: rule.exchangeId,
      asset: rule.asset,
      network: rule.network,
      withdraw_address: rule.withdrawAddress,
      withdraw_tag: rule.withdrawTag ?? null,
      target_balance: rule.targetBalance,
      max_balance: rule.maxBalance,
      target_balance_usdt: rule.targetBalanceUsdt ?? null,
      max_balance_usdt: rule.maxBalanceUsdt ?? null,
      min_withdraw_amount: rule.minWithdrawAmount,
      max_withdraw_amount: rule.maxWithdrawAmount,
      enabled: rule.enabled ? 1 : 0,
    });
  }

  remove(accountName: string, asset: string): void {
    this.db.prepare('DELETE FROM asset_rules WHERE account_name = ? AND asset = ?').run(accountName, asset);
  }

  renameAccount(from: string, to: string): void {
    if (from === to) {
      return;
    }

    const rules = this.list(from);
    for (const rule of rules) {
      this.save({
        ...rule,
        accountName: to,
      });
    }

    this.db.prepare('DELETE FROM asset_rules WHERE account_name = ?').run(from);
  }
}
