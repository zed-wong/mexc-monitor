import { MexcAdapter } from './adapters/mexc-adapter';
import type { ExchangeAdapter } from './types';

export function createExchangeAdapter(exchangeId: string): ExchangeAdapter {
  if (exchangeId === 'mexc') {
    return new MexcAdapter();
  }

  throw new Error(`Unsupported exchange: ${exchangeId}`);
}
