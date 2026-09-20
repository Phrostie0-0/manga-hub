import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

import {
  CryptoConfigurationError,
  SecretDecryptionError,
  type VersionedSecretContext,
} from "./types";

export const AES_KEY_BYTES = 32;
export const AES_GCM_NONCE_BYTES = 12;
export const AES_GCM_TAG_BYTES = 16;

type AssociatedDataPurpose = "dek-wrap" | "session-payload";

function assertAesKey(key: Uint8Array): void {
  if (key.byteLength !== AES_KEY_BYTES) {
    throw new CryptoConfigurationError("AES-256-GCM keys must contain 32 bytes");
  }
}

export function createAssociatedData(
  purpose: AssociatedDataPurpose,
  context: VersionedSecretContext,
): Uint8Array {
  if (
    !context.userId ||
    !context.connectionId ||
    !context.sourceCode
  ) {
    throw new CryptoConfigurationError(
      "Secret encryption context fields must not be empty",
    );
  }

  // A fixed-position JSON array is unambiguous and stable across object key order.
  return Buffer.from(
    JSON.stringify([
      "manga-hub",
      purpose,
      context.formatVersion,
      context.userId,
      context.connectionId,
      context.sourceCode,
    ]),
    "utf8",
  );
}

export function sealAes256Gcm(
  key: Uint8Array,
  plaintext: Uint8Array,
  associatedData: Uint8Array,
): { ciphertext: Uint8Array; nonce: Uint8Array } {
  assertAesKey(key);

  const nonce = randomBytes(AES_GCM_NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, {
    authTagLength: AES_GCM_TAG_BYTES,
  });
  cipher.setAAD(associatedData);

  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Keeping the tag attached to the ciphertext makes the DB representation
  // compatible with AEADs that naturally return one combined byte string.
  return {
    ciphertext: Buffer.concat([body, tag]),
    nonce,
  };
}

export function openAes256Gcm(
  key: Uint8Array,
  ciphertextWithTag: Uint8Array,
  nonce: Uint8Array,
  associatedData: Uint8Array,
): Uint8Array {
  try {
    assertAesKey(key);

    if (
      nonce.byteLength !== AES_GCM_NONCE_BYTES ||
      ciphertextWithTag.byteLength < AES_GCM_TAG_BYTES
    ) {
      throw new Error("Malformed encrypted value");
    }

    const bodyEnd = ciphertextWithTag.byteLength - AES_GCM_TAG_BYTES;
    const body = ciphertextWithTag.subarray(0, bodyEnd);
    const tag = ciphertextWithTag.subarray(bodyEnd);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, {
      authTagLength: AES_GCM_TAG_BYTES,
    });
    decipher.setAAD(associatedData);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new SecretDecryptionError();
  }
}
