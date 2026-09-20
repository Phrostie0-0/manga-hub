import { NextResponse } from "next/server";

import { getApiSession } from "@/server/auth/session";
import { listLibrary } from "@/server/services/connections";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getApiSession(request);

  if (!session) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("query")?.trim() ?? "";

  if (query.length > 120) {
    return NextResponse.json({ error: { code: "query_too_long" } }, { status: 422 });
  }

  const library = await listLibrary(session.user.id, query);
  return NextResponse.json(library, { headers: { "cache-control": "private, no-store" } });
}
