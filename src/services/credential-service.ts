import type { Credentials } from '../core/types';
import type { ConfigService } from './config-service';
import type { CliAuthService } from './cli-auth-service';
import { sealCredentials, unsealCredentials } from '../crypto/cipher';

export class CredentialService {
  constructor(
    private readonly configService: ConfigService,
    private readonly cliAuthService: CliAuthService,
  ) {}

  unlock(accountName: string, masterPassword: string): Credentials {
    const secrets = this.configService.getSecretsForAccount(accountName);

    if (!secrets) {
      throw new Error('Credentials not configured');
    }

    let credentials: Credentials;
    try {
      credentials = unsealCredentials(masterPassword, secrets);
    } catch {
      throw new Error('Invalid CLI master password');
    }

    this.cliAuthService.verifyOrInitialize(masterPassword);
    return credentials;
  }

  updateCredentials(masterPassword: string, credentials: Credentials) {
    this.cliAuthService.verifyOrInitialize(masterPassword);
    return sealCredentials(masterPassword, credentials);
  }

  rotateMasterPassword(currentMasterPassword: string | undefined, newMasterPassword: string): number {
    const accounts = this.configService.listAccounts();

    if (accounts.length === 0) {
      if (this.cliAuthService.isConfigured()) {
        if (!currentMasterPassword) {
          throw new Error('Current CLI master password is required');
        }
        this.cliAuthService.verify(currentMasterPassword);
      }
      this.cliAuthService.setMasterPassword(newMasterPassword);
      return 0;
    }

    if (!currentMasterPassword) {
      throw new Error('Current CLI master password is required');
    }

    const decrypted = accounts.map((account) => {
      const secrets = this.configService.getSecretsForAccount(account.name);
      if (!secrets) {
        throw new Error(`Credentials not configured for account: ${account.name}`);
      }

      try {
        return {
          account,
          credentials: unsealCredentials(currentMasterPassword, secrets),
        };
      } catch {
        throw new Error(`Invalid CLI master password for account: ${account.name}`);
      }
    });

    this.cliAuthService.setMasterPassword(newMasterPassword);
    for (const item of decrypted) {
      const sealed = sealCredentials(newMasterPassword, item.credentials);
      this.configService.saveAccount(item.account, sealed);
    }

    return decrypted.length;
  }
}
