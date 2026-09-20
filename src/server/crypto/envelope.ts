import { randomBytes } from "node:crypto";

import {
  AES_256_GCM_V1,
  ENVELOPE_FORMAT_VERSION,
  CryptoConfigurationError,
  SecretDecryptionError,
  UnsupportedEnvelopeError,
  type EncryptedSecret,
  type KeyWrapper,
  type SecretContext,
  type StoredEncryptedSecret,
  type VersionedSecretContext,
  type WrappedKey,
} from "./types";
import {
  AES_KEY_BYTES,
  createAssociatedData,
  openAes256Gcm,
  sealAes256Gcm,
} from "./aead";

function versionedContext(context: SecretContext): VersionedSecretContext {
  return { ...context, formatVersion: ENVELOPE_FORMAT_VERSION };
}

function wrappedKeyFromSecret(secret: StoredEncryptedSecret): WrappedKey {
  return {
    algorithm: secret.wrapCipher,
    ciphertext: secret.wrappedDek,
    keyProvider: secret.keyProvider,
    keyVersion: secret.kekVersion,
    nonce: secret.wrapNonce,
  };
}

function assertSupported(
  secret: StoredEncryptedSecret,
): asserts secret is EncryptedSecret {
  if (
    secret.formatVersion !== ENVELOPE_FORMAT_VERSION ||
    secret.cipher !== AES_256_GCM_V1
  ) {
    throw new UnsupportedEnvelopeError("Unsupported source secret format");
  }
}

export async function encryptSecret(
  plaintext: Uint8Array,
  context: SecretContext,
  keyWrapper: KeyWrapper,
): Promise<EncryptedSecret> {
  const dek = randomBytes(AES_KEY_BYTES);
  const aadContext = versionedContext(context);

  try {
    const payload = sealAes256Gcm(
      dek,
      plaintext,
      createAssociatedData("session-payload", aadContext),
    );
    const wrappedDek = await keyWrapper.wrap(dek, aadContext);

    return {
      cipher: AES_256_GCM_V1,
      ciphertext: payload.ciphertext,
      formatVersion: ENVELOPE_FORMAT_VERSION,
      kekVersion: wrappedDek.keyVersion,
      keyProvider: wrappedDek.keyProvider,
      payloadNonce: payload.nonce,
      wrapCipher: wrappedDek.algorithm,
      wrappedDek: wrappedDek.ciphertext,
      wrapNonce: wrappedDek.nonce,
    };
  } finally {
    dek.fill(0);
  }
}

export async function decryptSecret(
  secret: StoredEncryptedSecret,
  context: SecretContext,
  keyWrapper: KeyWrapper,
): Promise<Uint8Array> {
  assertSupported(secret);
  const aadContext = versionedContext(context);
  let dek: Uint8Array | undefined;

  try {
    dek = await keyWrapper.unwrap(wrappedKeyFromSecret(secret), aadContext);
    return openAes256Gcm(
      dek,
      secret.ciphertext,
      secret.payloadNonce,
      createAssociatedData("session-payload", aadContext),
    );
  } catch (error) {
    if (error instanceof UnsupportedEnvelopeError) {
      throw error;
    }
    throw new SecretDecryptionError();
  } finally {
    dek?.fill(0);
  }
}

export async function encryptJsonSecret<T>(
  value: T,
  context: SecretContext,
  keyWrapper: KeyWrapper,
): Promise<EncryptedSecret> {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new CryptoConfigurationError("Secret value must be JSON serializable");
  }
  const plaintext = Buffer.from(serialized, "utf8");
  try {
    return await encryptSecret(plaintext, context, keyWrapper);
  } finally {
    plaintext.fill(0);
  }
}

export async function decryptJsonSecret<T = unknown>(
  secret: StoredEncryptedSecret,
  context: SecretContext,
  keyWrapper: KeyWrapper,
): Promise<T> {
  const plaintext = await decryptSecret(secret, context, keyWrapper);
  try {
    return JSON.parse(Buffer.from(plaintext).toString("utf8")) as T;
  } catch {
    throw new SecretDecryptionError();
  } finally {
    plaintext.fill(0);
  }
}

/** Rotates only the wrapped DEK; the session payload is never decrypted. */
export async function rewrapSecret(
  secret: StoredEncryptedSecret,
  context: SecretContext,
  currentKeyWrapper: KeyWrapper,
  nextKeyWrapper: KeyWrapper,
): Promise<EncryptedSecret> {
  assertSupported(secret);
  const aadContext = versionedContext(context);
  let dek: Uint8Array | undefined;

  try {
    dek = await currentKeyWrapper.unwrap(
      wrappedKeyFromSecret(secret),
      aadContext,
    );
    const wrappedDek = await nextKeyWrapper.wrap(dek, aadContext);

    return {
      ...secret,
      kekVersion: wrappedDek.keyVersion,
      keyProvider: wrappedDek.keyProvider,
      wrapCipher: wrappedDek.algorithm,
      wrappedDek: wrappedDek.ciphertext,
      wrapNonce: wrappedDek.nonce,
    };
  } catch (error) {
    if (error instanceof UnsupportedEnvelopeError) {
      throw error;
    }
    throw new SecretDecryptionError();
  } finally {
    dek?.fill(0);
  }
}
