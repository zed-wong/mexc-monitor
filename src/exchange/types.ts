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

export interface AssetBalance {
  asset: string;
  free: string;
}

export interface ExchangeAdapter {
  readonly id: string;
  init(credentials: Credentials): Promise<void>;
  fetchFreeBalance(asset: string): Promise<string>;
  fetchAllFreeBalances(): Promise<AssetBalance[]>;
  withdraw(input: WithdrawInput): Promise<WithdrawResult>;
  validateConfig(input: { asset: string; network: string; address: string }): Promise<void>;
  healthCheck(): Promise<void>;
}
