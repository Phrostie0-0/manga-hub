import { NextResponse } from "next/server";

import { getApiSession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

const sources = [
  {
    code: "remanga",
    name: "ReManga",
    description: "Личная библиотека и последний подтверждённый прогресс.",
    browserRequired: true,
    connectionEnabled: true,
    capabilities: {
      libraryRead: true,
      progressRead: true,
      explicitReadSet: false,
      lastReadOnly: true,
    },
  },
  {
    code: "mangalib",
    name: "MangaLib",
    description: "Добавленные тайтлы, списки и прочитанные главы.",
    browserRequired: true,
    connectionEnabled: true,
    capabilities: {
      libraryRead: true,
      progressRead: true,
      explicitReadSet: false,
      lastReadOnly: true,
    },
  },
] as const;

export async function GET(request: Request) {
  const session = await getApiSession(request);

  if (!session) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }

  return NextResponse.json(
    { items: sources },
    { headers: { "cache-control": "private, no-store" } },
  );
}
