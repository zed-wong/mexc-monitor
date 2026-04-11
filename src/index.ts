import { createAppContext, DEFAULT_ACCOUNT } from './app/bootstrap';
import type { AccountConfig, AssetRule, Credentials } from './core/types';
import { Command } from 'commander';
import { createExchangeAdapter } from './exchange/exchange-factory';
import { WithdrawService } from './core/withdraw-service';
import { RiskControl } from './core/risk-control';
import { Monitor } from './core/monitor';
import { computeWithdrawAmount } from './core/amount-policy';
import { sleep } from './utils/time';
import { ZodError } from 'zod';

const EXAMPLES = `
Examples:
  mexc-monitor account set -a main --password '***' --api-key '***' --api-secret '***'
  mexc-monitor asset-rule add -a main --asset USDT --network ERC20 --withdraw-address 0xabc... --max-balance 1000 --target-balance 200
  mexc-monitor account test -a main --password '***'
  mexc-monitor balance -a main --password '***'
  mexc-monitor withdraw -a main --password '***'
  mexc-monitor watch-withdraw -a main --password '***' --interval-ms 30000
`;

function printKeyValue(title: string, data: Record<string, unknown>): void {
  process.stdout.write(`${title}\n`);
  for (const [key, value] of Object.entries(data)) {
    process.stdout.write(`  ${key.padEnd(20)} ${String(value ?? '-')}\n`);
  }
}

function printSection(title: string, lines: string[]): void {
  process.stdout.write(`${title}\n`);
  for (const line of lines) {
    process.stdout.write(`  ${line}\n`);
  }
}

function printRuntimeRow(accountName: string, asset: string, runtime: {
  apiStatus: string;
  paused: boolean;
  withdrawInProgress: boolean;
  lastBalance?: string;
  cooldownUntil?: string;
  lastError?: string;
}): void {
  process.stdout.write(
    `${accountName.padEnd(16)} ${asset.padEnd(12)} api=${runtime.apiStatus.padEnd(7)} paused=${String(runtime.paused).padEnd(5)} withdrawing=${String(runtime.withdrawInProgress).padEnd(5)} balance=${runtime.lastBalance ?? '-'} cooldownUntil=${runtime.cooldownUntil ?? '-'} lastError=${runtime.lastError ?? '-'}\n`,
  );
}

function assertLiveConfirmation(account: AccountConfig, confirmLive?: boolean): void {
  if (account.mode === 'live' && !confirmLive) {
    throw new Error(`Account ${account.name} is in live mode. Re-run with --confirm-live to allow real withdrawals.`);
  }
}

function assertLiveConfirmationForAccounts(accounts: AccountConfig[], confirmLive?: boolean): void {
  const liveAccounts = accounts.filter((account) => account.mode === 'live');
  if (liveAccounts.length > 0 && !confirmLive) {
    throw new Error(`Live mode is enabled for: ${liveAccounts.map((item) => item.name).join(', ')}. Re-run with --confirm-live to allow real withdrawals.`);
  }
}

function parseIntegerOption(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function parsePositiveIntegerOption(name: string, value: string): number {
  const parsed = parseIntegerOption(name, value);
  if (parsed <= 0) {
    throw new Error(`${name} must be greater than 0`);
  }
  return parsed;
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

async function initExchange(credentials: Credentials) {
  const exchange = createExchangeAdapter('mexc');
  await exchange.init(credentials);
  return exchange;
}

async function validateAssetRuleForExchange(rule: AssetRule): Promise<void> {
  const exchange = createExchangeAdapter(rule.exchangeId);
  await exchange.validateConfig({
    asset: rule.asset,
    network: rule.network,
    address: rule.withdrawAddress,
  });
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
        const withdrawService = new WithdrawService(exchange, context.auditService, context.runtimeService);
        const riskControl = new RiskControl();
        const monitor = new Monitor(exchange, context.runtimeService, withdrawService, context.auditService, riskControl);
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
          const withdrawService = new WithdrawService(exchange, context.auditService, context.runtimeService);
          const riskControl = new RiskControl();
          const monitor = new Monitor(exchange, context.runtimeService, withdrawService, context.auditService, riskControl);
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
  const runtime = context.runtimeService.getRuntime({ accountName: account.name, asset: rule.asset });
  const balance = await exchange.fetchFreeBalance(rule.asset);
  const amount = computeWithdrawAmount(balance, { ...rule, ...account });

  if (!amount) {
    process.stdout.write(`No withdraw needed. ${rule.asset} balance=${balance}\n`);
    return;
  }

  const withdrawService = new WithdrawService(exchange, context.auditService, context.runtimeService);
  const riskControl = new RiskControl();
  const monitor = new Monitor(exchange, context.runtimeService, withdrawService, context.auditService, riskControl);
  void runtime;
  await monitor.tick(account, rule, credentials);
}

async function main(): Promise<void> {
  const program = new Command();
  const context = createAppContext();

  program
    .name('mexc-monitor')
    .description('CLI for monitoring MEXC balances and auto-withdrawing excess funds')
    .showHelpAfterError()
    .addHelpText('after', EXAMPLES);

  program.configureOutput({
    outputError: (str, write) => write(`Error: ${str}`),
  });

  program
    .command('setup')
    .description('Print the recommended first-run CLI flow')
    .action(() => {
      printSection('Recommended flow', [
        "1. Create an account in dry-run mode: mexc-monitor account set -a main --password '***' --api-key '***' --api-secret '***'",
        "2. Test API access: mexc-monitor account test -a main --password '***'",
        "3. Add a rule: mexc-monitor asset-rule add -a main --asset USDT --network ERC20 --withdraw-address 0xabc... --max-balance 1000 --target-balance 200",
        "4. Inspect config: mexc-monitor account show -a main && mexc-monitor asset-rule list -a main",
        "5. Check balances: mexc-monitor balance -a main --password '***'",
        "6. Run one dry-run withdraw check: mexc-monitor withdraw -a main --password '***'",
        "7. Start continuous monitoring: mexc-monitor watch-withdraw -a main --password '***' --interval-ms 30000",
        '8. Only switch to --mode live after dry-run results look correct and exchange withdrawal permissions are verified',
      ]);
    });

  program
    .command('status')
    .description('Show the latest runtime state')
    .option('-a, --account <account>')
    .option('--asset <asset>')
    .action(({ account, asset }: { account?: string; asset?: string }) => {
      const rows = context.runtimeService.listRuntime({
        accountName: account,
        asset,
      });

      if (rows.length === 0) {
        process.stdout.write('No runtime state found.\n');
        return;
      }

      for (const row of rows) {
        printRuntimeRow(row.accountName, row.asset, row);
      }
    });

  const accountCommand = program.command('account').description('Manage exchange account');
  const assetRule = program.command('asset-rule').description('Manage asset withdrawal rules');
  accountCommand
    .command('set')
    .description('Create or update an account and store encrypted API credentials')
    .requiredOption('-a, --account <account>')
    .requiredOption('--password <password>')
    .requiredOption('--api-key <apiKey>')
    .requiredOption('--api-secret <apiSecret>')
    .option('--interval-ms <intervalMs>', '', '30000')
    .option('--withdraw-cooldown-ms <withdrawCooldownMs>', '', '600000')
    .option('--mode <mode>', '', 'dry_run')
    .action(({ account, password, apiKey, apiSecret, intervalMs, withdrawCooldownMs, mode }: {
      account: string; password: string; apiKey: string; apiSecret: string; intervalMs: string; withdrawCooldownMs: string; mode: 'dry_run' | 'live';
    }) => {
      if (mode !== 'dry_run' && mode !== 'live') {
        throw new Error('--mode must be dry_run or live');
      }
      const sealed = context.credentialService.updateCredentials(password, { apiKey, apiSecret });
      context.configService.saveAccount(buildAccountConfig({
        name: account,
        checkIntervalMs: parsePositiveIntegerOption('interval-ms', intervalMs),
        withdrawCooldownMs: parseIntegerOption('withdraw-cooldown-ms', withdrawCooldownMs),
        mode,
      }), sealed);
      printSection('Account saved', [
        `account=${account}`,
        'exchange=mexc',
        `mode=${mode}`,
        `intervalMs=${intervalMs}`,
        `withdrawCooldownMs=${withdrawCooldownMs}`,
      ]);
    });

  accountCommand.command('list').description('List configured accounts').action(() => {
    for (const account of context.configService.listAccounts()) {
      process.stdout.write(`${account.name.padEnd(16)} ${account.exchangeId} mode=${account.mode} interval=${account.checkIntervalMs}\n`);
    }
  });

  accountCommand.command('show')
    .description('Show one account configuration')
    .requiredOption('-a, --account <account>')
    .action(({ account }: { account: string }) => {
      printKeyValue('Account', resolveAccount(context, account) as unknown as Record<string, unknown>);
    });

  accountCommand.command('remove')
    .description('Remove an account and its encrypted credentials')
    .requiredOption('-a, --account <account>')
    .action(({ account }: { account: string }) => {
      context.configService.removeAccount(account);
      process.stdout.write('Account removed.\n');
    });

  accountCommand.command('rename')
    .description('Rename an account and move its asset rules with it')
    .requiredOption('-a, --account <account>')
    .requiredOption('--to <to>')
    .action(({ account, to }: { account: string; to: string }) => {
      context.configService.renameAccount(account, to);
      process.stdout.write('Account renamed.\n');
    });

  accountCommand.command('test')
    .description('Unlock credentials and perform an exchange API health check')
    .requiredOption('-a, --account <account>')
    .requiredOption('--password <password>')
    .action(async ({ account, password }: { account: string; password: string }) => {
      const selectedAccount = resolveAccount(context, account);
      const credentials = context.credentialService.unlock(account, password);
      const exchange = createExchangeAdapter(selectedAccount.exchangeId);
      await exchange.init(credentials);
      await exchange.healthCheck();
      printSection('Account test passed', [
        `account=${selectedAccount.name}`,
        `exchange=${selectedAccount.exchangeId}`,
        'apiStatus=healthy',
      ]);
    });

  assetRule.command('list')
    .description('List asset withdrawal rules for an account')
    .requiredOption('-a, --account <account>')
    .action(({ account }: { account: string }) => {
      for (const rule of context.configService.listAssetRules(account)) {
        process.stdout.write(`${rule.asset.padEnd(12)} ${rule.network.padEnd(10)} ${rule.withdrawAddress} enabled=${rule.enabled}\n`);
      }
    });

  assetRule.command('show')
    .description('Show one asset withdrawal rule')
    .requiredOption('-a, --account <account>')
    .option('--asset <asset>')
    .action(({ account, asset }: { account: string; asset?: string }) => {
      printKeyValue('Asset Rule', resolveAssetRule(context, account, asset) as unknown as Record<string, unknown>);
    });

  assetRule
    .command('add')
    .description('Add a withdrawal rule that keeps balance under maxBalance')
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
    }, command) => {
      const account = resolveAccount(context, options.account);
      const rule = buildAssetRule({
        accountName: account.name,
        asset: options.asset,
        network: options.network,
        withdrawAddress: options.withdrawAddress,
        maxBalance: options.maxBalance,
        targetBalance: options.targetBalance,
        minWithdrawAmount: options.minWithdrawAmount,
        maxWithdrawAmount: options.maxWithdrawAmount,
        withdrawTag: options.withdrawTag,
      });
      void command;
      return validateAssetRuleForExchange(rule).then(() => {
        context.configService.saveAssetRule(rule);
        printSection('Asset rule saved', [
          `account=${rule.accountName}`,
          `asset=${rule.asset}`,
          `network=${rule.network}`,
          `targetBalance=${rule.targetBalance}`,
          `maxBalance=${rule.maxBalance}`,
          `enabled=${rule.enabled}`,
        ]);
      });
    });

  assetRule
    .command('remove')
    .description('Remove an asset withdrawal rule')
    .requiredOption('-a, --account <account>')
    .requiredOption('--asset <asset>')
    .action(({ account, asset }: { account: string; asset: string }) => {
      context.configService.removeAssetRule(account, asset);
      process.stdout.write('Asset rule removed.\n');
    });

  assetRule
    .command('update')
    .description('Update fields on an existing asset withdrawal rule')
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
      const rule = {
        ...existing,
        network: options.network ?? existing.network,
        withdrawAddress: options.withdrawAddress ?? existing.withdrawAddress,
        maxBalance: options.maxBalance ?? existing.maxBalance,
        targetBalance: options.targetBalance ?? existing.targetBalance,
        minWithdrawAmount: options.minWithdrawAmount ?? existing.minWithdrawAmount,
        maxWithdrawAmount: options.maxWithdrawAmount ?? existing.maxWithdrawAmount,
        withdrawTag: options.withdrawTag ?? existing.withdrawTag,
      };
      return validateAssetRuleForExchange(rule).then(() => {
        context.configService.saveAssetRule(rule);
        process.stdout.write('Asset rule updated.\n');
      });
    });

  assetRule
    .command('enable')
    .description('Enable an asset withdrawal rule')
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
    .description('Disable an asset withdrawal rule')
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

  program.command('logs')
    .description('Show recent audit logs')
    .option('-a, --account <account>')
    .option('--asset <asset>')
    .option('--level <level>')
    .option('--limit <limit>', '', '50')
    .action(({ account, asset, level, limit }: { account?: string; asset?: string; level?: 'debug' | 'info' | 'warn' | 'error'; limit: string }) => {
      for (const item of context.eventLogRepo.listRecent({
        accountName: account,
        asset,
        level,
        limit: parsePositiveIntegerOption('limit', limit),
      })) {
        process.stdout.write(
          `[${item.level}] ${item.createdAt} account=${item.accountName ?? '-'} asset=${item.asset ?? '-'} ${item.type} ${item.message}\n`,
        );
      }
    });

  program.command('history')
    .description('Show recent withdraw history')
    .option('-a, --account <account>')
    .option('--asset <asset>')
    .option('--status <status>')
    .option('--limit <limit>', '', '50')
    .action(({ account, asset, status, limit }: {
      account?: string; asset?: string; status?: 'simulated' | 'success' | 'failed' | 'rejected'; limit: string;
    }) => {
      for (const item of context.withdrawHistoryRepo.listRecent({
        accountName: account,
        asset,
        status,
        limit: parsePositiveIntegerOption('limit', limit),
      })) {
      process.stdout.write(
        `[${item.status}] ${item.createdAt} account=${item.accountName} ${item.asset} ${item.amount} ${item.network} ${item.addressMasked}`,
      );
      if (item.txid) {
        process.stdout.write(` txid=${item.txid}`);
      }
      if (item.reason) {
        process.stdout.write(` reason=${item.reason}`);
      }
      if (item.errorMessage) {
        process.stdout.write(` error=${item.errorMessage}`);
      }
      process.stdout.write('\n');
    }
  });

  program
    .command('balance')
    .description('Fetch current free balances for one account')
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
    .description('Continuously print balances for one account')
    .requiredOption('-a, --account <account>')
    .option('--interval-ms <intervalMs>', '', '30000')
    .requiredOption('--password <password>')
    .action(async ({ account, password, intervalMs }: { account: string; password: string; intervalMs: string }) => {
      const selectedAccount = buildAccountConfig({
        ...resolveAccount(context, account),
        checkIntervalMs: parsePositiveIntegerOption('interval-ms', intervalMs),
      });
      const credentials = context.credentialService.unlock(account, password);
      await runWatchLoop(context, credentials, selectedAccount, context.configService.listAssetRules(account), false);
    });

  program
    .command('withdraw')
    .description('Run one withdraw check for all enabled rules on an account')
    .requiredOption('-a, --account <account>')
    .requiredOption('--password <password>')
    .option('--confirm-live')
    .action(async ({ account, password, confirmLive }: { account: string; password: string; confirmLive?: boolean }) => {
      const selectedAccount = resolveAccount(context, account);
      assertLiveConfirmation(selectedAccount, confirmLive);
      const credentials = context.credentialService.unlock(account, password);
      const rules = context.configService.listAssetRules(account).filter((item) => item.enabled);
      for (const rule of rules) {
        await runSingleWithdrawCheck(context, credentials, selectedAccount, rule);
      }
      process.stdout.write('Withdraw check complete.\n');
    });

  program
    .command('watch-withdraw')
    .description('Continuously monitor and withdraw for one account')
    .requiredOption('-a, --account <account>')
    .requiredOption('--password <password>')
    .option('--interval-ms <intervalMs>', '', '30000')
    .option('--confirm-live')
    .action(async ({ account, password, intervalMs, confirmLive }: { account: string; password: string; intervalMs: string; confirmLive?: boolean }) => {
      const selectedAccount = buildAccountConfig({
        ...resolveAccount(context, account),
        checkIntervalMs: parsePositiveIntegerOption('interval-ms', intervalMs),
      });
      assertLiveConfirmation(selectedAccount, confirmLive);
      const credentials = context.credentialService.unlock(account, password);
      const rules = context.configService.listAssetRules(account).filter((item) => item.enabled);
      await runWatchLoop(context, credentials, selectedAccount, rules, true);
    });

  program
    .command('watch-all')
    .description('Continuously print balances for all configured accounts')
    .requiredOption('--password <password>')
    .option('--interval-ms <intervalMs>')
    .action(async ({ password, intervalMs }: { password: string; intervalMs?: string }) => {
      if (context.configService.listAccounts().length === 0) {
        throw new Error('No accounts configured.');
      }
      await runWatchAll(
        context,
        password,
        intervalMs ? parsePositiveIntegerOption('interval-ms', intervalMs) : undefined,
        false,
      );
    });

  program
    .command('withdraw-all')
    .description('Run one withdraw check for every configured account')
    .requiredOption('--password <password>')
    .option('--confirm-live')
    .action(async ({ password, confirmLive }: { password: string; confirmLive?: boolean }) => {
      const accounts = context.configService.listAccounts();
      if (accounts.length === 0) {
        throw new Error('No accounts configured.');
      }
      assertLiveConfirmationForAccounts(accounts, confirmLive);

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
    .description('Continuously monitor and withdraw for every configured account')
    .requiredOption('--password <password>')
    .option('--interval-ms <intervalMs>')
    .option('--confirm-live')
    .action(async ({ password, intervalMs, confirmLive }: { password: string; intervalMs?: string; confirmLive?: boolean }) => {
      const accounts = context.configService.listAccounts();
      if (accounts.length === 0) {
        throw new Error('No accounts configured.');
      }
      assertLiveConfirmationForAccounts(accounts, confirmLive);
      await runWatchAll(
        context,
        password,
        intervalMs ? parsePositiveIntegerOption('interval-ms', intervalMs) : undefined,
        true,
      );
    });

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(error.issues.map((item) => item.message).join('; '));
    }
    throw error;
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
