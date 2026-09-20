import { hash, type Options, verify } from "@node-rs/argon2";

const ARGON2_OPTIONS: Options = {
  algorithm: 2,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export function verifyPassword({
  hash: encodedHash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  return verify(encodedHash, password, ARGON2_OPTIONS);
}
