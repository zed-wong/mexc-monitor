import type { Exchange, Trade } from 'ccxt';

import type { Credentials } from '../core/types';
import { decimal } from '../utils/decimal';
import type { AssetBalance, ExchangeAdapter, MyTrade } from './types';

export abstract class BaseCcxtAdapter implements ExchangeAdapter {
  abstract readonly id: string;
  protected exchange?: Exchange;
  private readonly quotePriceCache = new Map<string, Promise<string | null>>();

  protected abstract createExchange(credentials: Credentials): Exchange;

  protected normalizeTrade(trade: Trade): MyTrade {
    const tradeRecord = trade as unknown as Record<string, unknown>;
    const clientOrderId = 'clientOrderId' in tradeRecord
      ? tradeRecord.clientOrderId
      : undefined;

    return {
      id: trade.id ? String(trade.id) : undefined,
      orderId: trade.order ? String(trade.order) : undefined,
      clientOrderId: clientOrderId ? String(clientOrderId) : undefined,
      symbol: trade.symbol,
      side: trade.side,
      type: trade.type,
      takerOrMaker: trade.takerOrMaker,
      timestamp: trade.timestamp ?? 0,
      datetime: trade.datetime,
      price: trade.price !== undefined ? decimal(String(trade.price)).toFixed() : undefined,
      amount: trade.amount !== undefined ? decimal(String(trade.amount)).toFixed() : undefined,
      cost: trade.cost !== undefined ? decimal(String(trade.cost)).toFixed() : undefined,
      feeCost: trade.fee?.cost !== undefined ? decimal(String(trade.fee.cost)).toFixed() : undefined,
      feeCurrency: trade.fee?.currency,
      info: trade.info,
    };
  }

  async init(credentials: Credentials): Promise<void> {
    this.exchange = this.createExchange(credentials);
    this.quotePriceCache.clear();
    await this.exchange.loadMarkets();
  }

  async fetchFreeBalance(asset: string): Promise<string> {
    const balances = await this.fetchAllFreeBalances();
    return balances.find((item) => item.asset === asset)?.free ?? '0';
  }

  async fetchAllFreeBalances(): Promise<AssetBalance[]> {
    if (!this.exchange) {
      throw new Error('Exchange not initialized');
    }

    const balance = await this.exchange.fetchBalance();
    const freeBalances = balance.free as unknown as Record<string, string | number | undefined> | undefined;
    const usedBalances = balance.used as unknown as Record<string, string | number | undefined> | undefined;
    const totalBalances = balance.total as unknown as Record<string, string | number | undefined> | undefined;
    const assets = new Set([
      ...Object.keys(freeBalances ?? {}),
      ...Object.keys(usedBalances ?? {}),
      ...Object.keys(totalBalances ?? {}),
    ]);

    return [...assets]
      .map((asset) => {
        const free = decimal(String(freeBalances?.[asset] ?? '0')).toFixed();
        const used = decimal(String(usedBalances?.[asset] ?? '0')).toFixed();
        const total = decimal(String(totalBalances?.[asset] ?? decimal(free).plus(used).toFixed())).toFixed();
        return { asset, free, used, total };
      })
      .filter((item) => decimal(item.total).gt(0));
  }

  async fetchQuotePrice(asset: string, quoteAsset: string): Promise<string | null> {
    if (!this.exchange) {
      throw new Error('Exchange not initialized');
    }

    if (asset === quoteAsset) {
      return '1';
    }

    const symbol = `${asset}/${quoteAsset}`;
    const cached = this.quotePriceCache.get(symbol);
    if (cached) {
      return cached;
    }

    if (!(symbol in this.exchange.markets)) {
      return null;
    }

    const pricePromise = this.exchange.fetchTicker(symbol)
      .then((ticker) => {
        const price = typeof ticker.last === 'number' || typeof ticker.last === 'string'
          ? ticker.last
          : typeof ticker.close === 'number' || typeof ticker.close === 'string'
            ? ticker.close
            : undefined;

        return price !== undefined ? decimal(String(price)).toFixed() : null;
      })
      .catch((error) => {
        this.quotePriceCache.delete(symbol);
        throw error;
      });

    this.quotePriceCache.set(symbol, pricePromise);
    return pricePromise;
  }

  async fetchMyTrades(input: { symbol: string; since?: number; until?: number; limit?: number }): Promise<MyTrade[]> {
    if (!this.exchange) {
      throw new Error('Exchange not initialized');
    }

    const trades = await this.exchange.fetchMyTrades(
      input.symbol,
      input.since,
      input.limit,
      input.until !== undefined ? { until: input.until } : {},
    );

    return trades.map((trade) => this.normalizeTrade(trade));
  }

  abstract withdraw(input: Parameters<ExchangeAdapter['withdraw']>[0]): ReturnType<ExchangeAdapter['withdraw']>;
  abstract validateConfig(input: Parameters<ExchangeAdapter['validateConfig']>[0]): ReturnType<ExchangeAdapter['validateConfig']>;
  abstract healthCheck(): Promise<void>;
}
