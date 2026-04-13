import ccxt from 'ccxt';
import type { Exchange } from 'ccxt';

import type { Credentials } from '../../core/types';
import { decimal } from '../../utils/decimal';
import { BaseCcxtAdapter } from '../base-ccxt-adapter';
import type { MyTrade, WithdrawInput, WithdrawResult } from '../types';

export class MexcAdapter extends BaseCcxtAdapter {
  readonly id = 'mexc';

  protected createExchange(credentials: Credentials): Exchange {
    return new ccxt.mexc({
      apiKey: credentials.apiKey,
      secret: credentials.apiSecret,
      enableRateLimit: true,
    });
  }

  async fetchMyTrades(input: { symbol: string; since?: number; until?: number; limit?: number }): Promise<MyTrade[]> {
    if (!this.exchange) {
      throw new Error('Exchange not initialized');
    }

    const now = Date.now();
    const startTime = input.since ?? now - 24 * 60 * 60 * 1000;
    const endTime = input.until ?? now;
    const pageSize = input.limit ?? 1000;
    const maxWindowMs = 60 * 60 * 1000;
    const deduped = new Map<string, MyTrade>();
    let windowStart = startTime;

    while (windowStart <= endTime) {
      const windowEnd = Math.min(windowStart + maxWindowMs - 1, endTime);
      let cursor = windowStart;

      while (cursor <= windowEnd) {
        const batch = await this.exchange.fetchMyTrades(input.symbol, cursor, pageSize, { until: windowEnd });
        if (batch.length === 0) {
          break;
        }

        let maxTimestamp = cursor;
        for (const trade of batch) {
          const normalized = this.normalizeTrade(trade);
          if (normalized.timestamp < startTime || normalized.timestamp > endTime) {
            continue;
          }

          deduped.set(this.buildTradeKey(normalized), normalized);
          if (normalized.timestamp > maxTimestamp) {
            maxTimestamp = normalized.timestamp;
          }
        }

        if (maxTimestamp <= cursor) {
          break;
        }

        cursor = maxTimestamp + 1;
      }

      windowStart = windowEnd + 1;
    }

    return [...deduped.values()].sort((left, right) => left.timestamp - right.timestamp);
  }

  async withdraw(input: WithdrawInput): Promise<WithdrawResult> {
    if (!this.exchange) {
      throw new Error('Exchange not initialized');
    }

    const result = await this.exchange.withdraw(
      input.asset,
      decimal(input.amount).toString() as unknown as number,
      input.address,
      input.tag,
      { network: input.network },
    );

    return {
      txid: typeof result === 'object' && result && 'txid' in result ? String(result.txid) : undefined,
      raw: result,
    };
  }

  async validateConfig(input: { asset: string; network: string; address: string }): Promise<void> {
    if (!input.asset || !input.network || !input.address) {
      throw new Error('Invalid MEXC configuration');
    }
  }

  async healthCheck(): Promise<void> {
    if (!this.exchange) {
      throw new Error('Exchange not initialized');
    }

    await this.exchange.fetchBalance();
  }

  private buildTradeKey(trade: MyTrade): string {
    return [
      trade.id ?? '',
      trade.orderId ?? '',
      trade.timestamp,
      trade.price ?? '',
      trade.amount ?? '',
      trade.side ?? '',
    ].join(':');
  }
}
