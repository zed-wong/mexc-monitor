import type { Credentials } from '../core/types';

export interface WithdrawInput {
  asset: string;
  amount: string;
  address: string;
  tag?: string;
  network: string;
}

export interface WithdrawResult {
  txid?: string;
  raw: unknown;
}

export interface MyTrade {
  id?: string;
  orderId?: string;
  clientOrderId?: string;
  symbol?: string;
  side?: string;
  type?: string;
  takerOrMaker?: string;
  timestamp: number;
  datetime?: string;
  price?: string;
  amount?: string;
  cost?: string;
  feeCost?: string;
  feeCurrency?: string;
  info: unknown;
}

export interface AssetBalance {
  asset: string;
  free: string;
  used: string;
  total: string;
}

export interface ExchangeAdapter {
  readonly id: string;
  init(credentials: Credentials): Promise<void>;
  fetchFreeBalance(asset: string): Promise<string>;
  fetchAllFreeBalances(): Promise<AssetBalance[]>;
  fetchQuotePrice(asset: string, quoteAsset: string): Promise<string | null>;
  fetchMyTrades(input: { symbol: string; since?: number; until?: number; limit?: number }): Promise<MyTrade[]>;
  withdraw(input: WithdrawInput): Promise<WithdrawResult>;
  validateConfig(input: { asset: string; network: string; address: string }): Promise<void>;
  healthCheck(): Promise<void>;
}
