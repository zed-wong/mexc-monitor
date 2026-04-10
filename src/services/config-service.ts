import { z } from 'zod';

import type { AccountConfig, AssetRule } from '../core/types';
import type { StoredSecrets } from '../db/types';
import type { AccountRepo } from '../db/repo/account-repo';
import type { AssetRuleRepo } from '../db/repo/asset-rule-repo';

const assetRuleSchema = z.object({
  exchangeId: z.string().min(1),
  asset: z.string().min(1),
  network: z.string().min(1),
  withdrawAddress: z.string().min(1),
  withdrawTag: z.string().optional(),
  targetBalance: z.string().min(1),
  maxBalance: z.string().min(1),
  minWithdrawAmount: z.string().min(1),
  maxWithdrawAmount: z.string().min(1),
  enabled: z.boolean(),
}).refine((value) => Number(value.targetBalance) <= Number(value.maxBalance), {
  message: 'targetBalance must be <= maxBalance',
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
