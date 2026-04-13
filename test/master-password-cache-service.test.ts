import fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { MASTER_PASSWORD_CACHE_PATH } from '../src/config/constants';
import { MasterPasswordCacheService } from '../src/services/master-password-cache-service';

describe('MasterPasswordCacheService', () => {
  const service = new MasterPasswordCacheService();

  beforeEach(() => {
    service.clear();
  });

  afterEach(() => {
    service.clear();
  });

  test('returns the cached password before expiry and clears it after expiry', () => {
    service.remember('cached-secret', 0, 1000);

    expect(service.getCachedPassword(999)).toBe('cached-secret');
    expect(service.getCachedPassword(1000)).toBeUndefined();
    expect(fs.existsSync(MASTER_PASSWORD_CACHE_PATH)).toBeFalse();
  });

  test('returns undefined when no cache exists', () => {
    expect(service.getCachedPassword()).toBeUndefined();
  });
});
