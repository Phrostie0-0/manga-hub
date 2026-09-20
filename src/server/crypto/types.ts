export const ENVELOPE_FORMAT_VERSION = 1 as const;
export const AES_256_GCM_V1 = "aes-256-gcm-v1" as const;

export type EnvelopeFormatVersion = typeof ENVELOPE_FORMAT_VERSION;
export type EnvelopeCipher = typeof AES_256_GCM_V1;

export type SecretContext = {
  connectionId: string;
  sourceCode: string;
  userId: string;
};

export type VersionedSecretContext = SecretContext & {
  formatVersion: EnvelopeFormatVersion;
};

export type WrappedKey = {
  algorithm: string;
  ciphertext: Uint8Array;
  keyProvider: string;
  keyVersion: string;
  nonce: Uint8Array;
};

export interface KeyWrapper {
  wrap(
    dek: Uint8Array,
    context: VersionedSecretContext,
  ): Promise<WrappedKey>;
  unwrap(
    wrappedKey: WrappedKey,
    context: VersionedSecretContext,
  ): Promise<Uint8Array>;
}

/** Structural shape accepted directly from a `source_secrets` Drizzle row. */
export type StoredEncryptedSecret = {
  cipher: string;
  ciphertext: Uint8Array;
  formatVersion: number;
  kekVersion: string;
  keyProvider: string;
  payloadNonce: Uint8Array;
  wrapCipher: string;
  wrappedDek: Uint8Array;
  wrapNonce: Uint8Array;
};

/** Value produced by the current encryption implementation. */
export type EncryptedSecret = Omit<
  StoredEncryptedSecret,
  "cipher" | "formatVersion"
> & {
  cipher: EnvelopeCipher;
  formatVersion: EnvelopeFormatVersion;
};

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SessionBundle = {
  accessToken?: string;
  cookies: JsonValue[];
  createdAt: string;
  formatVersion: number;
  knownExpiresAt?: string | null;
  origins: JsonValue[];
  sessionStorage?: JsonValue[];
  userAgent: string;
};

export class CryptoConfigurationError extends Error {
  override readonly name = "CryptoConfigurationError";
}

/** Deliberately hides OpenSSL and key lookup details from callers and logs. */
export class SecretDecryptionError extends Error {
  override readonly name = "SecretDecryptionError";

  constructor() {
    super("Unable to decrypt source secret");
  }
}

export class UnsupportedEnvelopeError extends Error {
  override readonly name = "UnsupportedEnvelopeError";
}
