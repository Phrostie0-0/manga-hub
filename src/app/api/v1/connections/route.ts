import { NextResponse } from "next/server";

import { getApiSession } from "@/server/auth/session";
import {
  enqueueConnectionAuthorization,
  enqueueConnectionSync,
} from "@/server/queue";
import {
  createOrRestartConnection,
  listConnections,
  updateConnectionStatus,
} from "@/server/services/connections";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getApiSession(request);

  if (!session) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }

  const items = await listConnections(session.user.id);
  return NextResponse.json({ items }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const session = await getApiSession(request);

  if (!session) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json" } }, { status: 400 });
  }

  const sourceCode =
    typeof body === "object" && body !== null && "sourceCode" in body
      ? (body as { sourceCode?: unknown }).sourceCode
      : undefined;

  if (typeof sourceCode !== "string" || !["remanga", "mangalib"].includes(sourceCode)) {
    return NextResponse.json({ error: { code: "unsupported_source" } }, { status: 422 });
  }

  try {
    const connection = await createOrRestartConnection(session.user.id, sourceCode);
    try {
      if (connection.nextAction === "authorize") {
        await enqueueConnectionAuthorization(connection.id);
      } else if (connection.nextAction === "sync") {
        await enqueueConnectionSync(connection.id);
      }
    } catch (error) {
      await updateConnectionStatus(
        connection.id,
        connection.nextAction === "authorize" ? "needs_attention" : "degraded",
      );
      throw error;
    }
    return NextResponse.json(
      { connection },
      { status: connection.nextAction === "none" ? 200 : 202 },
    );
  } catch {
    return NextResponse.json(
      { error: { code: "connection_start_failed", message: "Не удалось запустить подключение." } },
      { status: 503 },
    );
  }
}
