import ccxt from 'ccxt';
import type { Trade } from 'ccxt';
import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';

type NormalizedTrade = {
  id?: string;
  timestamp: number;
  datetime?: string;
  symbol?: string;
  side?: string;
  price?: number;
  amount?: number;
  cost?: number;
  takerOrMaker?: string;
  type?: string;
  info: unknown;
};

type CliOptions = {
  symbol: string;
  hours: number;
  limit: number;
  out?: string;
  pretty: boolean;
};

function assertPositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function normalizeTrade(trade: Trade): NormalizedTrade {
  return {
    id: trade.id ? String(trade.id) : undefined,
    timestamp: trade.timestamp ?? 0,
    datetime: trade.datetime,
    symbol: trade.symbol,
    side: trade.side,
    price: trade.price,
    amount: trade.amount,
    cost: trade.cost,
    takerOrMaker: trade.takerOrMaker,
    type: trade.type,
    info: trade.info,
  };
}

function buildTradeKey(trade: NormalizedTrade): string {
  return [
    trade.id ?? '',
    trade.timestamp,
    trade.price ?? '',
    trade.amount ?? '',
    trade.side ?? '',
  ].join(':');
}

async function fetchTradesWindow(options: CliOptions): Promise<NormalizedTrade[]> {
  const exchange = new ccxt.mexc({ enableRateLimit: true });
  await exchange.loadMarkets();

  if (!(options.symbol in exchange.markets)) {
    throw new Error(`Symbol not found on MEXC: ${options.symbol}`);
  }

  const now = Date.now();
  const startTime = now - options.hours * 60 * 60 * 1000;
  const maxWindowMs = 60 * 60 * 1000;
  const deduped = new Map<string, NormalizedTrade>();
  let windowStart = startTime;

  while (windowStart <= now) {
    const windowEnd = Math.min(windowStart + maxWindowMs - 1, now);
    let cursor = windowStart;

    while (cursor <= windowEnd) {
      const batch = await exchange.fetchTrades(options.symbol, cursor, options.limit, { until: windowEnd });
      if (batch.length === 0) {
        break;
      }

      let maxTimestamp = cursor;
      for (const trade of batch) {
        const normalized = normalizeTrade(trade);
        if (normalized.timestamp < startTime) {
          continue;
        }
        if (normalized.timestamp > now) {
          continue;
        }

        deduped.set(buildTradeKey(normalized), normalized);
        if (normalized.timestamp > maxTimestamp) {
          maxTimestamp = normalized.timestamp;
        }
      }

      if (maxTimestamp <= cursor) {
        break;
      }

      cursor = maxTimestamp + 1;
    }

    windowStart = windowEnd + 1;
  }

  await exchange.close();

  return [...deduped.values()].sort((left, right) => left.timestamp - right.timestamp);
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('fetch-mexc-trades')
    .description('Fetch recent public trade history from MEXC through ccxt')
    .option('-s, --symbol <symbol>', 'market symbol', 'XIN/USDT')
    .option('-H, --hours <hours>', 'lookback window in hours', '6')
    .option('-l, --limit <limit>', 'page size per exchange request', '1000')
    .option('-o, --out <path>', 'write full JSON output to a file')
    .option('--pretty', 'pretty-print JSON output', false)
    .parse(process.argv);

  const rawOptions = program.opts<{
    symbol: string;
    hours: string;
    limit: string;
    out?: string;
    pretty: boolean;
  }>();

  const options: CliOptions = {
    symbol: rawOptions.symbol.toUpperCase(),
    hours: assertPositiveInteger(rawOptions.hours, 'hours'),
    limit: assertPositiveInteger(rawOptions.limit, 'limit'),
    out: rawOptions.out,
    pretty: rawOptions.pretty,
  };

  const fetchedAt = new Date().toISOString();
  const trades = await fetchTradesWindow(options);
  const payload = {
    exchange: 'mexc',
    symbol: options.symbol,
    requestedHours: options.hours,
    fetchedAt,
    tradeCount: trades.length,
    trades,
  };

  const serialized = JSON.stringify(payload, null, options.pretty ? 2 : 0);

  if (options.out) {
    await writeFile(options.out, `${serialized}\n`, 'utf8');
    process.stdout.write(`Saved ${trades.length} trades to ${options.out}\n`);
    return;
  }

  process.stdout.write(`${serialized}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
