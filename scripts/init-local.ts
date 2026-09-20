import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const root = process.cwd();
const envPath = resolve(root, ".env");
const localDirectory = resolve(root, ".local");
const secretDirectory = resolve(localDirectory, "secrets");
const kekPath = resolve(secretDirectory, "credential-kek-v1");

await mkdir(secretDirectory, { recursive: true, mode: 0o700 });
await chmod(localDirectory, 0o700);
await chmod(secretDirectory, 0o700);

if (!(await exists(kekPath))) {
  await writeFile(
    kekPath,
    `base64:${randomBytes(32).toString("base64")}\n`,
    { mode: 0o600 },
  );
}
await chmod(kekPath, 0o600);

if (!(await exists(envPath))) {
  const values = [
    "DATABASE_URL=postgresql://manga_hub:manga_hub_dev@127.0.0.1:5432/manga_hub",
    `BETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}`,
    "BETTER_AUTH_URL=http://localhost:3000",
    "BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3000",
    "MANGA_HUB_KEK_FILE=.local/secrets/credential-kek-v1",
    "MANGA_HUB_KEK_VERSION=v1",
    "AUTH_BROWSER_HEADLESS=false",
    "WORKER_CONCURRENCY=2",
    "",
  ];
  await writeFile(envPath, values.join("\n"), { mode: 0o600 });
}
await chmod(envPath, 0o600);

console.log("Local .env and KEK are ready. Existing secrets were preserved.");
