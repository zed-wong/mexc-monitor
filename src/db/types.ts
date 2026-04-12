export interface StoredSecrets {
  encryptedCredentials: Buffer;
  credentialsIv: Buffer;
  credentialsTag: Buffer;
  kdfSalt: Buffer;
}

export interface StoredCliAuth {
  passwordHash: Buffer;
  kdfSalt: Buffer;
}
