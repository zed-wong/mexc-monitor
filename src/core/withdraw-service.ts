import crypto from 'node:crypto';

import type { AccountConfig, AssetRule, Credentials, RuntimeState, WithdrawHistoryItem } from './types';
import type { ExchangeAdapter } from '../exchange/types';
import type { AuditService } from '../services/audit-service';
import type { RuntimeService } from '../services/runtime-service';
import { maskAddress } from '../utils/mask';
import { nowIso } from '../utils/time';
import { decimal } from '../utils/decimal';

export class WithdrawService {
  constructor(
    private readonly exchange: ExchangeAdapter,
    private readonly auditService: AuditService,
    private readonly runtimeService: RuntimeService,
  ) {}

  async execute(account: AccountConfig, rule: AssetRule, runtime: RuntimeState, credentials: Credentials, amount: string): Promise<void> {
    const scope = { accountName: account.name, asset: rule.asset };
    const operationId = crypto.randomUUID();
    const createdAt = nowIso();
    const addressMasked = maskAddress(rule.withdrawAddress);
    const quoteAsset = 'USDT';
    let quotePrice: string | null = null;
    try {
      quotePrice = await this.exchange.fetchQuotePrice(rule.asset, quoteAsset);
    } catch {
      quotePrice = null;
    }
    const estimatedValue = quotePrice ? decimal(amount).mul(quotePrice).toFixed() : undefined;

    this.runtimeService.updateRuntime(scope, {
      ...runtime,
      withdrawInProgress: true,
    });

    if (account.mode === 'dry_run') {
      const item: WithdrawHistoryItem = {
        accountName: account.name,
        createdAt,
        operationId,
        exchangeId: account.exchangeId,
        mode: account.mode,
        asset: rule.asset,
        network: rule.network,
        amount,
        quoteAsset: quotePrice ? quoteAsset : undefined,
        quotePrice: quotePrice ?? undefined,
        estimatedValue,
        addressMasked,
        status: 'simulated',
        reason: 'dry_run',
      };

      this.auditService.recordWithdraw(item);
      this.auditService.log('info', 'withdraw.simulated', `Simulated withdraw ${amount} ${rule.asset}`, undefined, scope);
      this.runtimeService.updateRuntime(scope, {
        ...runtime,
        withdrawInProgress: false,
        cooldownUntil: new Date(Date.now() + account.withdrawCooldownMs).toISOString(),
      });
      void credentials;
      return;
    }

    try {
      const result = await this.exchange.withdraw({
        asset: rule.asset,
        amount,
        address: rule.withdrawAddress,
        tag: rule.withdrawTag,
        network: rule.network,
      });

      this.auditService.recordWithdraw({
        accountName: account.name,
        createdAt,
        operationId,
        exchangeId: account.exchangeId,
        mode: account.mode,
        asset: rule.asset,
        network: rule.network,
        amount,
        quoteAsset: quotePrice ? quoteAsset : undefined,
        quotePrice: quotePrice ?? undefined,
        estimatedValue,
        addressMasked,
        status: 'success',
        txid: result.txid,
        rawResponseJson: JSON.stringify(result.raw),
      });
      this.auditService.log('info', 'withdraw.success', `Withdraw succeeded for ${amount} ${rule.asset}`, undefined, scope);
      this.runtimeService.updateRuntime(scope, {
        ...runtime,
        withdrawInProgress: false,
        cooldownUntil: new Date(Date.now() + account.withdrawCooldownMs).toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.auditService.recordWithdraw({
        accountName: account.name,
        createdAt,
        operationId,
        exchangeId: account.exchangeId,
        mode: account.mode,
        asset: rule.asset,
        network: rule.network,
        amount,
        quoteAsset: quotePrice ? quoteAsset : undefined,
        quotePrice: quotePrice ?? undefined,
        estimatedValue,
        addressMasked,
        status: 'failed',
        errorMessage: message,
      });
      this.auditService.log('error', 'withdraw.failed', message, undefined, scope);
      this.runtimeService.updateRuntime(scope, {
        ...runtime,
        withdrawInProgress: false,
        lastError: message,
      });
    }
  }
}
