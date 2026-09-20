import { makeWorkerUtils, type WorkerUtils } from "graphile-worker";

const globalForQueue = globalThis as typeof globalThis & {
  mangaHubWorkerUtils?: Promise<WorkerUtils>;
};

async function createWorkerUtils(): Promise<WorkerUtils> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const utils = await makeWorkerUtils({ connectionString });
  await utils.migrate();
  return utils;
}

function workerUtils(): Promise<WorkerUtils> {
  globalForQueue.mangaHubWorkerUtils ??= createWorkerUtils();
  return globalForQueue.mangaHubWorkerUtils;
}

export async function enqueueConnectionAuthorization(connectionId: string): Promise<void> {
  const utils = await workerUtils();
  await utils.addJob(
    "authorize_source",
    { connectionId },
    {
      jobKey: `authorize_source:${connectionId}`,
      jobKeyMode: "replace",
      maxAttempts: 1,
    },
  );
}

export async function enqueueConnectionSync(
  connectionId: string,
  runAt = new Date(),
): Promise<void> {
  const utils = await workerUtils();
  await utils.addJob(
    "sync_source",
    { connectionId },
    {
      jobKey: `sync_source:${connectionId}`,
      jobKeyMode: "replace",
      maxAttempts: 8,
      runAt,
    },
  );
}
