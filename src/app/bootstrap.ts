import { ConfigService } from '../services/config-service';
import { CredentialService } from '../services/credential-service';
import { AuditService } from '../services/audit-service';
import { RuntimeService } from '../services/runtime-service';
import { openDatabase } from '../db/sqlite';
import { runSchema } from '../db/schema';
import { RuntimeRepo } from '../db/repo/runtime-repo';
import { EventLogRepo } from '../db/repo/event-log-repo';
import { WithdrawHistoryRepo } from '../db/repo/withdraw-history-repo';
import type { AccountConfig, Credentials } from '../core/types';
import { createExchangeAdapter } from '../exchange/exchange-factory';
import { sealCredentials } from '../crypto/cipher';
import { AccountRepo } from '../db/repo/account-repo';
import { AddressBookRepo } from '../db/repo/address-book-repo';
import { AssetRuleRepo } from '../db/repo/asset-rule-repo';
import { CliAuthRepo } from '../db/repo/cli-auth-repo';
import { CliAuthService } from '../services/cli-auth-service';

const DEFAULT_ACCOUNT: AccountConfig = {
  name: 'default',
  exchangeId: 'mexc',
  checkIntervalMs: 30000,
  withdrawCooldownMs: 600000,
  mode: 'live',
};

const EMPTY_CREDENTIALS: Credentials = {
  apiKey: '',
  apiSecret: '',
};

export interface AppContext {
  configService: ConfigService;
  credentialService: CredentialService;
  auditService: AuditService;
  runtimeService: RuntimeService;
  eventLogRepo: EventLogRepo;
  withdrawHistoryRepo: WithdrawHistoryRepo;
  accountRepo: AccountRepo;
  addressBookRepo: AddressBookRepo;
  assetRuleRepo: AssetRuleRepo;
  runtimeRepo: RuntimeRepo;
  cliAuthRepo: CliAuthRepo;
  cliAuthService: CliAuthService;
}

export function createAppContext(): AppContext {
  const db = openDatabase();
  runSchema(db);

  const accountRepo = new AccountRepo(db);
  const addressBookRepo = new AddressBookRepo(db);
  const assetRuleRepo = new AssetRuleRepo(db);
  const runtimeRepo = new RuntimeRepo(db);
  const eventLogRepo = new EventLogRepo(db);
  const withdrawHistoryRepo = new WithdrawHistoryRepo(db);
  const cliAuthRepo = new CliAuthRepo(db);

  const configService = new ConfigService(accountRepo, assetRuleRepo, addressBookRepo);
  const cliAuthService = new CliAuthService(cliAuthRepo);
  const credentialService = new CredentialService(configService, cliAuthService);
  const auditService = new AuditService(eventLogRepo, withdrawHistoryRepo);
  const runtimeService = new RuntimeService(runtimeRepo);

  return {
    configService,
    credentialService,
    auditService,
    runtimeService,
    eventLogRepo,
    withdrawHistoryRepo,
    accountRepo,
    addressBookRepo,
    assetRuleRepo,
    runtimeRepo,
    cliAuthRepo,
    cliAuthService,
  };
}
export { DEFAULT_ACCOUNT, EMPTY_CREDENTIALS, sealCredentials, createExchangeAdapter };
