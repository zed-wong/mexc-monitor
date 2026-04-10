import type { AccountConfig, AssetRule, Credentials } from './types';
import { computeWithdrawAmount } from './amount-policy';
import { RiskControl } from './risk-control';
import type { StateStore } from './state-store';
import type { ExchangeAdapter } from '../exchange/types';
import type { AuditService } from '../services/audit-service';
import type { RuntimeService } from '../services/runtime-service';
import type { WithdrawService } from './withdraw-service';
import { nowIso, sleep } from '../utils/time';

export class Monitor {
  private running = false;
  private loopPromise?: Promise<void>;

  constructor(
    private readonly exchange: ExchangeAdapter,
    private readonly runtimeService: RuntimeService,
    private readonly withdrawService: WithdrawService,
    private readonly auditService: AuditService,
    private readonly store: StateStore,
    private readonly riskControl: RiskControl,
  ) {}

  start(account: AccountConfig, rule: AssetRule, credentials: Credentials): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.auditService.log('info', 'monitor.started', 'Monitor started');
    this.loopPromise = (async () => {
      while (this.running) {
        await this.tick(account, rule, credentials);
        await sleep(account.checkIntervalMs);
      }
    })();
  }

  stop(): void {
    this.running = false;
  }

  async tick(account: AccountConfig, rule: AssetRule, credentials: Credentials): Promise<void> {
    const runtime = this.runtimeService.getRuntime();
    const now = nowIso();

    try {
      const balance = await this.exchange.fetchFreeBalance(rule.asset);
      const nextRuntime = {
        ...runtime,
        apiStatus: 'healthy' as const,
        lastBalance: balance,
        lastCheckAt: now,
        lastSuccessCheckAt: now,
        lastError: undefined,
      };
      this.runtimeService.updateRuntime(nextRuntime);
      this.store.setRuntime(nextRuntime);
      const amount = computeWithdrawAmount(balance, rule);

      if (!amount) {
        this.auditService.log('info', 'monitor.tick.success', `Account balance ${balance} ${rule.asset}`);
        return;
      }

      const decision = this.riskControl.evaluate({
        account,
        rule,
        runtime: nextRuntime,
        proposedAmount: amount,
        credentials,
      });

      if (!decision.allowed) {
        this.auditService.log('warn', 'withdraw.rejected', `Withdraw rejected: ${decision.reason}`);
        return;
      }

      await this.withdrawService.execute(account, rule, nextRuntime, credentials, decision.amount);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextRuntime = {
        ...runtime,
        apiStatus: 'error' as const,
        lastCheckAt: now,
        lastError: message,
      };
      this.runtimeService.updateRuntime(nextRuntime);
      this.store.setRuntime(nextRuntime);
      this.auditService.log('error', 'monitor.tick.failed', message);
    }
  }
}
