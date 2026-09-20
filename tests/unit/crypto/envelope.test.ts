import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AES_256_GCM_V1,
  decryptJsonSecret,
  encryptJsonSecret,
  LocalAesGcmKeyWrapper,
  rewrapSecret,
  SecretDecryptionError,
  type JsonValue,
  type SecretContext,
} from "../../../src/server/crypto";

const context: SecretContext = {
  connectionId: "018fefab-0c7f-7e28-b855-66a8edb99690",
  sourceCode: "remanga",
  userId: "user_018fefab",
};

const sessionBundle = {
  cookies: [
    {
      domain: ".remanga.org",
      httpOnly: true,
      name: "session",
      value: "very-secret-cookie-value",
    },
  ],
  createdAt: "2026-09-20T00:00:00.000Z",
  formatVersion: 1,
  knownExpiresAt: null,
  origins: [],
  sessionStorage: [],
  userAgent: "test-agent",
} satisfies JsonValue;

function wrapper(version = "v1", key = randomBytes(32)) {
  return new LocalAesGcmKeyWrapper({
    activeKeyVersion: version,
    keys: { [version]: key },
  });
}

describe("source secret envelope encryption", () => {
  it("round-trips a session bundle without exposing plaintext", async () => {
    const keyWrapper = wrapper();
    const encrypted = await encryptJsonSecret(
      sessionBundle,
      context,
      keyWrapper,
    );

    expect(encrypted.cipher).toBe(AES_256_GCM_V1);
    expect(encrypted.payloadNonce).toHaveLength(12);
    expect(encrypted.wrapNonce).toHaveLength(12);
    expect(Buffer.from(encrypted.ciphertext).toString("utf8")).not.toContain(
      "very-secret-cookie-value",
    );
    await expect(
      decryptJsonSecret(encrypted, context, keyWrapper),
    ).resolves.toEqual(sessionBundle);
  });

  it("uses fresh nonces and DEKs for repeated encryption", async () => {
    const keyWrapper = wrapper();
    const first = await encryptJsonSecret(sessionBundle, context, keyWrapper);
    const second = await encryptJsonSecret(sessionBundle, context, keyWrapper);

    expect(first.payloadNonce).not.toEqual(second.payloadNonce);
    expect(first.wrapNonce).not.toEqual(second.wrapNonce);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
    expect(first.wrappedDek).not.toEqual(second.wrappedDek);
  });

  it("rejects a modified payload", async () => {
    const keyWrapper = wrapper();
    const encrypted = await encryptJsonSecret(sessionBundle, context, keyWrapper);
    const ciphertext = Uint8Array.from(encrypted.ciphertext);
    ciphertext[0] ^= 1;

    await expect(
      decryptJsonSecret({ ...encrypted, ciphertext }, context, keyWrapper),
    ).rejects.toBeInstanceOf(SecretDecryptionError);
  });

  it("binds ciphertext to user, connection and source", async () => {
    const keyWrapper = wrapper();
    const encrypted = await encryptJsonSecret(sessionBundle, context, keyWrapper);

    await expect(
      decryptJsonSecret(
        encrypted,
        { ...context, connectionId: "another-connection" },
        keyWrapper,
      ),
    ).rejects.toBeInstanceOf(SecretDecryptionError);
  });

  it("rejects an unrelated KEK without leaking key lookup details", async () => {
    const encrypted = await encryptJsonSecret(
      sessionBundle,
      context,
      wrapper("v1"),
    );

    await expect(
      decryptJsonSecret(encrypted, context, wrapper("v1")),
    ).rejects.toEqual(new SecretDecryptionError());
  });

  it("rewraps only the DEK during KEK rotation", async () => {
    const oldWrapper = wrapper("v1");
    const newWrapper = wrapper("v2");
    const encrypted = await encryptJsonSecret(
      sessionBundle,
      context,
      oldWrapper,
    );
    const rotated = await rewrapSecret(
      encrypted,
      context,
      oldWrapper,
      newWrapper,
    );

    expect(rotated.kekVersion).toBe("v2");
    expect(rotated.ciphertext).toEqual(encrypted.ciphertext);
    expect(rotated.payloadNonce).toEqual(encrypted.payloadNonce);
    expect(rotated.wrappedDek).not.toEqual(encrypted.wrappedDek);
    await expect(
      decryptJsonSecret(rotated, context, newWrapper),
    ).resolves.toEqual(sessionBundle);
  });
});
