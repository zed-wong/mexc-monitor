import type { Exchange } from 'ccxt';

import type { Credentials } from '../core/types';
import { decimal } from '../utils/decimal';
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
    const freeBalances = balance.free as unknown as Record<string, string | number | undefined> | undefined;
    return Object.entries(freeBalances ?? {})
      .filter(([, free]) => free !== undefined && decimal(String(free)).gt(0))
      .map(([asset, free]) => ({ asset, free: decimal(String(free)).toFixed() }));
  }

  async fetchQuotePrice(asset: string, quoteAsset: string): Promise<string | null> {
    if (!this.exchange) {
      throw new Error('Exchange not initialized');
    }

    if (asset === quoteAsset) {
      return '1';
    }

    const symbol = `${asset}/${quoteAsset}`;
    if (!(symbol in this.exchange.markets)) {
      return null;
    }

    const ticker = await this.exchange.fetchTicker(symbol);
    const price = typeof ticker.last === 'number' || typeof ticker.last === 'string'
      ? ticker.last
      : typeof ticker.close === 'number' || typeof ticker.close === 'string'
        ? ticker.close
        : undefined;

    return price !== undefined ? decimal(String(price)).toFixed() : null;
  }

  abstract withdraw(input: Parameters<ExchangeAdapter['withdraw']>[0]): ReturnType<ExchangeAdapter['withdraw']>;
  abstract validateConfig(input: Parameters<ExchangeAdapter['validateConfig']>[0]): ReturnType<ExchangeAdapter['validateConfig']>;
  abstract healthCheck(): Promise<void>;
}
