import type { Exchange } from 'ccxt';

import type { Credentials } from '../core/types';
import type { ExchangeAdapter } from './types';

export abstract class BaseCcxtAdapter implements ExchangeAdapter {
  abstract readonly id: string;
  protected exchange?: Exchange;

  protected abstract createExchange(credentials: Credentials): Exchange;

  async init(credentials: Credentials): Promise<void> {
    this.exchange = this.createExchange(credentials);
    await this.exchange.loadMarkets();
  }

  async fetchFreeBalance(asset: string): Promise<string> {
    const balances = await this.fetchAllFreeBalances();
    return balances.find((item) => item.asset === asset)?.free ?? '0';
  }

  async fetchAllFreeBalances(): Promise<Array<{ asset: string; free: string }>> {
    if (!this.exchange) {
      throw new Error('Exchange not initialized');
    }

    const balance = await this.exchange.fetchBalance();
    const freeBalances = balance.free as unknown as Record<string, number | undefined> | undefined;
    return Object.entries(freeBalances ?? {})
      .filter(([, free]) => free !== undefined && Number(free) > 0)
      .map(([asset, free]) => ({ asset, free: String(free) }));
  }

  abstract withdraw(input: Parameters<ExchangeAdapter['withdraw']>[0]): ReturnType<ExchangeAdapter['withdraw']>;
  abstract validateConfig(input: Parameters<ExchangeAdapter['validateConfig']>[0]): ReturnType<ExchangeAdapter['validateConfig']>;
  abstract healthCheck(): Promise<void>;
}
