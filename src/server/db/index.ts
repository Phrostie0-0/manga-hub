import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDatabase = globalThis as typeof globalThis & {
  mangaHubPool?: Pool;
};

export const pool =
  globalForDatabase.mangaHubPool ??
  new Pool({
    connectionString: databaseUrl,
    max: process.env.NODE_ENV === "production" ? 20 : 5,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.mangaHubPool = pool;
}

export const db = drizzle(pool, { schema });

export { schema };
