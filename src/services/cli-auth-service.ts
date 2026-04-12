import crypto from 'node:crypto';

import type { CliAuthRepo } from '../db/repo/cli-auth-repo';

export class CliAuthService {
  constructor(private readonly cliAuthRepo: CliAuthRepo) {}

  isConfigured(): boolean {
    return this.cliAuthRepo.get() !== null;
  }

  verifyOrInitialize(masterPassword: string): void {
    const existing = this.cliAuthRepo.get();
    if (!existing) {
      this.setMasterPassword(masterPassword);
      return;
    }

    const passwordHash = this.hashMasterPassword(masterPassword, existing.kdfSalt);
    if (!crypto.timingSafeEqual(passwordHash, existing.passwordHash)) {
      throw new Error('Invalid CLI master password');
    }
  }

  verify(masterPassword: string): void {
    const existing = this.cliAuthRepo.get();
    if (!existing) {
      throw new Error('CLI master password is not configured');
    }

    const passwordHash = this.hashMasterPassword(masterPassword, existing.kdfSalt);
    if (!crypto.timingSafeEqual(passwordHash, existing.passwordHash)) {
      throw new Error('Invalid CLI master password');
    }
  }

  setMasterPassword(masterPassword: string): void {
    const kdfSalt = crypto.randomBytes(16);
    this.cliAuthRepo.save({
      passwordHash: this.hashMasterPassword(masterPassword, kdfSalt),
      kdfSalt,
    });
  }

  private hashMasterPassword(masterPassword: string, salt: Buffer): Buffer {
    return crypto.scryptSync(masterPassword, salt, 32);
  }
}
