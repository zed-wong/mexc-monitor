import { createAppContext, DEFAULT_ACCOUNT } from './app/bootstrap';
import type { AccountConfig, AddressBookEntry, AssetRule, Credentials } from './core/types';
import { Command, Option } from 'commander';
import { createExchangeAdapter } from './exchange/exchange-factory';
import { WithdrawService } from './core/withdraw-service';
import { RiskControl } from './core/risk-control';
import { Monitor } from './core/monitor';
import { computeWithdrawAmount } from './core/amount-policy';
import { sleep } from './utils/time';
import { decimal } from './utils/decimal';
import { ZodError } from 'zod';
import * as readline from 'node:readline';

const EXAMPLES = `
Examples:
  mexc-monitor account add -a main
  mexc-monitor address-book add -a main --alias treasury --asset USDT --network ERC20 --address 0xabc...
  mexc-monitor asset-rule add -a main --address-book treasury --max-balance 1000 --target-balance 200
  mexc-monitor asset-rule add -a main --asset USDT --network ERC20 --withdraw-address 0xabc... --max-balance 1000 --target-balance 200
  mexc-monitor auth set-master-password
  mexc-monitor balance check-one -a main --master-password '***'
  mexc-monitor balance check-all --master-password '***'
  mexc-monitor balance check-all-loop --interval-ms 30000 --master-password '***'
  mexc-monitor withdraw check-one -a main --master-password '***'
  mexc-monitor withdraw check-one-loop -a main --interval-ms 30000 --master-password '***'
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

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }

  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }

  return parts.join(' ');
}

function formatFilterValue(value?: string): string {
  return value ?? 'all';
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
    `API status: ${formatValue(runtime.apiStatus)}`,
    `Last balance seen: ${formatValue(runtime.lastBalance)}`,
    `Paused: ${runtime.paused ? 'yes' : 'no'}`,
    `Withdraw in progress: ${runtime.withdrawInProgress ? 'yes' : 'no'}`,
    `Cooldown until: ${formatValue(runtime.cooldownUntil)}`,
    `Last check: ${formatValue(runtime.lastCheckAt)}`,
    `Last successful check: ${formatValue(runtime.lastSuccessCheckAt)}`,
    `Last error: ${truncateValue(runtime.lastError, 120)}`,
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
  printSection(`${item.level.toUpperCase()} log at ${item.createdAt}`, [
    `Scope: ${formatValue(item.accountName)}/${formatValue(item.asset)}`,
    `Type: ${item.type}`,
    `Detail: ${truncateValue(item.message, 120)}`,
  ]);
}

function printHistoryEntry(item: {
  status: string;
  createdAt: string;
  accountName: string;
  asset: string;
  amount: string;
  network: string;
  quoteAsset?: string;
  quotePrice?: string;
  estimatedValue?: string;
  addressMasked: string;
  mode: string;
  txid?: string;
  reason?: string;
  errorMessage?: string;
}): void {
  printDivider();
  printSection(`${item.status.toUpperCase()} withdraw at ${item.createdAt}`, [
    `Scope: ${item.accountName}/${item.asset}`,
    `Amount: ${item.amount} via ${item.network}`,
    `Estimated value: ${item.estimatedValue && item.quoteAsset ? `${item.estimatedValue} ${item.quoteAsset} @ ${item.quotePrice ?? '?'} ${item.quoteAsset}` : '-'}`,
    `Target: ${item.addressMasked}`,
    `Mode: ${item.mode}`,
    `Txid: ${truncateValue(item.txid, 96)}`,
    `Reason: ${truncateValue(item.reason, 120)}`,
    `Error: ${truncateValue(item.errorMessage, 120)}`,
  ]);
}

function printWithdrawPlan(
  account: AccountConfig,
  rule: AssetRule,
  balance: string,
  amount: string,
  quote?: { asset: string; price: string; estimatedValue: string } | null,
): void {
  printDivider();
  printSection('Withdraw plan', [
    `Account            ${account.name}`,
    `Asset              ${rule.asset}`,
    `Mode               ${account.mode}`,
    `Current balance    ${balance}`,
    `Max balance        ${rule.maxBalance}`,
    `Target balance     ${rule.targetBalance}`,
    `Max value (USDT)   ${rule.maxBalanceUsdt ?? '-'}`,
    `Target value       ${rule.targetBalanceUsdt ?? '-'}`,
    `Planned amount     ${amount}`,
    `Estimated value    ${quote ? `${quote.estimatedValue} ${quote.asset} @ ${quote.price} ${quote.asset}` : 'unavailable'}`,
    `Network            ${rule.network}`,
    `Address            ${rule.withdrawAddress}`,
    `Address book       ${rule.addressBookAlias ?? '-'}`,
    `Confirm live       ${account.mode === 'live' ? 'required and provided' : 'not required (dry_run)'}`,
  ]);
}

function buildAddressBookEntry(options: {
  accountName: string;
  alias: string;
  asset: string;
  network: string;
  address: string;
  tag?: string;
  note?: string;
}): AddressBookEntry {
  return {
    accountName: options.accountName,
    alias: options.alias,
    asset: options.asset,
    network: options.network,
    address: options.address,
    tag: options.tag,
    note: options.note,
  };
}

async function fetchUsdtQuote(
  exchange: Awaited<ReturnType<typeof initExchange>>,
  asset: string,
): Promise<{ asset: 'USDT'; price: string } | null> {
  try {
    const price = await exchange.fetchQuotePrice(asset, 'USDT');
    if (!price) {
      return null;
    }
    return { asset: 'USDT', price };
  } catch {
    return null;
  }
}

async function printBalancesWithUsdtValue(
  exchange: Awaited<ReturnType<typeof initExchange>>,
  balances: Array<{ asset: string; free: string }>,
  indent = '',
): Promise<void> {
  if (balances.length === 0) {
    process.stdout.write(`${indent}No free balance returned by the exchange.\n`);
    return;
  }

  let totalUsdt = decimal(0);
  let hasEstimate = false;

  for (const item of balances) {
    const quote = await fetchUsdtQuote(exchange, item.asset);
    const estimatedValue = quote ? decimal(item.free).mul(quote.price).toFixed() : undefined;
    if (estimatedValue) {
      totalUsdt = totalUsdt.plus(estimatedValue);
      hasEstimate = true;
    }
    process.stdout.write(`${indent}${item.asset.padEnd(12)} ${item.free}${estimatedValue ? `  (~${estimatedValue} USDT)` : ''}\n`);
  }

  process.stdout.write(`${indent}Total estimated value: ${hasEstimate ? `${totalUsdt.toFixed()} USDT` : 'unavailable'}\n`);
}

function getRecommendedNextSteps(
  context: ReturnType<typeof createAppContext>,
  accountName?: string,
): string[] {
  const accounts = accountName
    ? context.configService.listAccounts().filter((item) => item.name === accountName)
    : context.configService.listAccounts();

  if (accountName && accounts.length === 0) {
    return [`Create the account first: mexc-monitor account add -a ${accountName}`];
  }

  if (accounts.length === 0) {
    return [
      "Create an account: mexc-monitor account add -a main",
      "Then verify exchange access: mexc-monitor account test -a main",
    ];
  }

  const steps: string[] = [];

  for (const account of accounts) {
    const rules = context.configService.listAssetRules(account.name);
    const enabledRules = rules.filter((item) => item.enabled);
    const runtimeRows = context.runtimeService.listRuntime({ accountName: account.name });
    const addressBookEntries = context.configService.listAddressBookEntries(account.name);

    if (rules.length === 0) {
      if (addressBookEntries.length === 0) {
        steps.push(`Add an address book entry for ${account.name}: mexc-monitor address-book add -a ${account.name} --alias treasury --asset USDT --network ERC20 --address 0xabc...`);
      }
      steps.push(`Add a withdrawal rule for ${account.name}: mexc-monitor asset-rule add -a ${account.name} --address-book treasury --max-balance 1000 --target-balance 200`);
      continue;
    }

    if (runtimeRows.length === 0) {
      steps.push(`Verify exchange access and inspect balances for ${account.name}: mexc-monitor account test -a ${account.name}`);
      steps.push(`Run one withdraw simulation for ${account.name}: mexc-monitor withdraw check-one -a ${account.name}`);
      continue;
    }

    if (enabledRules.length === 0) {
      steps.push(`Enable at least one rule for ${account.name}: mexc-monitor asset-rule enable -a ${account.name} --asset <asset>`);
      continue;
    }

    steps.push(`Review recent withdraw attempts for ${account.name}: mexc-monitor withdraw attempts -a ${account.name}`);
    steps.push(`Start continuous monitoring for ${account.name}: mexc-monitor withdraw check-one-loop -a ${account.name} --interval-ms ${account.checkIntervalMs}`);

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
  process.stdout.write(`\n${title}\n`);
  for (const detail of details) {
    process.stdout.write(`  ${detail}\n`);
  }
}

function printBalanceReadHeader(account: AccountConfig, assetCount: number): void {
  printDivider();
  printSection(`${account.name}`, [
    `Read at           ${new Date().toISOString()}`,
    `Exchange          ${account.exchangeId}`,
    `Mode              ${account.mode}`,
    `Assets            ${assetCount}`,
  ]);
}

async function promptHiddenSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive CLI master password entry requires a TTY. Re-run in a terminal or pass -p explicitly.');
  }

  return await new Promise<string>((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let secret = '';

    const cleanup = () => {
      stdin.off('keypress', onKeypress);
      if (stdin.isTTY) {
        stdin.setRawMode?.(false);
      }
      stdin.pause();
    };

    const finish = (fn: () => void) => {
      cleanup();
      stdout.write('\n');
      fn();
    };

    const onKeypress = (_str: string, key: readline.Key) => {
      if (key.ctrl && key.name === 'c') {
        finish(() => reject(new Error('CLI master password entry cancelled.')));
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish(() => resolve(secret));
        return;
      }
      if (key.name === 'backspace') {
        secret = secret.slice(0, -1);
        return;
      }
      if (key.sequence && !key.ctrl && !key.meta) {
        secret += key.sequence;
      }
    };

    readline.emitKeypressEvents(stdin);
    stdin.setRawMode?.(true);
    stdin.resume();
    stdout.write(label);
    stdin.on('keypress', onKeypress);
  });
}

async function promptLine(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive CLI entry requires a TTY. Re-run in a terminal or pass the required options explicitly.');
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return await new Promise<string>((resolve) => {
      rl.question(label, resolve);
    });
  } finally {
    rl.close();
  }
}

async function promptRequiredLine(label: string): Promise<string> {
  const value = (await promptLine(label)).trim();
  if (!value) {
    throw new Error(`${label.trim()} cannot be empty.`);
  }
  return value;
}

async function promptOptionalLine(label: string, defaultValue: string): Promise<string> {
  const value = (await promptLine(`${label} [${defaultValue}]: `)).trim();
  return value || defaultValue;
}

async function promptMode(defaultValue: 'dry_run' | 'live'): Promise<'dry_run' | 'live'> {
  const value = (await promptOptionalLine('Account mode (dry_run/live)', defaultValue)).trim();
  if (value !== 'dry_run' && value !== 'live') {
    throw new Error('Account mode must be dry_run or live.');
  }
  return value;
}

async function resolveMasterPassword(masterPassword: string | undefined, label: string): Promise<string> {
  const resolved = masterPassword ?? await promptHiddenSecret(label);
  if (!resolved) {
    throw new Error('CLI master password cannot be empty.');
  }
  return resolved;
}

async function resolveNewMasterPassword(newMasterPassword?: string): Promise<string> {
  const resolved = await resolveMasterPassword(newMasterPassword, 'New CLI master password: ');
  const confirmation = await promptHiddenSecret('Confirm new CLI master password: ');
  if (resolved !== confirmation) {
    throw new Error('CLI master password confirmation does not match.');
  }
  return resolved;
}

type MasterPasswordOptionValues = {
  masterPassword?: string;
  password?: string;
};

type RotateMasterPasswordOptionValues = {
  currentMasterPassword?: string;
  currentPassword?: string;
  newMasterPassword?: string;
  newPassword?: string;
};

function addMasterPasswordOption(command: Command): Command {
  command.option('-p, --master-password <masterPassword>', 'Use the global CLI master password directly instead of the secure prompt');
  command.addOption(
    new Option('--password <password>', 'Deprecated alias for --master-password').hideHelp(),
  );
  return command;
}

function resolveMasterPasswordOption(options: MasterPasswordOptionValues): string | undefined {
  if (
    options.masterPassword !== undefined
    && options.password !== undefined
    && options.masterPassword !== options.password
  ) {
    throw new Error('Pass either --master-password or the deprecated --password alias, not both.');
  }
  return options.masterPassword ?? options.password;
}

function resolveRotateMasterPasswordOptions(options: RotateMasterPasswordOptionValues): {
  currentMasterPassword?: string;
  newMasterPassword?: string;
} {
  const currentMasterPassword = resolveMasterPasswordOption({
    masterPassword: options.currentMasterPassword,
    password: options.currentPassword,
  });
  const newMasterPassword = resolveMasterPasswordOption({
    masterPassword: options.newMasterPassword,
    password: options.newPassword,
  });
  return { currentMasterPassword, newMasterPassword };
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
  addressBookAlias?: string;
  targetBalance?: string;
  maxBalance?: string;
  targetBalanceUsdt?: string;
  maxBalanceUsdt?: string;
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
    addressBookAlias: options.addressBookAlias,
    targetBalance: options.targetBalance ?? '0',
    maxBalance: options.maxBalance ?? '999999999',
    targetBalanceUsdt: options.targetBalanceUsdt,
    maxBalanceUsdt: options.maxBalanceUsdt,
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

function resolveAddressBookEntry(
  context: ReturnType<typeof createAppContext>,
  accountName: string,
  alias: string,
): AddressBookEntry {
  const entry = context.configService.getAddressBookEntry(accountName, alias);
  if (!entry) {
    throw new Error(`Address book entry not found: ${accountName}/${alias}`);
  }
  return entry;
}

function buildRuleDestination(
  context: ReturnType<typeof createAppContext>,
  options: {
    accountName: string;
    asset?: string;
    network?: string;
    withdrawAddress?: string;
    withdrawTag?: string;
    addressBook?: string;
  },
): Pick<AssetRule, 'asset' | 'network' | 'withdrawAddress' | 'withdrawTag' | 'addressBookAlias'> {
  if (options.addressBook) {
    const entry = resolveAddressBookEntry(context, options.accountName, options.addressBook);
    if (options.asset && options.asset !== entry.asset) {
      throw new Error(`Address book entry ${options.addressBook} is for ${entry.asset}, not ${options.asset}.`);
    }

    return {
      asset: entry.asset,
      network: options.network ?? entry.network,
      withdrawAddress: options.withdrawAddress ?? entry.address,
      withdrawTag: options.withdrawTag ?? entry.tag,
      addressBookAlias: entry.alias,
    };
  }

  if (!options.asset) {
    throw new Error('Missing required option: --asset <asset>');
  }
  if (!options.network) {
    throw new Error('Missing required option: --network <network>');
  }
  if (!options.withdrawAddress) {
    throw new Error('Missing required option: --withdraw-address <withdrawAddress>');
  }

  return {
    asset: options.asset,
    network: options.network,
    withdrawAddress: options.withdrawAddress,
    withdrawTag: options.withdrawTag,
    addressBookAlias: undefined,
  };
}

async function fetchAccountHealthCheck(
  context: ReturnType<typeof createAppContext>,
  accountName: string,
  password?: string,
  promptLabel?: string,
): Promise<{
  account: AccountConfig;
  exchange: Awaited<ReturnType<typeof createExchangeAdapter>>;
  balances: Array<{ asset: string; free: string }>;
}> {
  const selectedAccount = resolveAccount(context, accountName);
  const resolvedPassword = await resolveMasterPassword(password, promptLabel ?? 'CLI master password: ');
  const credentials = context.credentialService.unlock(accountName, resolvedPassword);
  const exchange = createExchangeAdapter(selectedAccount.exchangeId);
  await exchange.init(credentials);
  await exchange.healthCheck();
  const balances = await exchange.fetchAllFreeBalances();

  return {
    account: selectedAccount,
    exchange,
    balances,
  };
}

async function runAccountHealthCheck(
  context: ReturnType<typeof createAppContext>,
  accountName: string,
  password?: string,
  promptLabel?: string,
): Promise<void> {
  const result = await fetchAccountHealthCheck(context, accountName, password, promptLabel);

  process.stdout.write(`Account ${result.account.name} is healthy on ${result.account.exchangeId}. Mode: ${result.account.mode}.\n`);
  process.stdout.write(`Free balances: ${pluralize(result.balances.length, 'asset')}.\n`);
  await printBalancesWithUsdtValue(result.exchange, result.balances, '  ');
}

async function runBalanceCheck(
  context: ReturnType<typeof createAppContext>,
  accountName: string,
  password?: string,
  promptLabel?: string,
): Promise<void> {
  const result = await fetchAccountHealthCheck(context, accountName, password, promptLabel);

  process.stdout.write(`${result.account.name} (${result.account.exchangeId})\n`);
  process.stdout.write(`  Mode: ${result.account.mode}\n`);
  await printBalancesWithUsdtValue(result.exchange, result.balances, '  ');
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
  autoWithdraw = true,
): Promise<void> {
  const exchange = await initExchange(credentials);
  let cycle = 0;
  const enabledRuleCount = assetRules.filter((item) => item.enabled).length;

  for (;;) {
    cycle += 1;
    const balances = await exchange.fetchAllFreeBalances();
    printWatchCycleHeader(`Balance watch: ${account.name}`, [
      `Cycle             ${cycle}`,
      `Started at        ${new Date().toISOString()}`,
      `Mode              ${account.mode}`,
      `Assets found      ${balances.length}`,
      `Withdraw rules    ${enabledRuleCount} enabled`,
      `Auto withdraw     ${autoWithdraw ? 'on' : 'off'}`,
      `Next scan         ${formatDurationMs(account.checkIntervalMs)}`,
    ]);
    await printBalancesWithUsdtValue(exchange, balances, '  ');

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

    process.stdout.write(`  Next scan in ${formatDurationMs(account.checkIntervalMs)}.\n`);
    await sleep(account.checkIntervalMs);
  }
}

async function runWatchAll(
  context: ReturnType<typeof createAppContext>,
  password?: string,
  intervalMs?: number,
  autoWithdraw = false,
): Promise<void> {
  const resolvedPassword = await resolveMasterPassword(password, 'CLI master password for all accounts: ');
  let cycle = 0;
  const watchIntervalMs = intervalMs ?? DEFAULT_ACCOUNT.checkIntervalMs;
  for (;;) {
    cycle += 1;
    try {
      const accounts = context.configService.listAccounts();
      printWatchCycleHeader('Balance watch: all accounts', [
        `Cycle             ${cycle}`,
        `Started at        ${new Date().toISOString()}`,
        `Accounts          ${accounts.length}`,
        `Scan interval     ${formatDurationMs(watchIntervalMs)}`,
        `Auto withdraw     ${autoWithdraw ? 'on' : 'off'}`,
      ]);
      for (const account of accounts) {
        try {
          const selectedAccount = buildAccountConfig({ ...account, checkIntervalMs: intervalMs ?? account.checkIntervalMs });
          const credentials = context.credentialService.unlock(account.name, resolvedPassword);
          const exchange = await initExchange(credentials);
          const balances = await exchange.fetchAllFreeBalances();
          printBalanceReadHeader(selectedAccount, balances.length);
          await printBalancesWithUsdtValue(exchange, balances, '    ');

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
        } catch (error) {
          process.stderr.write(
            `Watch warning: account ${account.name} failed during cycle ${cycle}: ${formatErrorMessage(error)}\n`,
          );
        }
      }
    } catch (error) {
      process.stderr.write(
        `Watch warning: full scan failed during cycle ${cycle}: ${formatErrorMessage(error)}\n`,
      );
    }

    process.stdout.write(`
Next full scan in ${formatDurationMs(watchIntervalMs)}.
`);
    await sleep(watchIntervalMs);
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
  const quote = await fetchUsdtQuote(exchange, rule.asset);
  const amount = computeWithdrawAmount(balance, { ...rule, ...account }, quote?.price);

  if (!amount) {
    printDivider();
    printSection(`No withdraw needed for ${account.name}/${rule.asset}`, [
      `Current balance    ${balance}`,
      `Max balance        ${rule.maxBalance}`,
      `Target balance     ${rule.targetBalance}`,
      `Max value (USDT)   ${rule.maxBalanceUsdt ?? '-'}`,
      `Target value       ${rule.targetBalanceUsdt ?? '-'}`,
      'Decision           balance is within the configured threshold',
    ]);
    return;
  }

  printWithdrawPlan(account, rule, balance, amount, quote ? {
    asset: quote.asset,
    price: quote.price,
    estimatedValue: decimal(amount).mul(quote.price).toFixed(),
  } : null);
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

  const accountCommand = program.command('account').description('Manage exchange account');
  const addressBookCommand = program.command('address-book').description('Manage saved withdrawal destinations');
  const assetRule = program.command('asset-rule').description('Manage asset withdrawal rules');
  const balanceCommand = program.command('balance').description('Balance operations');
  const withdrawCommand = program.command('withdraw').description('Withdraw operations');

  async function promptExchangeCredentials(accountName: string): Promise<{ apiKey: string; apiSecret: string }> {
    process.stdout.write(`Enter exchange credentials for ${accountName}. Input is hidden.\n`);
    const apiKey = await promptHiddenSecret('MEXC API key: ');
    const apiSecret = await promptHiddenSecret('MEXC API secret: ');
    if (!apiKey || !apiSecret) {
      throw new Error('MEXC API key and secret cannot be empty.');
    }
    return { apiKey, apiSecret };
  }


  async function saveAccountFromPrompt(options: {
    account?: string;
    masterPassword?: string;
    password?: string;
    intervalMs?: string;
    withdrawCooldownMs?: string;
    mode?: 'dry_run' | 'live';
    updateCredentials?: boolean;
  }): Promise<void> {
    const { account, masterPassword, password, intervalMs, withdrawCooldownMs, mode, updateCredentials } = options;

    const resolvedAccount = account ?? await promptRequiredLine('Account name: ');
    const existingAccount = context.configService.getAccount(resolvedAccount);
    const existingSecrets = context.configService.getSecretsForAccount(resolvedAccount);
    const isNewAccount = !existingAccount;
    const baseAccount = existingAccount ?? DEFAULT_ACCOUNT;

    if (mode && mode !== 'dry_run' && mode !== 'live') {
      throw new Error('--mode must be dry_run or live');
    }

    const wantsCredentialUpdate = isNewAccount || Boolean(updateCredentials);
    const resolvedMode = mode ?? await promptMode(baseAccount.mode);
    const resolvedIntervalMs = intervalMs
      ? parsePositiveIntegerOption('interval-ms', intervalMs)
      : parsePositiveIntegerOption('interval-ms', await promptOptionalLine('Check interval in milliseconds', String(baseAccount.checkIntervalMs)));
    const resolvedWithdrawCooldownMs = withdrawCooldownMs
      ? parseIntegerOption('withdraw-cooldown-ms', withdrawCooldownMs)
      : parseIntegerOption('withdraw-cooldown-ms', await promptOptionalLine('Withdraw cooldown in milliseconds', String(baseAccount.withdrawCooldownMs)));

    const providedMasterPassword = resolveMasterPasswordOption({ masterPassword, password });
    const resolvedPassword = wantsCredentialUpdate
      ? await resolveMasterPassword(providedMasterPassword, 'CLI master password for ' + resolvedAccount + ': ')
      : undefined;

    const promptedCredentials = wantsCredentialUpdate
      ? await promptExchangeCredentials(resolvedAccount)
      : undefined;

    const sealed = wantsCredentialUpdate
      ? context.credentialService.updateCredentials(resolvedPassword!, promptedCredentials!)
      : existingSecrets;

    if (!sealed) {
      throw new Error(`Credentials not configured for account: ${resolvedAccount}. Re-run with: mexc-monitor account add -a ${resolvedAccount} --update-credentials`);
    }

    const savedAccount = buildAccountConfig({
      ...baseAccount,
      name: resolvedAccount,
      checkIntervalMs: resolvedIntervalMs,
      withdrawCooldownMs: resolvedWithdrawCooldownMs,
      mode: resolvedMode,
    });

    context.configService.saveAccount(savedAccount, sealed);
    printSection(isNewAccount ? 'Account added' : 'Account updated', [
      `${resolvedAccount} is set to ${savedAccount.mode} mode on MEXC.`,
      `Check interval: ${savedAccount.checkIntervalMs} ms. Withdraw cooldown: ${savedAccount.withdrawCooldownMs} ms.`,
      wantsCredentialUpdate ? 'Stored API credentials were updated through the interactive prompt.' : 'Stored API credentials were left unchanged.',
      `Next step: mexc-monitor balance check-one -a ${resolvedAccount}`,
    ]);
  }

  async function runBalanceAllCheck(masterPassword?: string, showHealthText = false): Promise<void> {
    const accounts = context.configService.listAccounts();
    if (accounts.length === 0) {
      printEmptyState("No accounts configured yet. Create one with: mexc-monitor account add -a main");
      return;
    }

    let passed = 0;
    let failed = 0;
    process.stdout.write(`Checking ${pluralize(accounts.length, 'account')} concurrently.\n`);
    const resolvedPassword = await resolveMasterPassword(masterPassword, 'CLI master password: ');
    context.credentialService.unlock(accounts[0].name, resolvedPassword);
    if (showHealthText) {
      process.stdout.write('CLI master password verified. Starting account health checks now.\n');
    }

    const pending = new Map(accounts.map((account) => {
      const promise = fetchAccountHealthCheck(context, account.name, resolvedPassword)
        .then((result) => ({ ok: true as const, account, result }))
        .catch((error) => ({
          ok: false as const,
          account,
          error: truncateValue(error instanceof Error ? error.message : String(error), 160),
        }));
      return [account.name, promise] as const;
    }));

    while (pending.size > 0) {
      const settled = await Promise.race(
        Array.from(pending.entries(), ([accountName, promise]) => promise.then((value) => ({ accountName, value }))),
      );
      pending.delete(settled.accountName);

      if (settled.value.ok) {
        passed += 1;
        const result = settled.value.result;
        process.stdout.write(`\n${result.account.name} (${result.account.exchangeId})\n`);
        if (showHealthText) {
          process.stdout.write(`  Health check passed. Mode: ${result.account.mode}.\n`);
        } else {
          process.stdout.write(`  Mode: ${result.account.mode}\n`);
        }
        if (result.balances.length === 0) {
          process.stdout.write('  No free balance returned by the exchange.\n');
        } else {
          await printBalancesWithUsdtValue(result.exchange, result.balances, '  ');
        }
        continue;
      }

      failed += 1;
      process.stdout.write(`\n${settled.value.account.name} (${settled.value.account.exchangeId})\n`);
      process.stdout.write(`  Health check failed: ${settled.value.error}\n`);
    }

    if (showHealthText) {
      process.stdout.write(`\nFinished. Healthy: ${passed}. Failed: ${failed}.\n`);
    } else {
      process.stdout.write(`\nFinished. Accounts: ${accounts.length}. Failed: ${failed}.\n`);
    }

    if (failed > 0) {
      process.exitCode = 1;
    }
  }

  addMasterPasswordOption(accountCommand
    .command('add')
    .description('Create or update an account through an interactive setup flow')
    .option('-a, --account <account>')
    .option('--interval-ms <intervalMs>')
    .option('--withdraw-cooldown-ms <withdrawCooldownMs>')
    .option('--mode <mode>')
    .option('--update-credentials'))
    .action(saveAccountFromPrompt);

  addMasterPasswordOption(accountCommand.command('test')
    .description('Reference alias for balance check-one')
    .requiredOption('-a, --account <account>'))
    .action(async ({ account, masterPassword, password }: { account: string; masterPassword?: string; password?: string }) => {
      await runAccountHealthCheck(context, account, resolveMasterPasswordOption({ masterPassword, password }));
    });

  addMasterPasswordOption(accountCommand.command('test-all')
    .description('Reference alias for balance check-all')
  ).action(async ({ masterPassword, password }: { masterPassword?: string; password?: string }) => {
      await runBalanceAllCheck(resolveMasterPasswordOption({ masterPassword, password }), true);
    });

  accountCommand.command('list').description('List configured accounts').action(() => {
    const accounts = context.configService.listAccounts();
    if (accounts.length === 0) {
      printEmptyState("No accounts configured yet. Create one with: mexc-monitor account add -a main");
      return;
    }

    printSection('Accounts', [
      `Configured ${pluralize(accounts.length, 'account')} on MEXC.`,
    ]);
    for (const account of accounts) {
      process.stdout.write(`  ${account.name}: ${account.mode} mode, check every ${account.checkIntervalMs} ms, cooldown ${account.withdrawCooldownMs} ms.\n`);
    }
  });

  accountCommand.command('show')
    .description('Show one account configuration')
    .requiredOption('-a, --account <account>')
    .action(({ account }: { account: string }) => {
      printKeyValue('Account', resolveAccount(context, account) as unknown as Record<string, unknown>);
    });

  accountCommand.command('rename')
    .description('Rename an account and move its asset rules with it')
    .requiredOption('-a, --account <account>')
    .requiredOption('--to <to>')
    .action(({ account, to }: { account: string; to: string }) => {
      context.configService.renameAccount(account, to);
      process.stdout.write(`Renamed account ${account} to ${to}.\n`);
    });

  accountCommand.command('remove')
    .description('Remove an account and its encrypted credentials')
    .requiredOption('-a, --account <account>')
    .action(({ account }: { account: string }) => {
      context.configService.removeAccount(account);
      process.stdout.write(`Removed account ${account}.\n`);
    });

  addressBookCommand
    .command('add')
    .description('Save a withdrawal destination under a reusable alias')
    .requiredOption('-a, --account <account>', 'Account name this address book entry belongs to')
    .requiredOption('--alias <alias>', 'Short alias used when creating withdrawal rules')
    .requiredOption('--asset <asset>', 'Asset symbol this destination is intended for')
    .requiredOption('--network <network>', 'Withdrawal network to use on the exchange')
    .requiredOption('--address <address>', 'Destination address')
    .option('--tag <tag>', 'Optional memo, tag, or payment ID')
    .option('--note <note>', 'Free-form note to describe this destination')
    .action((options: {
      account: string; alias: string; asset: string; network: string; address: string; tag?: string; note?: string;
    }) => {
      const account = resolveAccount(context, options.account);
      const entry = buildAddressBookEntry({
        accountName: account.name,
        alias: options.alias,
        asset: options.asset,
        network: options.network,
        address: options.address,
        tag: options.tag,
        note: options.note,
      });

      return createExchangeAdapter(account.exchangeId).validateConfig({
        asset: entry.asset,
        network: entry.network,
        address: entry.address,
      }).then(() => {
        context.configService.saveAddressBookEntry(entry);
        printSection('Address book entry saved', [
          `${entry.alias} is ready for ${entry.accountName}.`,
          `Destination: ${entry.asset} on ${entry.network}.`,
          `Next step: mexc-monitor asset-rule add -a ${entry.accountName} --address-book ${entry.alias} --max-balance 1000 --target-balance 200`,
        ]);
      });
    });

  addressBookCommand
    .command('update')
    .description('Update a saved withdrawal destination')
    .requiredOption('-a, --account <account>')
    .requiredOption('--alias <alias>')
    .option('--asset <asset>')
    .option('--network <network>')
    .option('--address <address>')
    .option('--tag <tag>')
    .option('--note <note>')
    .action((options: {
      account: string; alias: string; asset?: string; network?: string; address?: string; tag?: string; note?: string;
    }) => {
      const existing = resolveAddressBookEntry(context, options.account, options.alias);
      const entry = buildAddressBookEntry({
        accountName: existing.accountName,
        alias: existing.alias,
        asset: options.asset ?? existing.asset,
        network: options.network ?? existing.network,
        address: options.address ?? existing.address,
        tag: options.tag ?? existing.tag,
        note: options.note ?? existing.note,
      });

      return createExchangeAdapter(resolveAccount(context, existing.accountName).exchangeId).validateConfig({
        asset: entry.asset,
        network: entry.network,
        address: entry.address,
      }).then(() => {
        context.configService.saveAddressBookEntry(entry);
        process.stdout.write(`Updated address book entry ${entry.accountName}/${entry.alias}.\n`);
      });
    });

  addressBookCommand
    .command('list')
    .description('List saved withdrawal destinations')
    .requiredOption('-a, --account <account>')
    .action(({ account }: { account: string }) => {
      const entries = context.configService.listAddressBookEntries(account);
      if (entries.length === 0) {
        printEmptyState(`No address book entries configured for ${account}. Add one with: mexc-monitor address-book add -a ${account} --alias treasury --asset USDT --network ERC20 --address 0xabc...`);
        return;
      }

      printSection('Address book', [
        `${account} has ${pluralize(entries.length, 'saved destination')}.`,
      ]);
      for (const entry of entries) {
        process.stdout.write(`  ${entry.alias}: ${entry.asset} on ${entry.network} -> ${entry.address}${entry.note ? ` (${entry.note})` : ''}\n`);
      }
    });

  addressBookCommand
    .command('show')
    .description('Show one saved withdrawal destination')
    .requiredOption('-a, --account <account>')
    .requiredOption('--alias <alias>')
    .action(({ account, alias }: { account: string; alias: string }) => {
      printKeyValue('Address Book Entry', resolveAddressBookEntry(context, account, alias) as unknown as Record<string, unknown>);
    });

  addressBookCommand
    .command('remove')
    .description('Delete a saved withdrawal destination')
    .requiredOption('-a, --account <account>')
    .requiredOption('--alias <alias>')
    .action(({ account, alias }: { account: string; alias: string }) => {
      resolveAddressBookEntry(context, account, alias);
      context.configService.removeAddressBookEntry(account, alias);
      process.stdout.write(`Removed address book entry ${account}/${alias}.\n`);
    });

  assetRule
    .command('add')
    .description('Create a new rule for when and where an asset should be withdrawn')
    .requiredOption('-a, --account <account>', 'Account name this rule belongs to')
    .option('--asset <asset>', 'Asset symbol to monitor and withdraw, for example BTC or USDT')
    .option('--network <network>', 'Withdrawal network to use on the exchange, for example ERC20 or BTC')
    .option('--withdraw-address <withdrawAddress>', 'Destination address for the withdrawal')
    .option('--address-book <addressBook>', 'Use a saved address book alias instead of typing address details')
    .option('--max-balance <maxBalance>', 'Trigger when on-exchange asset balance rises above this amount')
    .option('--target-balance <targetBalance>', 'After a quantity-based trigger, withdraw back down to this remaining balance', '0')
    .option('--max-balance-usdt <maxBalanceUsdt>', 'Trigger when the estimated USDT value rises above this amount')
    .option('--target-balance-usdt <targetBalanceUsdt>', 'After a USDT-value trigger, withdraw back down to this estimated remaining value')
    .option('--min-withdraw-amount <minWithdrawAmount>', 'Reject withdraws smaller than this amount', '0')
    .option('--max-withdraw-amount <maxWithdrawAmount>', 'Reject withdraws larger than this amount', '999999999')
    .option('--withdraw-tag <withdrawTag>', 'Optional memo, tag, or payment ID required by some networks and destinations')
    .action((options: {
      account: string; asset?: string; network?: string; withdrawAddress?: string; addressBook?: string; maxBalance?: string; targetBalance: string;
      maxBalanceUsdt?: string; targetBalanceUsdt?: string; minWithdrawAmount: string; maxWithdrawAmount: string; withdrawTag?: string;
    }, command) => {
      const account = resolveAccount(context, options.account);
      const destination = buildRuleDestination(context, {
        accountName: account.name,
        asset: options.asset,
        network: options.network,
        withdrawAddress: options.withdrawAddress,
        withdrawTag: options.withdrawTag,
        addressBook: options.addressBook,
      });
      const rule = buildAssetRule({
        accountName: account.name,
        asset: destination.asset,
        network: destination.network,
        withdrawAddress: destination.withdrawAddress,
        maxBalance: options.maxBalance,
        targetBalance: options.targetBalance,
        maxBalanceUsdt: options.maxBalanceUsdt,
        targetBalanceUsdt: options.targetBalanceUsdt,
        minWithdrawAmount: options.minWithdrawAmount,
        maxWithdrawAmount: options.maxWithdrawAmount,
        withdrawTag: destination.withdrawTag,
        addressBookAlias: destination.addressBookAlias,
      });
      void command;
      return validateAssetRuleForExchange(rule).then(() => {
        context.configService.saveAssetRule(rule);
        printSection('Asset rule saved', [
          `${rule.asset} on ${rule.network} is now configured for ${rule.accountName}.`,
          `Destination source: ${rule.addressBookAlias ? `address-book/${rule.addressBookAlias}` : 'inline address'}.`,
          `Target balance: ${rule.targetBalance}. Max balance: ${rule.maxBalance}.`,
          `USDT thresholds: target ${rule.targetBalanceUsdt ?? '-'}, max ${rule.maxBalanceUsdt ?? '-'}.`,
          `Rule is enabled and ready to evaluate.`,
          `Next step: mexc-monitor withdraw check-one -a ${rule.accountName}`,
        ]);
      });
    });

  assetRule
    .command('update')
    .description('Change thresholds, destination, or limits on an existing rule')
    .requiredOption('-a, --account <account>')
    .requiredOption('--asset <asset>')
    .option('--network <network>')
    .option('--withdraw-address <withdrawAddress>')
    .option('--address-book <addressBook>')
    .option('--max-balance <maxBalance>')
    .option('--target-balance <targetBalance>')
    .option('--max-balance-usdt <maxBalanceUsdt>')
    .option('--target-balance-usdt <targetBalanceUsdt>')
    .option('--min-withdraw-amount <minWithdrawAmount>')
    .option('--max-withdraw-amount <maxWithdrawAmount>')
    .option('--withdraw-tag <withdrawTag>')
    .action((options: {
      account: string; asset: string; network?: string; withdrawAddress?: string; addressBook?: string; maxBalance?: string; targetBalance?: string;
      maxBalanceUsdt?: string; targetBalanceUsdt?: string; minWithdrawAmount?: string; maxWithdrawAmount?: string; withdrawTag?: string;
    }) => {
      const existing = context.configService.listAssetRules(options.account).find((item) => item.asset === options.asset);
      if (!existing) {
        throw new Error(`Asset rule not found: ${options.account}/${options.asset}`);
      }
      const destination = options.addressBook
        ? buildRuleDestination(context, {
            accountName: existing.accountName,
            asset: existing.asset,
            network: options.network,
            withdrawAddress: options.withdrawAddress,
            withdrawTag: options.withdrawTag,
            addressBook: options.addressBook,
          })
        : {
            asset: existing.asset,
            network: options.network ?? existing.network,
            withdrawAddress: options.withdrawAddress ?? existing.withdrawAddress,
            withdrawTag: options.withdrawTag ?? existing.withdrawTag,
            addressBookAlias: options.network || options.withdrawAddress || options.withdrawTag ? undefined : existing.addressBookAlias,
          };
      const rule = {
        ...existing,
        network: destination.network,
        withdrawAddress: destination.withdrawAddress,
        maxBalance: options.maxBalance ?? existing.maxBalance,
        targetBalance: options.targetBalance ?? existing.targetBalance,
        maxBalanceUsdt: options.maxBalanceUsdt ?? existing.maxBalanceUsdt,
        targetBalanceUsdt: options.targetBalanceUsdt ?? existing.targetBalanceUsdt,
        minWithdrawAmount: options.minWithdrawAmount ?? existing.minWithdrawAmount,
        maxWithdrawAmount: options.maxWithdrawAmount ?? existing.maxWithdrawAmount,
        withdrawTag: destination.withdrawTag,
        addressBookAlias: destination.addressBookAlias,
      };
      return validateAssetRuleForExchange(rule).then(() => {
        context.configService.saveAssetRule(rule);
        process.stdout.write(`Updated withdrawal rule ${rule.accountName}/${rule.asset}.\n`);
      });
    });

  assetRule
    .command('enable')
    .description('Turn a rule on so withdraw checks can use it')
    .requiredOption('-a, --account <account>')
    .requiredOption('--asset <asset>')
    .action(({ account, asset }: { account: string; asset: string }) => {
      const existing = context.configService.listAssetRules(account).find((item) => item.asset === asset);
      if (!existing) {
        throw new Error(`Asset rule not found: ${account}/${asset}`);
      }
      context.configService.saveAssetRule({ ...existing, enabled: true });
      process.stdout.write(`Enabled withdrawal rule ${account}/${asset}.\n`);
    });

  assetRule
    .command('disable')
    .description('Turn a rule off without deleting its configuration')
    .requiredOption('-a, --account <account>')
    .requiredOption('--asset <asset>')
    .action(({ account, asset }: { account: string; asset: string }) => {
      const existing = context.configService.listAssetRules(account).find((item) => item.asset === asset);
      if (!existing) {
        throw new Error(`Asset rule not found: ${account}/${asset}`);
      }
      context.configService.saveAssetRule({ ...existing, enabled: false });
      process.stdout.write(`Disabled withdrawal rule ${account}/${asset}.\n`);
    });

  assetRule.command('list')
    .description('Show every rule configured for an account')
    .requiredOption('-a, --account <account>')
    .action(({ account }: { account: string }) => {
      const rules = context.configService.listAssetRules(account);
      if (rules.length === 0) {
        printEmptyState(`No asset rules configured for ${account}. Add one with: mexc-monitor asset-rule add -a ${account} --address-book treasury --max-balance 1000 --target-balance 200`);
        return;
      }

      printSection('Asset rules', [
        `${account} has ${pluralize(rules.length, 'withdrawal rule')}.`,
      ]);
      for (const rule of rules) {
        process.stdout.write(`  ${rule.asset} on ${rule.network}: target ${rule.targetBalance}, max ${rule.maxBalance}, enabled ${rule.enabled ? 'yes' : 'no'}, destination ${rule.addressBookAlias ?? 'inline'}.\n`);
      }
    });

  assetRule.command('show')
    .description('Show the full configuration for one rule')
    .requiredOption('-a, --account <account>')
    .option('--asset <asset>')
    .action(({ account, asset }: { account: string; asset?: string }) => {
      printKeyValue('Asset Rule', resolveAssetRule(context, account, asset) as unknown as Record<string, unknown>);
    });

  assetRule
    .command('remove')
    .description('Delete a rule completely')
    .requiredOption('-a, --account <account>')
    .requiredOption('--asset <asset>')
    .action(({ account, asset }: { account: string; asset: string }) => {
      context.configService.removeAssetRule(account, asset);
      process.stdout.write(`Removed withdrawal rule ${account}/${asset}.\n`);
    });

  addMasterPasswordOption(balanceCommand
    .command('check-one')
    .description('Read balances for one account')
    .requiredOption('-a, --account <account>'))
    .action(async ({ account, masterPassword, password }: { account: string; masterPassword?: string; password?: string }) => {
      await runBalanceCheck(context, account, resolveMasterPasswordOption({ masterPassword, password }));
    });

  addMasterPasswordOption(balanceCommand
    .command('check-one-loop')
    .description('Continuously print balances for one account')
    .requiredOption('-a, --account <account>')
    .option('--interval-ms <intervalMs>', '', '30000'))
    .action(async ({ account, masterPassword, password, intervalMs }: {
      account: string; masterPassword?: string; password?: string; intervalMs: string;
    }) => {
      const selectedAccount = buildAccountConfig({
        ...resolveAccount(context, account),
        checkIntervalMs: parsePositiveIntegerOption('interval-ms', intervalMs),
      });
      const resolvedPassword = await resolveMasterPassword(
        resolveMasterPasswordOption({ masterPassword, password }),
        'CLI master password for ' + account + ': ',
      );
      const credentials = context.credentialService.unlock(account, resolvedPassword);
      await runWatchLoop(context, credentials, selectedAccount, context.configService.listAssetRules(account), false);
    });

  addMasterPasswordOption(balanceCommand
    .command('check-all')
    .description('Read balances for every configured account'))
    .action(async ({ masterPassword, password }: { masterPassword?: string; password?: string }) => {
      await runBalanceAllCheck(resolveMasterPasswordOption({ masterPassword, password }), false);
    });

  addMasterPasswordOption(balanceCommand
    .command('check-all-loop')
    .description('Continuously print balances for all configured accounts')
    .option('--interval-ms <intervalMs>'))
    .action(async ({ masterPassword, password, intervalMs }: {
      masterPassword?: string; password?: string; intervalMs?: string;
    }) => {
      const accounts = context.configService.listAccounts();
      if (accounts.length === 0) {
        throw new Error('No accounts configured.');
      }
      await runWatchAll(
        context,
        resolveMasterPasswordOption({ masterPassword, password }),
        intervalMs ? parsePositiveIntegerOption('interval-ms', intervalMs) : undefined,
        false,
      );
    });

  addMasterPasswordOption(withdrawCommand
    .command('check-one')
    .description('Run one withdraw check for all enabled rules on an account')
    .requiredOption('-a, --account <account>')
    .option('--confirm-live'))
    .action(async ({ account, masterPassword, password, confirmLive }: {
      account: string; masterPassword?: string; password?: string; confirmLive?: boolean;
    }) => {
      const selectedAccount = resolveAccount(context, account);
      assertLiveConfirmation(selectedAccount, confirmLive);
      const resolvedPassword = await resolveMasterPassword(
        resolveMasterPasswordOption({ masterPassword, password }),
        'CLI master password for ' + account + ': ',
      );
      const credentials = context.credentialService.unlock(account, resolvedPassword);
      const rules = context.configService.listAssetRules(account).filter((item) => item.enabled);
      if (rules.length === 0) {
        printSection('Withdraw check skipped', [
          `${account} has no enabled withdrawal rules to evaluate.`,
          `Next step: mexc-monitor asset-rule add -a ${account} --address-book treasury --max-balance 1000 --target-balance 200`,
        ]);
        return;
      }
      for (const rule of rules) {
        await runSingleWithdrawCheck(context, credentials, selectedAccount, rule);
      }
      printSection('Withdraw check complete', [
        `Finished evaluating ${pluralize(rules.length, 'enabled rule')} for ${account}.`,
      ]);
    });

  addMasterPasswordOption(withdrawCommand
    .command('check-one-loop')
    .description('Continuously monitor and withdraw for one account')
    .requiredOption('-a, --account <account>')
    .option('--interval-ms <intervalMs>', '', '30000')
    .option('--confirm-live'))
    .action(async ({ account, masterPassword, password, intervalMs, confirmLive }: {
      account: string; masterPassword?: string; password?: string; intervalMs: string; confirmLive?: boolean;
    }) => {
      const selectedAccount = buildAccountConfig({
        ...resolveAccount(context, account),
        checkIntervalMs: parsePositiveIntegerOption('interval-ms', intervalMs),
      });
      assertLiveConfirmation(selectedAccount, confirmLive);
      const resolvedPassword = await resolveMasterPassword(
        resolveMasterPasswordOption({ masterPassword, password }),
        'CLI master password for ' + account + ': ',
      );
      const credentials = context.credentialService.unlock(account, resolvedPassword);
      const rules = context.configService.listAssetRules(account).filter((item) => item.enabled);
      await runWatchLoop(context, credentials, selectedAccount, rules, true);
    });

  addMasterPasswordOption(withdrawCommand
    .command('check-all')
    .description('Run one withdraw check for every configured account')
    .option('--confirm-live'))
    .action(async ({ masterPassword, password, confirmLive }: {
      masterPassword?: string; password?: string; confirmLive?: boolean;
    }) => {
      const accounts = context.configService.listAccounts();
      if (accounts.length === 0) {
        throw new Error('No accounts configured.');
      }
      assertLiveConfirmationForAccounts(accounts, confirmLive);
      const resolvedPassword = await resolveMasterPassword(
        resolveMasterPasswordOption({ masterPassword, password }),
        'CLI master password for all accounts: ',
      );

      let enabledRuleCount = 0;
      for (const account of accounts) {
        const selectedAccount = resolveAccount(context, account.name);
        const credentials = context.credentialService.unlock(account.name, resolvedPassword);
        const rules = context.configService.listAssetRules(account.name).filter((item) => item.enabled);
        enabledRuleCount += rules.length;
        if (rules.length === 0) {
          printSection('Withdraw check skipped', [
            `${account.name} has no enabled withdrawal rules to evaluate.`,
          ]);
          continue;
        }
        for (const rule of rules) {
          await runSingleWithdrawCheck(context, credentials, selectedAccount, rule);
        }
      }
      printSection('Withdraw-all complete', [
        enabledRuleCount > 0
          ? `Finished evaluating ${pluralize(enabledRuleCount, 'enabled rule')} across ${pluralize(accounts.length, 'account')}.`
          : `No enabled withdrawal rules were found across ${pluralize(accounts.length, 'account')}.`,
      ]);
    });

  addMasterPasswordOption(withdrawCommand
    .command('check-all-loop')
    .description('Continuously monitor and withdraw for every configured account')
    .option('--interval-ms <intervalMs>')
    .option('--confirm-live'))
    .action(async ({ masterPassword, password, intervalMs, confirmLive }: {
      masterPassword?: string; password?: string; intervalMs?: string; confirmLive?: boolean;
    }) => {
      const accounts = context.configService.listAccounts();
      if (accounts.length === 0) {
        throw new Error('No accounts configured.');
      }
      assertLiveConfirmationForAccounts(accounts, confirmLive);
      await runWatchAll(
        context,
        resolveMasterPasswordOption({ masterPassword, password }),
        intervalMs ? parsePositiveIntegerOption('interval-ms', intervalMs) : undefined,
        true,
      );
    });

  program
    .command('doctor')
    .description('Check current configuration state and tell the operator what to do next')
    .option('-a, --account <account>')
    .action(({ account }: { account?: string }) => {
      printDoctorSummary(context, account);
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
        `Showing ${pluralize(items.length, 'log entry')}.`,
        `Account filter: ${formatFilterValue(account)}.`,
        `Asset filter: ${formatFilterValue(asset)}.`,
        `Level filter: ${formatFilterValue(level)}.`,
      ]);
      for (const item of items) {
        printLogEntry(item);
      }
      printDivider();
    });

  withdrawCommand.command('attempts')
    .description('Show recent withdraw attempts and recorded outcomes')
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
        printEmptyState('No withdraw attempts matched the current filter.');
        return;
      }

      printSection('Withdraw attempts', [
        `Showing ${pluralize(items.length, 'attempt entry')}.`,
        `Account filter: ${formatFilterValue(account)}.`,
        `Asset filter: ${formatFilterValue(asset)}.`,
        `Status filter: ${formatFilterValue(status)}.`,
      ]);
      for (const item of items) {
        printHistoryEntry(item);
      }
      printDivider();
    });

  const authCommand = program.command('auth').description('Manage global CLI master password');

  authCommand.command('set-master-password')
    .description('Initialize or rotate the global CLI master password and re-encrypt stored accounts')
    .option('--current-master-password <currentMasterPassword>')
    .addOption(new Option('--current-password <currentPassword>', 'Deprecated alias for --current-master-password').hideHelp())
    .option('--new-master-password <newMasterPassword>')
    .addOption(new Option('--new-password <newPassword>', 'Deprecated alias for --new-master-password').hideHelp())
    .action(async (options: RotateMasterPasswordOptionValues) => {
      const { currentMasterPassword, newMasterPassword } = resolveRotateMasterPasswordOptions(options);
      const accountCount = context.configService.listAccounts().length;
      const requiresCurrentMasterPassword = context.cliAuthService.isConfigured() || accountCount > 0;
      const resolvedCurrentMasterPassword = requiresCurrentMasterPassword
        ? await resolveMasterPassword(currentMasterPassword, accountCount > 0 ? 'Current CLI master password: ' : 'Existing CLI master password: ')
        : undefined;
      const resolvedNewMasterPassword = await resolveNewMasterPassword(newMasterPassword);
      const rotatedAccounts = context.credentialService.rotateMasterPassword(
        resolvedCurrentMasterPassword,
        resolvedNewMasterPassword,
      );

      printSection('CLI master password updated', [
        requiresCurrentMasterPassword
          ? `Re-encrypted ${pluralize(rotatedAccounts, 'account')} with the new CLI master password.`
          : 'CLI master password initialized.',
      ]);
    });

  authCommand.command('status')
    .description('Show global CLI master password status')
    .action(() => {
      printSection('CLI master password', [
        context.cliAuthService.isConfigured()
          ? 'A CLI master password is configured.'
          : 'No CLI master password is configured yet.',
        `Stored accounts: ${pluralize(context.configService.listAccounts().length, 'account')}.`,
      ]);
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
