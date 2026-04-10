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
import { AssetRuleRepo } from '../db/repo/asset-rule-repo';

const DEFAULT_ACCOUNT: AccountConfig = {
  name: 'default',
  exchangeId: 'mexc',
  checkIntervalMs: 30000,
  withdrawCooldownMs: 600000,
  mode: 'dry_run',
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
  assetRuleRepo: AssetRuleRepo;
  runtimeRepo: RuntimeRepo;
}

export function createAppContext(): AppContext {
  const db = openDatabase();
  runSchema(db);

  const accountRepo = new AccountRepo(db);
  const assetRuleRepo = new AssetRuleRepo(db);
  const runtimeRepo = new RuntimeRepo(db);
  const eventLogRepo = new EventLogRepo(db);
  const withdrawHistoryRepo = new WithdrawHistoryRepo(db);

  runtimeRepo.init();

  const configService = new ConfigService(accountRepo, assetRuleRepo);
  const credentialService = new CredentialService(configService);
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
    assetRuleRepo,
    runtimeRepo,
  };
}
export { DEFAULT_ACCOUNT, EMPTY_CREDENTIALS, sealCredentials, createExchangeAdapter };
