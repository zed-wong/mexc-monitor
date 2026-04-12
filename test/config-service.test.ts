import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';

import { ConfigService } from '../src/services/config-service';
import { AccountRepo } from '../src/db/repo/account-repo';
import { AddressBookRepo } from '../src/db/repo/address-book-repo';
import { AssetRuleRepo } from '../src/db/repo/asset-rule-repo';
import { runSchema } from '../src/db/schema';
import type { AccountConfig, AssetRule } from '../src/core/types';
import type { StoredSecrets } from '../src/db/types';

function createConfigService(): ConfigService {
  const db = new Database(':memory:', { strict: true });
  runSchema(db);
  return new ConfigService(new AccountRepo(db), new AssetRuleRepo(db), new AddressBookRepo(db));
}

const account: AccountConfig = {
  name: 'main',
  exchangeId: 'mexc',
  checkIntervalMs: 30000,
  withdrawCooldownMs: 600000,
  mode: 'dry_run',
};

const secrets: StoredSecrets = {
  encryptedCredentials: Buffer.from('enc'),
  credentialsIv: Buffer.from('iv'),
  credentialsTag: Buffer.from('tag'),
  kdfSalt: Buffer.from('salt'),
};

const baseRule: AssetRule = {
  accountName: 'main',
  exchangeId: 'mexc',
  asset: 'USDT',
  network: 'ERC20',
  withdrawAddress: '0xabc',
  targetBalance: '200',
  maxBalance: '1000',
  minWithdrawAmount: '10',
  maxWithdrawAmount: '500',
  enabled: true,
};

describe('ConfigService', () => {
  test('persists valid account and rule config', () => {
    const service = createConfigService();
    service.saveAccount(account, secrets);
    service.saveAssetRule(baseRule);

    expect(service.getAccount('main')).toEqual(account);
    expect(service.listAssetRules('main')).toHaveLength(1);
  });

  test('rejects invalid decimal rule ranges', () => {
    const service = createConfigService();

    expect(() => service.saveAssetRule({
      ...baseRule,
      targetBalance: '1000.01',
      maxBalance: '1000',
    })).toThrow('targetBalance must be <= maxBalance');

    expect(() => service.saveAssetRule({
      ...baseRule,
      minWithdrawAmount: '200',
      maxWithdrawAmount: '100',
    })).toThrow('minWithdrawAmount must be <= maxWithdrawAmount');

    expect(() => service.saveAssetRule({
      ...baseRule,
      targetBalanceUsdt: '1001',
      maxBalanceUsdt: '1000',
    })).toThrow('targetBalanceUsdt and maxBalanceUsdt must both be set and targetBalanceUsdt must be <= maxBalanceUsdt');
  });

  test('persists address book entries and renames them with the account', () => {
    const service = createConfigService();
    service.saveAccount(account, secrets);
    service.saveAddressBookEntry({
      accountName: 'main',
      alias: 'treasury',
      asset: 'USDT',
      network: 'ERC20',
      address: '0xabc',
      tag: 'memo-1',
      note: 'primary vault',
    });

    expect(service.getAddressBookEntry('main', 'treasury')).toMatchObject({
      alias: 'treasury',
      asset: 'USDT',
      network: 'ERC20',
      address: '0xabc',
    });

    service.renameAccount('main', 'ops');

    expect(service.getAddressBookEntry('main', 'treasury')).toBeNull();
    expect(service.getAddressBookEntry('ops', 'treasury')).toMatchObject({
      accountName: 'ops',
      alias: 'treasury',
    });
  });
});
