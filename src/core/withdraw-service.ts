import crypto from 'node:crypto';

import type { AccountConfig, AssetRule, Credentials, RuntimeState, WithdrawHistoryItem } from './types';
import type { ExchangeAdapter } from '../exchange/types';
import type { AuditService } from '../services/audit-service';
import type { RuntimeService } from '../services/runtime-service';
import { maskAddress } from '../utils/mask';
import { nowIso } from '../utils/time';

export class WithdrawService {
  constructor(
    private readonly exchange: ExchangeAdapter,
    private readonly auditService: AuditService,
    private readonly runtimeService: RuntimeService,
  ) {}

  async execute(account: AccountConfig, rule: AssetRule, runtime: RuntimeState, credentials: Credentials, amount: string): Promise<void> {
    const operationId = crypto.randomUUID();
    const createdAt = nowIso();
    const addressMasked = maskAddress(rule.withdrawAddress);

    this.runtimeService.updateRuntime({
      ...runtime,
      withdrawInProgress: true,
    });

    if (account.mode === 'dry_run') {
      const item: WithdrawHistoryItem = {
        createdAt,
        operationId,
        exchangeId: account.exchangeId,
        mode: account.mode,
        asset: rule.asset,
        network: rule.network,
        amount,
        addressMasked,
        status: 'simulated',
        reason: 'dry_run',
      };

      this.auditService.recordWithdraw(item);
      this.auditService.log('info', 'withdraw.simulated', `Simulated withdraw ${amount} ${rule.asset}`);
      this.runtimeService.updateRuntime({
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
        createdAt,
        operationId,
        exchangeId: account.exchangeId,
        mode: account.mode,
        asset: rule.asset,
        network: rule.network,
        amount,
        addressMasked,
        status: 'success',
        txid: result.txid,
        rawResponseJson: JSON.stringify(result.raw),
      });
      this.auditService.log('info', 'withdraw.success', `Withdraw succeeded for ${amount} ${rule.asset}`);
      this.runtimeService.updateRuntime({
        ...runtime,
        withdrawInProgress: false,
        cooldownUntil: new Date(Date.now() + account.withdrawCooldownMs).toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.auditService.recordWithdraw({
        createdAt,
        operationId,
        exchangeId: account.exchangeId,
        mode: account.mode,
        asset: rule.asset,
        network: rule.network,
        amount,
        addressMasked,
        status: 'failed',
        errorMessage: message,
      });
      this.auditService.log('error', 'withdraw.failed', message);
      this.runtimeService.updateRuntime({
        ...runtime,
        withdrawInProgress: false,
        lastError: message,
      });
    }
  }
}
