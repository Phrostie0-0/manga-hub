import { describe, expect, it } from "vitest";

import {
  isAllowedMangaLibStorageOrigin,
  isMangaLibAuthUrl,
  MANGALIB_START_URL,
} from "../../workers/auth-browser/mangalib-local";

describe("MangaLib browser authorization configuration", () => {
  it("starts on MangaLib so its web client can create the OAuth state", () => {
    const startUrl = new URL(MANGALIB_START_URL);

    expect(startUrl.origin).toBe("https://mangalib.org");
    expect(startUrl.pathname).toBe("/ru");
  });

  it("accepts only the SocialLIB authorization origin and path", () => {
    expect(isMangaLibAuthUrl("https://auth.lib.social/auth/login")).toBe(true);
    expect(isMangaLibAuthUrl("https://auth.lib.social/auth/oauth/authorize?client_id=1")).toBe(true);
    expect(isMangaLibAuthUrl("https://auth.lib.social.evil.example/auth/login")).toBe(false);
    expect(isMangaLibAuthUrl("https://auth.lib.social/profile")).toBe(false);
    expect(isMangaLibAuthUrl("not-a-url")).toBe(false);
  });

  it("limits local-storage inspection to the two participants in the login flow", () => {
    expect(isAllowedMangaLibStorageOrigin("https://mangalib.org/ru")).toBe(true);
    expect(isAllowedMangaLibStorageOrigin("https://auth.lib.social/auth/login")).toBe(true);
    expect(isAllowedMangaLibStorageOrigin("https://mangalib.org.evil.example/ru")).toBe(false);
    expect(isAllowedMangaLibStorageOrigin("https://api.cdnlibs.org/api/auth/me")).toBe(false);
  });
});
