export type AppMode = 'dry_run' | 'live';
export type ApiStatus = 'unknown' | 'healthy' | 'degraded' | 'error';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type WithdrawStatus = 'simulated' | 'success' | 'failed' | 'rejected';

export interface AccountConfig {
  name: string;
  exchangeId: string;
  checkIntervalMs: number;
  withdrawCooldownMs: number;
  mode: AppMode;
}

export interface AssetRule {
  accountName: string;
  exchangeId: string;
  asset: string;
  network: string;
  withdrawAddress: string;
  withdrawTag?: string;
  targetBalance: string;
  maxBalance: string;
  targetBalanceUsdt?: string;
  maxBalanceUsdt?: string;
  minWithdrawAmount: string;
  maxWithdrawAmount: string;
  enabled: boolean;
}

export interface Credentials {
  apiKey: string;
  apiSecret: string;
}

export interface RuntimeState {
  paused: boolean;
  lastBalance?: string;
  lastCheckAt?: string;
  lastSuccessCheckAt?: string;
  cooldownUntil?: string;
  withdrawInProgress: boolean;
  apiStatus: ApiStatus;
  lastError?: string;
}

export interface RuntimeScope {
  accountName: string;
  asset: string;
}

export interface ScopedRuntimeState extends RuntimeScope, RuntimeState {}

export interface EventLog {
  id?: number;
  accountName?: string;
  asset?: string;
  createdAt: string;
  level: LogLevel;
  type: string;
  message: string;
  metaJson?: string;
}

export interface WithdrawHistoryItem {
  id?: number;
  accountName: string;
  operationId: string;
  createdAt: string;
  exchangeId: string;
  mode: AppMode;
  asset: string;
  network: string;
  amount: string;
  quoteAsset?: string;
  quotePrice?: string;
  estimatedValue?: string;
  addressMasked: string;
  status: WithdrawStatus;
  txid?: string;
  reason?: string;
  errorMessage?: string;
  rawResponseJson?: string;
}

export type RiskDecision =
  | { allowed: true; amount: string; reason: 'ok' }
  | {
      allowed: false;
      reason:
        | 'paused'
        | 'disabled'
        | 'cooldown'
        | 'below_min'
        | 'above_max'
        | 'already_withdrawing'
        | 'invalid_config'
        | 'locked';
    };
