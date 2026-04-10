import type { AccountConfig, AssetRule, Credentials, RiskDecision, RuntimeState } from './types';
import { decimal } from '../utils/decimal';

export class RiskControl {
  evaluate(input: {
    account: AccountConfig;
    rule: AssetRule;
    runtime: RuntimeState;
    proposedAmount: string;
    credentials: Credentials | null;
  }): RiskDecision {
    const { account, rule, runtime, proposedAmount, credentials } = input;
    void account;

    if (!credentials) {
      return { allowed: false, reason: 'locked' };
    }

    if (!rule.enabled) {
      return { allowed: false, reason: 'disabled' };
    }

    if (runtime.paused) {
      return { allowed: false, reason: 'paused' };
    }

    if (runtime.withdrawInProgress) {
      return { allowed: false, reason: 'already_withdrawing' };
    }

    if (runtime.cooldownUntil && new Date(runtime.cooldownUntil).getTime() > Date.now()) {
      return { allowed: false, reason: 'cooldown' };
    }

    const amount = decimal(proposedAmount);
    if (amount.lt(rule.minWithdrawAmount)) {
      return { allowed: false, reason: 'below_min' };
    }

    if (amount.gt(rule.maxWithdrawAmount)) {
      return { allowed: false, reason: 'above_max' };
    }

    return { allowed: true, amount: amount.toFixed(), reason: 'ok' };
  }
}
