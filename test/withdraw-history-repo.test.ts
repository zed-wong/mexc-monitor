import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';

import { runSchema } from '../src/db/schema';
import { WithdrawHistoryRepo } from '../src/db/repo/withdraw-history-repo';

function createWithdrawHistoryRepo(): WithdrawHistoryRepo {
  const db = new Database(':memory:', { strict: true });
  runSchema(db);
  return new WithdrawHistoryRepo(db);
}

describe('WithdrawHistoryRepo', () => {
  test('persists quote metadata for withdraw history', () => {
    const repo = createWithdrawHistoryRepo();

    repo.append({
      accountName: 'main',
      createdAt: '2026-04-12T12:00:00.000Z',
      operationId: 'op-1',
      exchangeId: 'mexc',
      mode: 'dry_run',
      asset: 'BTC',
      network: 'BTC',
      amount: '0.01',
      quoteAsset: 'USDT',
      quotePrice: '63000',
      estimatedValue: '630',
      addressMasked: 'bc1q...1234',
      status: 'simulated',
      reason: 'dry_run',
    });

    expect(repo.listRecent({ limit: 1 })[0]).toMatchObject({
      asset: 'BTC',
      amount: '0.01',
      quoteAsset: 'USDT',
      quotePrice: '63000',
      estimatedValue: '630',
      status: 'simulated',
    });
  });
});
