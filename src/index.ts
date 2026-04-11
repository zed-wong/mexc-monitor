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

function formatValue(value: unknown): string {
  return String(value ?? '-');
}

function truncateValue(value: unknown, maxLength = 80): string {
  const text = formatValue(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function printDivider(): void {
  process.stdout.write(`${'-'.repeat(72)}\n`);
}

function printEmptyState(message: string): void {
  printSection('No data', [message]);
}

function printKeyValue(title: string, data: Record<string, unknown>): void {
  process.stdout.write(`${title}\n`);
  for (const [key, value] of Object.entries(data)) {
    process.stdout.write(`  ${key.padEnd(20)} ${formatValue(value)}\n`);
  }
}

function printSection(title: string, lines: string[]): void {
  process.stdout.write(`${title}\n`);
  for (const line of lines) {
    process.stdout.write(`  ${line}\n`);
  }
}

function printRuntimeCard(accountName: string, asset: string, runtime: {
  apiStatus: string;
  paused: boolean;
  withdrawInProgress: boolean;
  lastBalance?: string;
  cooldownUntil?: string;
  lastError?: string;
  lastCheckAt?: string;
  lastSuccessCheckAt?: string;
}): void {
  printDivider();
  printSection(`${accountName}/${asset}`, [
    `API status          ${formatValue(runtime.apiStatus)}`,
    `Last balance        ${formatValue(runtime.lastBalance)}`,
    `Paused              ${runtime.paused ? 'yes' : 'no'}`,
    `Withdraw active     ${runtime.withdrawInProgress ? 'yes' : 'no'}`,
    `Cooldown until      ${formatValue(runtime.cooldownUntil)}`,
    `Last check          ${formatValue(runtime.lastCheckAt)}`,
    `Last success check  ${formatValue(runtime.lastSuccessCheckAt)}`,
    `Last error          ${truncateValue(runtime.lastError, 120)}`,
  ]);
}

function printLogEntry(item: {
  level: string;
  createdAt: string;
  accountName?: string;
  asset?: string;
  type: string;
  message: string;
}): void {
  printDivider();
  printSection(`[${item.level.toUpperCase()}] ${item.createdAt}`, [
    `Scope   ${formatValue(item.accountName)}/${formatValue(item.asset)}`,
    `Type    ${item.type}`,
    `Detail  ${truncateValue(item.message, 120)}`,
  ]);
}

function printHistoryEntry(item: {
  status: string;
  createdAt: string;
  accountName: string;
  asset: string;
  amount: string;
  network: string;
  addressMasked: string;
  mode: string;
  txid?: string;
  reason?: string;
  errorMessage?: string;
}): void {
  printDivider();
  printSection(`[${item.status.toUpperCase()}] ${item.createdAt}`, [
    `Scope   ${item.accountName}/${item.asset}`,
    `Amount  ${item.amount} via ${item.network}`,
    `Target  ${item.addressMasked}`,
    `Mode    ${item.mode}`,
    `Txid    ${truncateValue(item.txid, 96)}`,
    `Reason  ${truncateValue(item.reason, 120)}`,
    `Error   ${truncateValue(item.errorMessage, 120)}`,
  ]);
}

function printWithdrawPlan(account: AccountConfig, rule: AssetRule, balance: string, amount: string): void {
  printDivider();
  printSection('Withdraw plan', [
    `Account            ${account.name}`,
    `Asset              ${rule.asset}`,
    `Mode               ${account.mode}`,
    `Current balance    ${balance}`,
    `Max balance        ${rule.maxBalance}`,
    `Target balance     ${rule.targetBalance}`,
    `Planned amount     ${amount}`,
    `Network            ${rule.network}`,
    `Address            ${rule.withdrawAddress}`,
    `Confirm live       ${account.mode === 'live' ? 'required and provided' : 'not required (dry_run)'}`,
  ]);
}

function getRecommendedNextSteps(
  context: ReturnType<typeof createAppContext>,
  accountName?: string,
): string[] {
  const accounts = accountName
    ? context.configService.listAccounts().filter((item) => item.name === accountName)
    : context.configService.listAccounts();

  if (accountName && accounts.length === 0) {
    return [`Create the account first: mexc-monitor account set -a ${accountName} --password '***' --api-key '***' --api-secret '***'`];
  }

  if (accounts.length === 0) {
    return [
      "Create an account in dry-run mode: mexc-monitor account set -a main --password '***' --api-key '***' --api-secret '***'",
      "Then verify exchange access: mexc-monitor account test -a main --password '***'",
    ];
  }

  const steps: string[] = [];

  for (const account of accounts) {
    const rules = context.configService.listAssetRules(account.name);
    const enabledRules = rules.filter((item) => item.enabled);
    const runtimeRows = context.runtimeService.listRuntime({ accountName: account.name });

    if (rules.length === 0) {
      steps.push(`Add a withdrawal rule for ${account.name}: mexc-monitor asset-rule add -a ${account.name} --asset USDT --network ERC20 --withdraw-address 0xabc... --max-balance 1000 --target-balance 200`);
      continue;
    }

    if (runtimeRows.length === 0) {
      steps.push(`Check live balances for ${account.name}: mexc-monitor balance -a ${account.name} --password '***'`);
      steps.push(`Run one withdraw simulation for ${account.name}: mexc-monitor withdraw -a ${account.name} --password '***'`);
      continue;
    }

    if (enabledRules.length === 0) {
      steps.push(`Enable at least one rule for ${account.name}: mexc-monitor asset-rule enable -a ${account.name} --asset <asset>`);
      continue;
    }

    steps.push(`Inspect current runtime for ${account.name}: mexc-monitor status -a ${account.name}`);
    steps.push(`Start continuous monitoring for ${account.name}: mexc-monitor watch-withdraw -a ${account.name} --password '***' --interval-ms ${account.checkIntervalMs}`);

    if (account.mode === 'dry_run') {
      steps.push(`Only after dry-run results look correct, switch ${account.name} to live mode and use --confirm-live for real withdrawals`);
    }
  }

  return Array.from(new Set(steps));
}

function printDoctorSummary(context: ReturnType<typeof createAppContext>, accountName?: string): void {
  const accounts = accountName
    ? context.configService.listAccounts().filter((item) => item.name === accountName)
    : context.configService.listAccounts();

  if (accountName && accounts.length === 0) {
    printEmptyState(`No account named ${accountName} is configured.`);
    return;
  }

  const totalRules = accounts.reduce((sum, account) => sum + context.configService.listAssetRules(account.name).length, 0);
  const enabledRules = accounts.reduce(
    (sum, account) => sum + context.configService.listAssetRules(account.name).filter((item) => item.enabled).length,
    0,
  );
  const runtimeRows = accounts.reduce(
    (sum, account) => sum + context.runtimeService.listRuntime({ accountName: account.name }).length,
    0,
  );
  const errorRuntimeRows = accounts.reduce(
    (sum, account) => sum + context.runtimeService.listRuntime({ accountName: account.name }).filter((item) => item.apiStatus === 'error').length,
    0,
  );
  const pausedRuntimeRows = accounts.reduce(
    (sum, account) => sum + context.runtimeService.listRuntime({ accountName: account.name }).filter((item) => item.paused).length,
    0,
  );
  const liveAccounts = accounts.filter((item) => item.mode === 'live').length;

  printSection('Doctor summary', [
    `accounts=${accounts.length}`,
    `rules.total=${totalRules}`,
    `rules.enabled=${enabledRules}`,
    `runtime.rows=${runtimeRows}`,
    `runtime.error=${errorRuntimeRows}`,
    `runtime.paused=${pausedRuntimeRows}`,
    `accounts.live=${liveAccounts}`,
    `filter.account=${accountName ?? '*'}`,
  ]);

  for (const account of accounts) {
    const rules = context.configService.listAssetRules(account.name);
    const runtimes = context.runtimeService.listRuntime({ accountName: account.name });
    const enabledRuleCount = rules.filter((item) => item.enabled).length;
    const erroredRuntimes = runtimes.filter((item) => item.apiStatus === 'error');
    const pausedRuntimes = runtimes.filter((item) => item.paused);
    const unhealthyRuntime = erroredRuntimes[0];
    const riskNotes: string[] = [];

    if (rules.length === 0) {
      riskNotes.push('No withdrawal rules configured yet');
    }
    if (rules.length > 0 && enabledRuleCount === 0) {
      riskNotes.push('All withdrawal rules are disabled');
    }
    if (runtimes.length === 0 && enabledRuleCount > 0) {
      riskNotes.push('Rules exist but no runtime checks have been recorded yet');
    }
    if (account.mode === 'live') {
      riskNotes.push('Live mode is enabled; every real withdraw still requires --confirm-live');
    }
    if (pausedRuntimes.length > 0) {
      riskNotes.push(`${pausedRuntimes.length} runtime scope(s) are paused`);
    }
    if (erroredRuntimes.length > 0) {
      riskNotes.push(`${erroredRuntimes.length} runtime scope(s) have API errors`);
    }

    printDivider();
    printSection(`Account ${account.name}`, [
      `Mode               ${account.mode}`,
      `Check interval     ${account.checkIntervalMs} ms`,
      `Cooldown           ${account.withdrawCooldownMs} ms`,
      `Rules              ${rules.length} total / ${enabledRuleCount} enabled`,
      `Runtime rows       ${runtimes.length}`,
      `Priority           ${
        erroredRuntimes.length > 0 ? 'fix errors first'
          : rules.length === 0 ? 'finish setup'
            : runtimes.length === 0 ? 'run first check'
              : account.mode === 'live' ? 'watch closely'
                : 'ready for monitoring'
      }`,
      `Risk               ${riskNotes[0] ?? 'No immediate operator risk detected'}`,
      `Last error         ${truncateValue(unhealthyRuntime?.lastError, 120)}`,
      `Next step          ${getRecommendedNextSteps(context, account.name)[0] ?? 'No action needed'}`,
    ]);
  }

  const globalRisks: string[] = [];
  if (accounts.length === 0) {
    globalRisks.push('No accounts are configured');
  }
  if (totalRules === 0 && accounts.length > 0) {
    globalRisks.push('Accounts exist, but there are no withdrawal rules yet');
  }
  if (enabledRules === 0 && totalRules > 0) {
    globalRisks.push('Rules exist, but none are enabled');
  }
  if (errorRuntimeRows > 0) {
    globalRisks.push(`${errorRuntimeRows} runtime scope(s) are currently failing`);
  }
  if (runtimeRows === 0 && enabledRules > 0) {
    globalRisks.push('Enabled rules exist, but no runtime checks have been recorded yet');
  }

  if (globalRisks.length > 0) {
    printDivider();
    printSection('Risk reminders', globalRisks.map((item, index) => `${index + 1}. ${item}`));
  }

  printDivider();
  printSection('Recommended next steps', getRecommendedNextSteps(context, accountName).map((item, index) => `${index + 1}. ${item}`));
}

function printWatchCycleHeader(title: string, details: string[]): void {
  process.stdout.write(`\n[${new Date().toISOString()}] ${title}\n`);
  for (const detail of details) {
    process.stdout.write(`  ${detail}\n`);
  }
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
  let cycle = 0;

  for (;;) {
    cycle += 1;
    const balances = await exchange.fetchAllFreeBalances();
    const enabledRuleCount = assetRules.filter((item) => item.enabled).length;
    printWatchCycleHeader(`watch cycle account=${account.name}`, [
      `cycle=${cycle}`,
      `assets=${balances.length}`,
      `enabledRules=${enabledRuleCount}`,
      `mode=${account.mode}`,
      `autoWithdraw=${autoWithdraw ? 'on' : 'off'}`,
    ]);
    for (const item of balances) {
      process.stdout.write(`  ${item.asset.padEnd(12)} ${item.free}\n`);
    }

    if (autoWithdraw) {
      if (enabledRuleCount === 0) {
        process.stdout.write('  No enabled asset rules. Skipping withdraw checks.\n');
      }
      for (const rule of assetRules.filter((item) => item.enabled)) {
        const withdrawService = new WithdrawService(exchange, context.auditService, context.runtimeService);
        const riskControl = new RiskControl();
        const monitor = new Monitor(exchange, context.runtimeService, withdrawService, context.auditService, riskControl);
        await monitor.tick(account, rule, credentials);
      }
    }

    process.stdout.write(`  Sleeping ${account.checkIntervalMs} ms before next cycle.\n`);
    await sleep(account.checkIntervalMs);
  }
}

async function runWatchAll(
  context: ReturnType<typeof createAppContext>,
  password: string,
  intervalMs?: number,
  autoWithdraw?: boolean,
): Promise<void> {
  let cycle = 0;
  for (;;) {
    cycle += 1;
    printWatchCycleHeader('watch-all cycle', [
      `cycle=${cycle}`,
      `accounts=${context.configService.listAccounts().length}`,
      `autoWithdraw=${autoWithdraw ? 'on' : 'off'}`,
      `intervalMs=${intervalMs ?? DEFAULT_ACCOUNT.checkIntervalMs}`,
    ]);
    for (const account of context.configService.listAccounts()) {
      const selectedAccount = buildAccountConfig({ ...account, checkIntervalMs: intervalMs ?? account.checkIntervalMs });
      const credentials = context.credentialService.unlock(account.name, password);
      const exchange = await initExchange(credentials);
      const balances = await exchange.fetchAllFreeBalances();
      process.stdout.write(`  account=${account.name} mode=${account.mode} assets=${balances.length}\n`);
      for (const item of balances) {
        process.stdout.write(`    ${item.asset.padEnd(12)} ${item.free}\n`);
      }

      if (autoWithdraw) {
        const rules = context.configService.listAssetRules(account.name).filter((item) => item.enabled);
        if (rules.length === 0) {
          process.stdout.write('    No enabled asset rules. Skipping withdraw checks.\n');
        }
        for (const rule of rules) {
          const withdrawService = new WithdrawService(exchange, context.auditService, context.runtimeService);
          const riskControl = new RiskControl();
          const monitor = new Monitor(exchange, context.runtimeService, withdrawService, context.auditService, riskControl);
          await monitor.tick(selectedAccount, rule, credentials);
        }
      }
    }

    process.stdout.write(`  Sleeping ${intervalMs ?? DEFAULT_ACCOUNT.checkIntervalMs} ms before next cycle.\n`);
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
    printDivider();
    printSection(`No withdraw needed for ${account.name}/${rule.asset}`, [
      `Current balance    ${balance}`,
      `Max balance        ${rule.maxBalance}`,
      `Target balance     ${rule.targetBalance}`,
      'Decision           balance is within the configured threshold',
    ]);
    return;
  }

  printWithdrawPlan(account, rule, balance, amount);
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
    .description('Inspect current readiness and print the recommended next steps')
    .action(() => {
      printDoctorSummary(context);
    });

  program
    .command('doctor')
    .description('Check current configuration state and tell the operator what to do next')
    .option('-a, --account <account>')
    .action(({ account }: { account?: string }) => {
      printDoctorSummary(context, account);
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
        printEmptyState('No runtime state found for the current filter.');
        return;
      }

      printSection('Runtime status', [
        `rows=${rows.length}`,
        `filter.account=${account ?? '*'}`,
        `filter.asset=${asset ?? '*'}`,
      ]);
      for (const row of rows) {
        printRuntimeCard(row.accountName, row.asset, row);
      }
      printDivider();
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
        `next=mexc-monitor account test -a ${account} --password '***'`,
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
          `next=mexc-monitor withdraw -a ${rule.accountName} --password '***'`,
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
      const items = context.eventLogRepo.listRecent({
        accountName: account,
        asset,
        level,
        limit: parsePositiveIntegerOption('limit', limit),
      });

      if (items.length === 0) {
        printEmptyState('No audit logs matched the current filter.');
        return;
      }

      printSection('Audit logs', [
        `rows=${items.length}`,
        `filter.account=${account ?? '*'}`,
        `filter.asset=${asset ?? '*'}`,
        `filter.level=${level ?? '*'}`,
      ]);
      for (const item of items) {
        printLogEntry(item);
      }
      printDivider();
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
      const items = context.withdrawHistoryRepo.listRecent({
        accountName: account,
        asset,
        status,
        limit: parsePositiveIntegerOption('limit', limit),
      });

      if (items.length === 0) {
        printEmptyState('No withdraw history matched the current filter.');
        return;
      }

      printSection('Withdraw history', [
        `rows=${items.length}`,
        `filter.account=${account ?? '*'}`,
        `filter.asset=${asset ?? '*'}`,
        `filter.status=${status ?? '*'}`,
      ]);
      for (const item of items) {
        printHistoryEntry(item);
      }
      printDivider();
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
