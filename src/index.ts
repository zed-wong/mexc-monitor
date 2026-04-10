import { createAppContext, DEFAULT_ACCOUNT } from './app/bootstrap';
import type { AccountConfig, AppState, AssetRule, Credentials } from './core/types';
import { Command } from 'commander';
import { createExchangeAdapter } from './exchange/exchange-factory';
import { StateStore } from './core/state-store';
import { WithdrawService } from './core/withdraw-service';
import { RiskControl } from './core/risk-control';
import { Monitor } from './core/monitor';
import { computeWithdrawAmount } from './core/amount-policy';
import { sleep } from './utils/time';

function printKeyValue(title: string, data: Record<string, unknown>): void {
  process.stdout.write(`${title}\n`);
  for (const [key, value] of Object.entries(data)) {
    process.stdout.write(`  ${key.padEnd(20)} ${String(value ?? '-')}\n`);
  }
}

function buildAccountConfig(options?: Partial<AccountConfig>): AccountConfig {
  return {
    ...DEFAULT_ACCOUNT,
    ...options,
  };
}

function buildAssetRule(options: {
  accountName: string;
  asset: string;
  network: string;
  withdrawAddress: string;
  withdrawTag?: string;
  targetBalance?: string;
  maxBalance: string;
  minWithdrawAmount?: string;
  maxWithdrawAmount?: string;
}): AssetRule {
  return {
    accountName: options.accountName,
    exchangeId: 'mexc',
    asset: options.asset,
    network: options.network,
    withdrawAddress: options.withdrawAddress,
    withdrawTag: options.withdrawTag,
    targetBalance: options.targetBalance ?? '0',
    maxBalance: options.maxBalance,
    minWithdrawAmount: options.minWithdrawAmount ?? '0',
    maxWithdrawAmount: options.maxWithdrawAmount ?? '999999999',
    enabled: true,
  };
}

function buildStore(context: ReturnType<typeof createAppContext>, settings: AssetRule): StateStore {
  return new StateStore({
    screen: 'dashboard',
    settings,
    runtime: context.runtimeService.getRuntime(),
    recentLogs: context.eventLogRepo.listRecent(),
    recentHistory: context.withdrawHistoryRepo.listRecent(),
    unlocked: true,
  } satisfies AppState);
}

async function initExchange(credentials: Credentials) {
  const exchange = createExchangeAdapter('mexc');
  await exchange.init(credentials);
  return exchange;
}

function resolveAccount(context: ReturnType<typeof createAppContext>, accountName: string): AccountConfig {
  const account = context.configService.getAccount(accountName);
  if (!account) {
    throw new Error(`Account not found: ${accountName}`);
  }
  return account;
}

function resolveAssetRule(
  context: ReturnType<typeof createAppContext>,
  accountName: string,
  asset?: string,
): AssetRule {
  if (!asset) {
    throw new Error('Missing required option: --asset <asset>');
  }

  const rule = context.configService.listAssetRules(accountName).find((item) => item.asset === asset);
  if (!rule) {
    throw new Error(`Asset rule not found: ${accountName}/${asset}`);
  }

  return rule;
}

async function runWatchLoop(
  context: ReturnType<typeof createAppContext>,
  credentials: Credentials,
  account: AccountConfig,
  assetRules: AssetRule[],
  autoWithdraw: boolean,
): Promise<void> {
  const exchange = await initExchange(credentials);

  for (;;) {
    const balances = await exchange.fetchAllFreeBalances();
    process.stdout.write(`\n[${new Date().toISOString()}]\n`);
    for (const item of balances) {
      process.stdout.write(`${item.asset.padEnd(12)} ${item.free}\n`);
    }

    if (autoWithdraw) {
      for (const rule of assetRules.filter((item) => item.enabled)) {
        const store = buildStore(context, rule);
        const withdrawService = new WithdrawService(exchange, context.auditService, context.runtimeService);
        const riskControl = new RiskControl();
        const monitor = new Monitor(exchange, context.runtimeService, withdrawService, context.auditService, store, riskControl);
        await monitor.tick(account, rule, credentials);
      }
    }

    await sleep(account.checkIntervalMs);
  }
}

async function runWatchAll(
  context: ReturnType<typeof createAppContext>,
  password: string,
  intervalMs?: number,
  autoWithdraw?: boolean,
): Promise<void> {
  for (;;) {
    for (const account of context.configService.listAccounts()) {
      const selectedAccount = buildAccountConfig({ ...account, checkIntervalMs: intervalMs ?? account.checkIntervalMs });
      const credentials = context.credentialService.unlock(account.name, password);
      const exchange = await initExchange(credentials);
      const balances = await exchange.fetchAllFreeBalances();
      process.stdout.write(`\n[${new Date().toISOString()}] account=${account.name}\n`);
      for (const item of balances) {
        process.stdout.write(`${item.asset.padEnd(12)} ${item.free}\n`);
      }

      if (autoWithdraw) {
        const rules = context.configService.listAssetRules(account.name).filter((item) => item.enabled);
        for (const rule of rules) {
          const store = buildStore(context, rule);
          const withdrawService = new WithdrawService(exchange, context.auditService, context.runtimeService);
          const riskControl = new RiskControl();
          const monitor = new Monitor(exchange, context.runtimeService, withdrawService, context.auditService, store, riskControl);
          await monitor.tick(selectedAccount, rule, credentials);
        }
      }
    }

    await sleep(intervalMs ?? DEFAULT_ACCOUNT.checkIntervalMs);
  }
}

async function runSingleWithdrawCheck(
  context: ReturnType<typeof createAppContext>,
  credentials: Credentials,
  account: AccountConfig,
  rule: AssetRule,
): Promise<void> {
  const exchange = await initExchange(credentials);
  const runtime = context.runtimeService.getRuntime();
  const balance = await exchange.fetchFreeBalance(rule.asset);
  const amount = computeWithdrawAmount(balance, { ...rule, ...account });

  if (!amount) {
    process.stdout.write(`No withdraw needed. ${rule.asset} balance=${balance}\n`);
    return;
  }

  const store = buildStore(context, rule);
  const withdrawService = new WithdrawService(exchange, context.auditService, context.runtimeService);
  const riskControl = new RiskControl();
  const monitor = new Monitor(exchange, context.runtimeService, withdrawService, context.auditService, store, riskControl);
  void runtime;
  await monitor.tick(account, rule, credentials);
}

async function main(): Promise<void> {
  const program = new Command();
  const context = createAppContext();

  program
    .name('mexc-monitor')
    .description('Practical CLI for MEXC monitor')
    .showHelpAfterError();

  program
    .command('status')
    .action(() => {
      const runtime = context.runtimeService.getRuntime();
      printKeyValue('Runtime', {
        apiStatus: runtime.apiStatus,
        paused: runtime.paused,
        lastBalance: runtime.lastBalance,
        lastCheckAt: runtime.lastCheckAt,
        lastSuccessCheckAt: runtime.lastSuccessCheckAt,
        cooldownUntil: runtime.cooldownUntil,
        withdrawInProgress: runtime.withdrawInProgress,
        lastError: runtime.lastError,
      });
    });

  const accountCommand = program.command('account').description('Manage exchange account');
  const assetRule = program.command('asset-rule').description('Manage asset withdrawal rules');
  accountCommand
    .command('set')
    .requiredOption('-a, --account <account>')
    .requiredOption('--password <password>')
    .requiredOption('--api-key <apiKey>')
    .requiredOption('--api-secret <apiSecret>')
    .option('--interval-ms <intervalMs>', '', '30000')
    .option('--withdraw-cooldown-ms <withdrawCooldownMs>', '', '600000')
    .option('--mode <mode>', '', 'live')
    .action(({ account, password, apiKey, apiSecret, intervalMs, withdrawCooldownMs, mode }: {
      account: string; password: string; apiKey: string; apiSecret: string; intervalMs: string; withdrawCooldownMs: string; mode: 'dry_run' | 'live';
    }) => {
      const sealed = context.credentialService.updateCredentials(password, { apiKey, apiSecret });
      context.configService.saveAccount(buildAccountConfig({
        name: account,
        checkIntervalMs: Number(intervalMs),
        withdrawCooldownMs: Number(withdrawCooldownMs),
        mode,
      }), sealed);
      process.stdout.write('Account saved.\n');
    });

  accountCommand.command('list').action(() => {
    for (const account of context.configService.listAccounts()) {
      process.stdout.write(`${account.name.padEnd(16)} ${account.exchangeId} mode=${account.mode} interval=${account.checkIntervalMs}\n`);
    }
  });

  accountCommand.command('show')
    .requiredOption('-a, --account <account>')
    .action(({ account }: { account: string }) => {
      printKeyValue('Account', resolveAccount(context, account) as unknown as Record<string, unknown>);
    });

  accountCommand.command('remove')
    .requiredOption('-a, --account <account>')
    .action(({ account }: { account: string }) => {
      context.configService.removeAccount(account);
      process.stdout.write('Account removed.\n');
    });

  accountCommand.command('rename')
    .requiredOption('-a, --account <account>')
    .requiredOption('--to <to>')
    .action(({ account, to }: { account: string; to: string }) => {
      context.configService.renameAccount(account, to);
      process.stdout.write('Account renamed.\n');
    });

  assetRule.command('list')
    .requiredOption('-a, --account <account>')
    .action(({ account }: { account: string }) => {
      for (const rule of context.configService.listAssetRules(account)) {
        process.stdout.write(`${rule.asset.padEnd(12)} ${rule.network.padEnd(10)} ${rule.withdrawAddress} enabled=${rule.enabled}\n`);
      }
    });

  assetRule.command('show')
    .requiredOption('-a, --account <account>')
    .option('--asset <asset>')
    .action(({ account, asset }: { account: string; asset?: string }) => {
      printKeyValue('Asset Rule', resolveAssetRule(context, account, asset) as unknown as Record<string, unknown>);
    });

  assetRule
    .command('add')
    .requiredOption('-a, --account <account>')
    .requiredOption('--asset <asset>')
    .requiredOption('--network <network>')
    .requiredOption('--withdraw-address <withdrawAddress>')
    .requiredOption('--max-balance <maxBalance>')
    .option('--target-balance <targetBalance>', '', '0')
    .option('--min-withdraw-amount <minWithdrawAmount>', '', '0')
    .option('--max-withdraw-amount <maxWithdrawAmount>', '', '999999999')
    .option('--withdraw-tag <withdrawTag>')
    .action((options: {
      account: string; asset: string; network: string; withdrawAddress: string; maxBalance: string; targetBalance: string;
      minWithdrawAmount: string; maxWithdrawAmount: string; withdrawTag?: string;
    }) => {
      const account = resolveAccount(context, options.account);
      context.configService.saveAssetRule(buildAssetRule({
        accountName: account.name,
        asset: options.asset,
        network: options.network,
        withdrawAddress: options.withdrawAddress,
        maxBalance: options.maxBalance,
        targetBalance: options.targetBalance,
        minWithdrawAmount: options.minWithdrawAmount,
        maxWithdrawAmount: options.maxWithdrawAmount,
        withdrawTag: options.withdrawTag,
      }));
      process.stdout.write('Asset rule saved.\n');
    });

  assetRule
    .command('remove')
    .requiredOption('-a, --account <account>')
    .requiredOption('--asset <asset>')
    .action(({ account, asset }: { account: string; asset: string }) => {
      context.configService.removeAssetRule(account, asset);
      process.stdout.write('Asset rule removed.\n');
    });

  assetRule
    .command('update')
    .requiredOption('-a, --account <account>')
    .requiredOption('--asset <asset>')
    .option('--network <network>')
    .option('--withdraw-address <withdrawAddress>')
    .option('--max-balance <maxBalance>')
    .option('--target-balance <targetBalance>')
    .option('--min-withdraw-amount <minWithdrawAmount>')
    .option('--max-withdraw-amount <maxWithdrawAmount>')
    .option('--withdraw-tag <withdrawTag>')
    .action((options: {
      account: string; asset: string; network?: string; withdrawAddress?: string; maxBalance?: string; targetBalance?: string;
      minWithdrawAmount?: string; maxWithdrawAmount?: string; withdrawTag?: string;
    }) => {
      const existing = context.configService.listAssetRules(options.account).find((item) => item.asset === options.asset);
      if (!existing) {
        throw new Error(`Asset rule not found: ${options.account}/${options.asset}`);
      }
      context.configService.saveAssetRule({
        ...existing,
        network: options.network ?? existing.network,
        withdrawAddress: options.withdrawAddress ?? existing.withdrawAddress,
        maxBalance: options.maxBalance ?? existing.maxBalance,
        targetBalance: options.targetBalance ?? existing.targetBalance,
        minWithdrawAmount: options.minWithdrawAmount ?? existing.minWithdrawAmount,
        maxWithdrawAmount: options.maxWithdrawAmount ?? existing.maxWithdrawAmount,
        withdrawTag: options.withdrawTag ?? existing.withdrawTag,
      });
      process.stdout.write('Asset rule updated.\n');
    });

  assetRule
    .command('enable')
    .requiredOption('-a, --account <account>')
    .requiredOption('--asset <asset>')
    .action(({ account, asset }: { account: string; asset: string }) => {
      const existing = context.configService.listAssetRules(account).find((item) => item.asset === asset);
      if (!existing) {
        throw new Error(`Asset rule not found: ${account}/${asset}`);
      }
      context.configService.saveAssetRule({ ...existing, enabled: true });
      process.stdout.write('Asset rule enabled.\n');
    });

  assetRule
    .command('disable')
    .requiredOption('-a, --account <account>')
    .requiredOption('--asset <asset>')
    .action(({ account, asset }: { account: string; asset: string }) => {
      const existing = context.configService.listAssetRules(account).find((item) => item.asset === asset);
      if (!existing) {
        throw new Error(`Asset rule not found: ${account}/${asset}`);
      }
      context.configService.saveAssetRule({ ...existing, enabled: false });
      process.stdout.write('Asset rule disabled.\n');
    });

  program.command('logs').action(() => {
      for (const item of context.eventLogRepo.listRecent()) {
        process.stdout.write(`[${item.level}] ${item.createdAt} ${item.type} ${item.message}\n`);
      }
    });

  program
    .command('balance')
    .requiredOption('-a, --account <account>')
    .requiredOption('--password <password>')
    .action(async ({ account, password }: { account: string; password: string }) => {
      const credentials = context.credentialService.unlock(account, password);
      const exchange = await initExchange(credentials);
      const balances = await exchange.fetchAllFreeBalances();
      for (const item of balances) {
        process.stdout.write(`${item.asset.padEnd(12)} ${item.free}\n`);
      }
    });

  program
    .command('watch')
    .requiredOption('-a, --account <account>')
    .option('--interval-ms <intervalMs>', '', '30000')
    .requiredOption('--password <password>')
    .action(async ({ account, password, intervalMs }: { account: string; password: string; intervalMs: string }) => {
      const selectedAccount = buildAccountConfig({ ...resolveAccount(context, account), checkIntervalMs: Number(intervalMs) });
      const credentials = context.credentialService.unlock(account, password);
      await runWatchLoop(context, credentials, selectedAccount, context.configService.listAssetRules(account), false);
    });

  program
    .command('withdraw')
    .requiredOption('-a, --account <account>')
    .requiredOption('--password <password>')
    .action(async ({ account, password }: { account: string; password: string }) => {
      const selectedAccount = resolveAccount(context, account);
      const credentials = context.credentialService.unlock(account, password);
      const rules = context.configService.listAssetRules(account).filter((item) => item.enabled);
      for (const rule of rules) {
        await runSingleWithdrawCheck(context, credentials, selectedAccount, rule);
      }
      process.stdout.write('Withdraw check complete.\n');
    });

  program
    .command('watch-withdraw')
    .requiredOption('-a, --account <account>')
    .requiredOption('--password <password>')
    .option('--interval-ms <intervalMs>', '', '30000')
    .action(async ({ account, password, intervalMs }: { account: string; password: string; intervalMs: string }) => {
      const selectedAccount = buildAccountConfig({ ...resolveAccount(context, account), checkIntervalMs: Number(intervalMs) });
      const credentials = context.credentialService.unlock(account, password);
      const rules = context.configService.listAssetRules(account).filter((item) => item.enabled);
      await runWatchLoop(context, credentials, selectedAccount, rules, true);
    });

  program
    .command('watch-all')
    .requiredOption('--password <password>')
    .option('--interval-ms <intervalMs>')
    .action(async ({ password, intervalMs }: { password: string; intervalMs?: string }) => {
      if (context.configService.listAccounts().length === 0) {
        throw new Error('No accounts configured.');
      }
      await runWatchAll(context, password, intervalMs ? Number(intervalMs) : undefined, false);
    });

  program
    .command('withdraw-all')
    .requiredOption('--password <password>')
    .action(async ({ password }: { password: string }) => {
      const accounts = context.configService.listAccounts();
      if (accounts.length === 0) {
        throw new Error('No accounts configured.');
      }

      for (const account of accounts) {
        const selectedAccount = resolveAccount(context, account.name);
        const credentials = context.credentialService.unlock(account.name, password);
        const rules = context.configService.listAssetRules(account.name).filter((item) => item.enabled);
        for (const rule of rules) {
          await runSingleWithdrawCheck(context, credentials, selectedAccount, rule);
        }
      }
      process.stdout.write('Withdraw-all complete.\n');
    });

  program
    .command('watch-withdraw-all')
    .requiredOption('--password <password>')
    .option('--interval-ms <intervalMs>')
    .action(async ({ password, intervalMs }: { password: string; intervalMs?: string }) => {
      if (context.configService.listAccounts().length === 0) {
        throw new Error('No accounts configured.');
      }
      await runWatchAll(context, password, intervalMs ? Number(intervalMs) : undefined, true);
    });

  await program.parseAsync(process.argv);
}

void main();
