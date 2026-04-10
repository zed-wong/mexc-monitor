export interface StoredSecrets {
  encryptedCredentials: Buffer;
  credentialsIv: Buffer;
  credentialsTag: Buffer;
  kdfSalt: Buffer;
}
