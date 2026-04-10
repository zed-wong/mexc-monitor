import ccxt from 'ccxt';
import type { Exchange } from 'ccxt';

import type { Credentials } from '../../core/types';
import { BaseCcxtAdapter } from '../base-ccxt-adapter';
import type { WithdrawInput, WithdrawResult } from '../types';

export class MexcAdapter extends BaseCcxtAdapter {
  readonly id = 'mexc';

  protected createExchange(credentials: Credentials): Exchange {
    return new ccxt.mexc({
      apiKey: credentials.apiKey,
      secret: credentials.apiSecret,
      enableRateLimit: true,
    });
  }

  async withdraw(input: WithdrawInput): Promise<WithdrawResult> {
    if (!this.exchange) {
      throw new Error('Exchange not initialized');
    }

    const result = await this.exchange.withdraw(
      input.asset,
      Number(input.amount),
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
}
