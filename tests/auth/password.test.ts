import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../../src/server/auth/password";

describe("Manga Hub password hashing", () => {
  it("stores an Argon2id hash with the configured work factors", async () => {
    const password = "a correct horse battery staple";
    const encodedHash = await hashPassword(password);

    expect(encodedHash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/);
    await expect(verifyPassword({ hash: encodedHash, password })).resolves.toBe(true);
    await expect(
      verifyPassword({ hash: encodedHash, password: "a different password" }),
    ).resolves.toBe(false);
  });
});
