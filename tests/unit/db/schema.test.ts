import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  sourceConnections,
  sourceProgress,
  sourceSecrets,
  sourceTitles,
  sources,
  syncRuns,
  userLibrary,
  works,
} from "../../../src/server/db/schema";

describe("MVP database schema", () => {
  it("exports all product tables under stable physical names", () => {
    expect(
      [
        sources,
        sourceConnections,
        sourceSecrets,
        works,
        sourceTitles,
        userLibrary,
        sourceProgress,
        syncRuns,
      ].map(getTableName),
    ).toEqual([
      "sources",
      "source_connections",
      "source_secrets",
      "works",
      "source_titles",
      "user_library",
      "source_progress",
      "sync_runs",
    ]);
  });

  it("keeps encrypted material isolated from connection metadata", () => {
    const connectionColumns = Object.keys(getTableColumns(sourceConnections));
    const secretColumns = Object.keys(getTableColumns(sourceSecrets));

    expect(connectionColumns).toContain("syncCursor");
    expect(connectionColumns).not.toEqual(
      expect.arrayContaining(["ciphertext", "wrappedDek", "payloadNonce"]),
    );
    expect(secretColumns).toEqual(
      expect.arrayContaining([
        "ciphertext",
        "wrappedDek",
        "payloadNonce",
        "wrapNonce",
        "keyProvider",
        "kekVersion",
      ]),
    );
  });

  it("preserves non-integer chapter and volume markers", () => {
    const progressColumns = getTableColumns(sourceProgress);

    expect(progressColumns.lastChapterLabel.dataType).toBe("string");
    expect(progressColumns.lastChapterNumber.getSQLType()).toContain("numeric");
    expect(progressColumns.lastVolume.getSQLType()).toContain("numeric");
    expect(progressColumns.readChapters.dataType).toBe("json");
    expect(progressColumns.readCount.dataType).toBe("number");
    expect(progressColumns.totalCount.dataType).toBe("number");
  });
});
