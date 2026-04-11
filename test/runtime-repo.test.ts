import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';

import { runSchema } from '../src/db/schema';
import { RuntimeRepo } from '../src/db/repo/runtime-repo';

function createRuntimeRepo(): RuntimeRepo {
  const db = new Database(':memory:', { strict: true });
  runSchema(db);
  return new RuntimeRepo(db);
}

describe('RuntimeRepo', () => {
  test('stores runtime state independently per account and asset', () => {
    const repo = createRuntimeRepo();

    repo.update({ accountName: 'alpha', asset: 'USDT' }, {
      paused: false,
      withdrawInProgress: false,
      apiStatus: 'healthy',
      lastBalance: '123.45',
      cooldownUntil: '2026-04-11T10:00:00.000Z',
    });

    repo.update({ accountName: 'beta', asset: 'BTC' }, {
      paused: true,
      withdrawInProgress: true,
      apiStatus: 'error',
      lastBalance: '0.5',
      lastError: 'network timeout',
    });

    expect(repo.get({ accountName: 'alpha', asset: 'USDT' })).toMatchObject({
      paused: false,
      withdrawInProgress: false,
      apiStatus: 'healthy',
      lastBalance: '123.45',
      cooldownUntil: '2026-04-11T10:00:00.000Z',
    });

    expect(repo.get({ accountName: 'beta', asset: 'BTC' })).toMatchObject({
      paused: true,
      withdrawInProgress: true,
      apiStatus: 'error',
      lastBalance: '0.5',
      lastError: 'network timeout',
    });

    expect(repo.list()).toHaveLength(2);
    expect(repo.list({ accountName: 'alpha' })).toHaveLength(1);
    expect(repo.list({ asset: 'BTC' })).toHaveLength(1);
  });
});
