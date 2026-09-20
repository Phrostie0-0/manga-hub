import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const standaloneRoot = join(root, ".next", "standalone");

if (!existsSync(standaloneRoot)) {
  throw new Error("Standalone build is missing. Run `next build` first.");
}

function copyDirectory(source, destination) {
  if (!existsSync(source)) {
    return;
  }

  rmSync(destination, { force: true, recursive: true });
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
}

copyDirectory(join(root, ".next", "static"), join(standaloneRoot, ".next", "static"));
copyDirectory(join(root, "public"), join(standaloneRoot, "public"));

// Next traces dotenv files into the standalone directory. Runtime secrets must
// come from the environment, never from a deployable build artifact.
for (const entry of readdirSync(standaloneRoot)) {
  if (entry === ".env" || entry.startsWith(".env.")) {
    rmSync(join(standaloneRoot, entry), { force: true, recursive: true });
  }
}
