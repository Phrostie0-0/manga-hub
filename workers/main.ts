import "dotenv/config";

import { run } from "graphile-worker";

import { authorizeSourceTask } from "./tasks/authorize-source";
import { syncSourceTask } from "./tasks/sync-source";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

await run({
  connectionString,
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  noHandleSignals: false,
  parsedCronItems: [],
  taskList: {
    authorize_source: authorizeSourceTask,
    sync_source: syncSourceTask,
  },
});
