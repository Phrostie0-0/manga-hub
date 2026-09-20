import { chromium, type BrowserContext, type Request } from "playwright";

import { MangaLibAdapter, type ProviderSession } from "../../packages/connectors/src";
import type {
  AuthBrowserOptions,
  AuthBrowserTransport,
  CapturedProviderSession,
} from "./types";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;
const ALLOWED_STORAGE_ORIGINS = new Set([
  "https://mangalib.org",
  "https://auth.lib.social",
]);

function bearerFromRequest(request: Request): string | undefined {
  if (new URL(request.url()).origin !== "https://api.cdnlibs.org") return undefined;
  const value = request.headers().authorization;
  return value?.startsWith("Bearer ") ? value : undefined;
}

async function tokenFromStorage(context: BrowserContext): Promise<string | undefined> {
  for (const page of context.pages()) {
    if (!ALLOWED_STORAGE_ORIGINS.has(new URL(page.url()).origin)) continue;
    const token = await page.evaluate(() => {
      const findToken = (value: unknown): string | undefined => {
        if (!value || typeof value !== "object") return undefined;
        if ("access_token" in value && typeof value.access_token === "string") {
          return value.access_token;
        }
        for (const nested of Object.values(value)) {
          const found = findToken(nested);
          if (found) return found;
        }
        return undefined;
      };

      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
          const found = findToken(JSON.parse(raw) as unknown);
          if (found) return found;
        } catch {
          // Non-JSON application preferences are irrelevant to authorization.
        }
      }
      return undefined;
    });
    if (token) return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  }
  return undefined;
}

function waitForToken(
  context: BrowserContext,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timers: { interval?: NodeJS.Timeout; timeout?: NodeJS.Timeout } = {};

    function onRequest(request: Request) {
      const token = bearerFromRequest(request);
      if (token) finish({ token });
    }
    function onAbort() {
      finish({ error: new Error("MangaLib authorization cancelled") });
    }
    function finish(result: { token?: string; error?: Error }) {
      if (finished) return;
      finished = true;
      clearInterval(timers.interval);
      clearTimeout(timers.timeout);
      context.off("request", onRequest);
      signal?.removeEventListener("abort", onAbort);
      if (result.error) reject(result.error);
      else resolve(result.token as string);
    }

    context.on("request", onRequest);
    signal?.addEventListener("abort", onAbort, { once: true });
    timers.interval = setInterval(() => {
      void tokenFromStorage(context).then((token) => {
        if (token) finish({ token });
      }).catch(() => {
        // OAuth redirects may destroy the current execution context; retry next tick.
      });
    }, 500);
    timers.timeout = setTimeout(
      () => finish({ error: new Error("Timed out waiting for MangaLib authorization") }),
      timeoutMs,
    );
    if (signal?.aborted) onAbort();
  });
}

export class LocalMangaLibAuthBrowser implements AuthBrowserTransport {
  async captureSession(options: AuthBrowserOptions = {}): Promise<CapturedProviderSession> {
    const browser = await chromium.launch({ headless: options.headless ?? false });
    const context = await browser.newContext();

    try {
      const page = await context.newPage();
      const userAgent = await page.evaluate(() => navigator.userAgent);
      await page.goto("https://mangalib.org/auth/login", { waitUntil: "domcontentloaded" });

      const accessToken = await waitForToken(
        context,
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        options.signal,
      );
      const storageState = await context.storageState();
      const session: ProviderSession = {
        formatVersion: 1,
        cookies: storageState.cookies
          .filter((cookie) => {
            const domain = cookie.domain.replace(/^\./, "");
            return (
              domain === "mangalib.org" ||
              domain.endsWith(".mangalib.org") ||
              domain === "lib.social" ||
              domain.endsWith(".lib.social") ||
              domain === "cdnlibs.org" ||
              domain.endsWith(".cdnlibs.org")
            );
          })
          .map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            expires: cookie.expires,
            httpOnly: cookie.httpOnly,
            secure: cookie.secure,
            sameSite: cookie.sameSite,
          })),
        origins: [],
        accessToken,
        userAgent,
        createdAt: new Date().toISOString(),
      };

      const adapter = new MangaLibAdapter();
      const profile = await adapter.verifySession(session, { fetch: globalThis.fetch });
      return { provider: "mangalib", session, profile };
    } finally {
      await context.close();
      await browser.close();
    }
  }
}
