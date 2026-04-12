import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';

import { runSchema } from '../src/db/schema';
import { CliAuthRepo } from '../src/db/repo/cli-auth-repo';
import { CliAuthService } from '../src/services/cli-auth-service';

describe('CliAuthService', () => {
  test('initializes once and rejects a different CLI master password later', () => {
    const db = new Database(':memory:', { strict: true });
    runSchema(db);

    const service = new CliAuthService(new CliAuthRepo(db));
    service.verifyOrInitialize('master-secret');

    expect(() => service.verifyOrInitialize('master-secret')).not.toThrow();
    expect(() => service.verifyOrInitialize('wrong-secret')).toThrow('Invalid CLI master password');
  });
});
