import { describe, expect, test } from 'bun:test';
import type { Exchange } from 'ccxt';

import type { Credentials } from '../src/core/types';
import { BaseCcxtAdapter } from '../src/exchange/base-ccxt-adapter';
import type { WithdrawInput, WithdrawResult } from '../src/exchange/types';

class TestCcxtAdapter extends BaseCcxtAdapter {
  readonly id = 'test';

  constructor(private readonly exchangeInstance: Exchange) {
    super();
    this.exchange = exchangeInstance;
  }

  protected createExchange(_credentials: Credentials): Exchange {
    return this.exchangeInstance;
  }

  async withdraw(_input: WithdrawInput): Promise<WithdrawResult> {
    return { raw: null };
  }

  async validateConfig(): Promise<void> {}

  async healthCheck(): Promise<void> {}
}

describe('BaseCcxtAdapter', () => {
  test('preserves decimal precision when reading free balances', async () => {
    const exchange = {
      fetchBalance: async () => ({
        free: {
          BTC: '0.00000001',
          ETH: 1.25,
          USDT: '0',
        },
      }),
    } as unknown as Exchange;

    const adapter = new TestCcxtAdapter(exchange);
    await expect(adapter.fetchAllFreeBalances()).resolves.toEqual([
      { asset: 'BTC', free: '0.00000001' },
      { asset: 'ETH', free: '1.25' },
    ]);
  });

  test('normalizes quote prices without native number math', async () => {
    const exchange = {
      markets: {
        'BTC/USDT': {},
      },
      fetchTicker: async () => ({
        last: '63000.12345678',
      }),
    } as unknown as Exchange;

    const adapter = new TestCcxtAdapter(exchange);
    await expect(adapter.fetchQuotePrice('BTC', 'USDT')).resolves.toBe('63000.12345678');
  });
});
