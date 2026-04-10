import type { Credentials } from '../core/types';
import type { ConfigService } from './config-service';
import { sealCredentials, unsealCredentials } from '../crypto/cipher';

export class CredentialService {
  constructor(private readonly configService: ConfigService) {}

  setup(password: string, credentials: Credentials) {
    return sealCredentials(password, credentials);
  }

  unlock(accountName: string, password: string): Credentials {
    const secrets = this.configService.getSecretsForAccount(accountName);

    if (!secrets) {
      throw new Error('Credentials not configured');
    }

    return unsealCredentials(password, secrets);
  }

  updateCredentials(password: string, credentials: Credentials) {
    return sealCredentials(password, credentials);
  }
}
