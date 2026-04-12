import { z } from 'zod';

import type { AccountConfig, AssetRule } from '../core/types';
import type { StoredSecrets } from '../db/types';
import type { AccountRepo } from '../db/repo/account-repo';
import type { AssetRuleRepo } from '../db/repo/asset-rule-repo';
import { decimal } from '../utils/decimal';

const amountString = z.string().min(1).refine((value) => {
  try {
    return decimal(value).gte(0);
  } catch {
    return false;
  }
}, {
  message: 'must be a valid non-negative decimal string',
});

const accountSchema = z.object({
  name: z.string().min(1),
  exchangeId: z.string().min(1),
  checkIntervalMs: z.number().int().positive(),
  withdrawCooldownMs: z.number().int().nonnegative(),
  mode: z.enum(['dry_run', 'live']),
});

const assetRuleSchema = z.object({
  exchangeId: z.string().min(1),
  asset: z.string().min(1),
  network: z.string().min(1),
  withdrawAddress: z.string().min(1),
  withdrawTag: z.string().optional(),
  targetBalance: amountString,
  maxBalance: amountString,
  targetBalanceUsdt: amountString.optional(),
  maxBalanceUsdt: amountString.optional(),
  minWithdrawAmount: amountString,
  maxWithdrawAmount: amountString,
  enabled: z.boolean(),
}).refine((value) => decimal(value.targetBalance).lte(value.maxBalance), {
  message: 'targetBalance must be <= maxBalance',
}).refine((value) => {
  if (!value.targetBalanceUsdt && !value.maxBalanceUsdt) {
    return true;
  }

  if (!value.targetBalanceUsdt || !value.maxBalanceUsdt) {
    return false;
  }

  return decimal(value.targetBalanceUsdt).lte(value.maxBalanceUsdt);
}, {
  message: 'targetBalanceUsdt and maxBalanceUsdt must both be set and targetBalanceUsdt must be <= maxBalanceUsdt',
}).refine((value) => decimal(value.minWithdrawAmount).lte(value.maxWithdrawAmount), {
  message: 'minWithdrawAmount must be <= maxWithdrawAmount',
});

export class ConfigService {
  constructor(
    private readonly accountRepo: AccountRepo,
    private readonly assetRuleRepo: AssetRuleRepo,
  ) {}

  getAccount(name: string): AccountConfig | null {
    const stored = this.accountRepo.get(name);

    if (!stored) {
      return null;
    }

    return {
      name: stored.name,
      exchangeId: stored.exchangeId,
      checkIntervalMs: stored.checkIntervalMs,
      withdrawCooldownMs: stored.withdrawCooldownMs,
      mode: stored.mode,
    };
  }

  getSecrets(): StoredSecrets | null {
    throw new Error('Use getSecretsForAccount(name)');
  }

  getSecretsForAccount(name: string): StoredSecrets | null {
    const stored = this.accountRepo.get(name);

    if (!stored) {
      return null;
    }

    return {
      encryptedCredentials: stored.encryptedCredentials,
      credentialsIv: stored.credentialsIv,
      credentialsTag: stored.credentialsTag,
      kdfSalt: stored.kdfSalt,
    };
  }

  saveAccount(account: AccountConfig, secrets: StoredSecrets): void {
    accountSchema.parse(account);
    this.accountRepo.save(account, secrets);
  }

  listAccounts(): AccountConfig[] {
    return this.accountRepo.list().map((item) => ({
      name: item.name,
      exchangeId: item.exchangeId,
      checkIntervalMs: item.checkIntervalMs,
      withdrawCooldownMs: item.withdrawCooldownMs,
      mode: item.mode,
    }));
  }

  removeAccount(name: string): void {
    this.accountRepo.remove(name);
  }

  renameAccount(from: string, to: string): void {
    this.accountRepo.rename(from, to);
    this.assetRuleRepo.renameAccount(from, to);
  }

  listAssetRules(accountName?: string): AssetRule[] {
    return this.assetRuleRepo.list(accountName);
  }

  saveAssetRule(rule: AssetRule): void {
    assetRuleSchema.parse(rule);
    this.assetRuleRepo.save(rule);
  }

  removeAssetRule(accountName: string, asset: string): void {
    this.assetRuleRepo.remove(accountName, asset);
  }
}
