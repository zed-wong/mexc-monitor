import { describe, expect, test } from 'bun:test';

import { computeWithdrawAmount } from '../src/core/amount-policy';
import type { AssetRule } from '../src/core/types';

const baseRule: AssetRule = {
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

describe('computeWithdrawAmount', () => {
  test('returns null when balance does not exceed max', () => {
    expect(computeWithdrawAmount('1000', baseRule)).toBeNull();
    expect(computeWithdrawAmount('999.999', baseRule)).toBeNull();
  });

  test('returns the amount needed to return to target balance', () => {
    expect(computeWithdrawAmount('1200', baseRule)).toBe('1000');
    expect(computeWithdrawAmount('1000.5', baseRule)).toBe('800.5');
  });

  test('returns the amount needed to return to target USDT value', () => {
    expect(computeWithdrawAmount('2', {
      ...baseRule,
      maxBalance: '999999999',
      targetBalance: '0',
      maxBalanceUsdt: '100',
      targetBalanceUsdt: '50',
    }, '60')).toBe('1.1666666666666666667');
  });
});
