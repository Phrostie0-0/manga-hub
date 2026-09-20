import { readFile, stat } from "node:fs/promises";

import {
  AES_256_GCM_V1,
  CryptoConfigurationError,
  SecretDecryptionError,
  type KeyWrapper,
  type VersionedSecretContext,
  type WrappedKey,
} from "./types";
import {
  AES_KEY_BYTES,
  createAssociatedData,
  openAes256Gcm,
  sealAes256Gcm,
} from "./aead";

export type LocalKeyWrapperOptions = {
  activeKeyVersion: string;
  keys: Readonly<Record<string, Uint8Array>>;
  provider?: string;
};

function validateLabel(label: string, field: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(label)) {
    throw new CryptoConfigurationError(`${field} contains unsupported characters`);
  }
}

/**
 * Local KEK wrapper used by the first deployment. A Vault/KMS implementation
 * only needs to satisfy KeyWrapper and can leave the encrypted payload intact.
 */
export class LocalAesGcmKeyWrapper implements KeyWrapper {
  readonly #activeKeyVersion: string;
  readonly #keys = new Map<string, Buffer>();
  readonly #provider: string;
  #destroyed = false;

  constructor(options: LocalKeyWrapperOptions) {
    this.#provider = options.provider ?? "local-file";
    this.#activeKeyVersion = options.activeKeyVersion;
    validateLabel(this.#provider, "Key provider");
    validateLabel(this.#activeKeyVersion, "Active key version");

    for (const [version, key] of Object.entries(options.keys)) {
      validateLabel(version, "Key version");
      if (key.byteLength !== AES_KEY_BYTES) {
        throw new CryptoConfigurationError(
          `KEK ${version} must contain exactly ${AES_KEY_BYTES} bytes`,
        );
      }
      this.#keys.set(version, Buffer.from(key));
    }

    if (!this.#keys.has(this.#activeKeyVersion)) {
      throw new CryptoConfigurationError(
        "The active KEK version is missing from the keyring",
      );
    }
  }

  async wrap(
    dek: Uint8Array,
    context: VersionedSecretContext,
  ): Promise<WrappedKey> {
    const kek = this.#getKey(this.#activeKeyVersion);
    const encrypted = sealAes256Gcm(
      kek,
      dek,
      createAssociatedData("dek-wrap", context),
    );

    return {
      algorithm: AES_256_GCM_V1,
      ciphertext: encrypted.ciphertext,
      keyProvider: this.#provider,
      keyVersion: this.#activeKeyVersion,
      nonce: encrypted.nonce,
    };
  }

  async unwrap(
    wrappedKey: WrappedKey,
    context: VersionedSecretContext,
  ): Promise<Uint8Array> {
    try {
      if (
        wrappedKey.algorithm !== AES_256_GCM_V1 ||
        wrappedKey.keyProvider !== this.#provider
      ) {
        throw new Error("Unsupported wrapped key");
      }

      return openAes256Gcm(
        this.#getKey(wrappedKey.keyVersion),
        wrappedKey.ciphertext,
        wrappedKey.nonce,
        createAssociatedData("dek-wrap", context),
      );
    } catch {
      throw new SecretDecryptionError();
    }
  }

  /** Overwrites in-memory copies; the wrapper cannot be reused afterwards. */
  destroy(): void {
    for (const key of this.#keys.values()) {
      key.fill(0);
    }
    this.#keys.clear();
    this.#destroyed = true;
  }

  #getKey(version: string): Uint8Array {
    if (this.#destroyed) {
      throw new CryptoConfigurationError("The key wrapper has been destroyed");
    }

    const key = this.#keys.get(version);
    if (!key) {
      throw new SecretDecryptionError();
    }
    return key;
  }
}

export type FileKeyWrapperOptions = {
  activeKeyVersion: string;
  keyFiles: Readonly<Record<string, string>>;
  provider?: string;
  requireOwnerOnlyPermissions?: boolean;
};

function decodeKeyFile(contents: Buffer): Uint8Array {
  const value = contents.toString("utf8").trim();
  const prefixedHex = value.startsWith("hex:") ? value.slice(4) : undefined;
  const base64 = value.startsWith("base64:") ? value.slice(7) : value;

  let decoded: Buffer;
  if (prefixedHex !== undefined) {
    if (!/^[a-fA-F0-9]{64}$/.test(prefixedHex)) {
      throw new CryptoConfigurationError("KEK file contains invalid hex data");
    }
    decoded = Buffer.from(prefixedHex, "hex");
  } else {
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        base64,
      )
    ) {
      throw new CryptoConfigurationError("KEK file contains invalid base64 data");
    }
    decoded = Buffer.from(base64, "base64");
  }

  if (decoded.byteLength !== AES_KEY_BYTES) {
    decoded.fill(0);
    throw new CryptoConfigurationError(
      `KEK file must decode to exactly ${AES_KEY_BYTES} bytes`,
    );
  }
  return decoded;
}

async function loadKekFile(
  filePath: string,
  requireOwnerOnlyPermissions: boolean,
): Promise<Uint8Array> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new CryptoConfigurationError("KEK path must point to a regular file");
  }
  if (
    requireOwnerOnlyPermissions &&
    process.platform !== "win32" &&
    (fileStat.mode & 0o077) !== 0
  ) {
    throw new CryptoConfigurationError(
      "KEK file must not be readable or writable by group or other users",
    );
  }

  return decodeKeyFile(await readFile(filePath));
}

export async function createFileKeyWrapper(
  options: FileKeyWrapperOptions,
): Promise<LocalAesGcmKeyWrapper> {
  const entries = await Promise.all(
    Object.entries(options.keyFiles).map(async ([version, filePath]) => [
      version,
      await loadKekFile(
        filePath,
        options.requireOwnerOnlyPermissions ?? true,
      ),
    ] as const),
  );

  try {
    return new LocalAesGcmKeyWrapper({
      activeKeyVersion: options.activeKeyVersion,
      keys: Object.fromEntries(entries),
      provider: options.provider,
    });
  } finally {
    for (const [, key] of entries) {
      key.fill(0);
    }
  }
}
