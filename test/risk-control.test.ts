import { describe, expect, test } from 'bun:test';

import { RiskControl } from '../src/core/risk-control';
import type { AccountConfig, AssetRule, Credentials, RuntimeState } from '../src/core/types';

const account: AccountConfig = {
  name: 'main',
  exchangeId: 'mexc',
  checkIntervalMs: 30000,
  withdrawCooldownMs: 600000,
  mode: 'dry_run',
};

const rule: AssetRule = {
  accountName: 'main',
  exchangeId: 'mexc',
  asset: 'USDT',
  network: 'ERC20',
  withdrawAddress: '0xabc',
  targetBalance: '200',
  maxBalance: '1000',
  minWithdrawAmount: '10',
  maxWithdrawAmount: '500',
  enabled: true,
};

const credentials: Credentials = {
  apiKey: 'key',
  apiSecret: 'secret',
};

const healthyRuntime: RuntimeState = {
  paused: false,
  withdrawInProgress: false,
  apiStatus: 'healthy',
};

describe('RiskControl', () => {
  const riskControl = new RiskControl();

  test('rejects when cooldown is still active', () => {
    const decision = riskControl.evaluate({
      account,
      rule,
      runtime: {
        ...healthyRuntime,
        cooldownUntil: new Date(Date.now() + 60_000).toISOString(),
      },
      proposedAmount: '100',
      credentials,
    });

    expect(decision).toEqual({ allowed: false, reason: 'cooldown' });
  });

  test('rejects when amount is outside configured bounds', () => {
    expect(riskControl.evaluate({
      account,
      rule,
      runtime: healthyRuntime,
      proposedAmount: '5',
      credentials,
    })).toEqual({ allowed: false, reason: 'below_min' });

    expect(riskControl.evaluate({
      account,
      rule,
      runtime: healthyRuntime,
      proposedAmount: '600',
      credentials,
    })).toEqual({ allowed: false, reason: 'above_max' });
  });

  test('allows valid withdraws', () => {
    expect(riskControl.evaluate({
      account,
      rule,
      runtime: healthyRuntime,
      proposedAmount: '100',
      credentials,
    })).toEqual({ allowed: true, amount: '100', reason: 'ok' });
  });
});
