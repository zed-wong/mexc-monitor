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

  protected createExchange(credentials: Credentials): Exchange {
    void credentials;
    return this.exchangeInstance;
  }

  async withdraw(input: WithdrawInput): Promise<WithdrawResult> {
    void input;
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
        used: {
          BTC: '0',
          ETH: '0.75',
          USDT: '0',
        },
        total: {
          BTC: '0.00000001',
          ETH: '2',
          USDT: '0',
        },
      }),
    } as unknown as Exchange;

    const adapter = new TestCcxtAdapter(exchange);
    await expect(adapter.fetchAllFreeBalances()).resolves.toEqual([
      { asset: 'BTC', free: '0.00000001', used: '0', total: '0.00000001' },
      { asset: 'ETH', free: '1.25', used: '0.75', total: '2' },
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

  test('caches quote price requests for the same symbol', async () => {
    let calls = 0;
    const exchange = {
      markets: {
        'BTC/USDT': {},
      },
      fetchTicker: async () => {
        calls += 1;
        return {
          last: '63000.12345678',
        };
      },
    } as unknown as Exchange;

    const adapter = new TestCcxtAdapter(exchange);

    await expect(Promise.all([
      adapter.fetchQuotePrice('BTC', 'USDT'),
      adapter.fetchQuotePrice('BTC', 'USDT'),
      adapter.fetchQuotePrice('BTC', 'USDT'),
    ])).resolves.toEqual([
      '63000.12345678',
      '63000.12345678',
      '63000.12345678',
    ]);
    expect(calls).toBe(1);
  });

  test('normalizes my trades into stable string fields', async () => {
    const exchange = {
      fetchMyTrades: async () => ([
        {
          id: 'trade-1',
          order: 'order-1',
          clientOrderId: 'client-1',
          symbol: 'BTC/USDT',
          side: 'buy',
          type: 'limit',
          takerOrMaker: 'taker',
          timestamp: 1712345678901,
          datetime: '2024-04-05T06:54:38.901Z',
          price: '63000.12345678',
          amount: '0.0002',
          cost: '12.600024691356',
          fee: {
            cost: '0.0126',
            currency: 'USDT',
          },
          info: { foo: 'bar' },
        },
      ]),
    } as unknown as Exchange;

    const adapter = new TestCcxtAdapter(exchange);
    await expect(adapter.fetchMyTrades({ symbol: 'BTC/USDT', since: 1712340000000, until: 1712350000000, limit: 200 })).resolves.toEqual([
      {
        id: 'trade-1',
        orderId: 'order-1',
        clientOrderId: 'client-1',
        symbol: 'BTC/USDT',
        side: 'buy',
        type: 'limit',
        takerOrMaker: 'taker',
        timestamp: 1712345678901,
        datetime: '2024-04-05T06:54:38.901Z',
        price: '63000.12345678',
        amount: '0.0002',
        cost: '12.600024691356',
        feeCost: '0.0126',
        feeCurrency: 'USDT',
        info: { foo: 'bar' },
      },
    ]);
  });
});
