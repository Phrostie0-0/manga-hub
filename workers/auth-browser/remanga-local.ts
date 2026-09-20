import {
  chromium,
  type BrowserContext,
  type Request,
} from "playwright";

import { ReMangaAdapter, type ProviderSession } from "../../packages/connectors/src";
import type {
  AuthBrowserOptions,
  AuthBrowserTransport,
  CapturedProviderSession,
} from "./types";
import { watchAuthorizationWindow } from "./window-lifecycle";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;

function bearerFromRequest(request: Request): string | undefined {
  if (new URL(request.url()).origin !== "https://api.remanga.org") return undefined;
  const value = request.headers().authorization;
  return value?.startsWith("Bearer ") ? value : undefined;
}

async function tokenFromStorage(context: BrowserContext): Promise<string | undefined> {
  for (const page of context.pages()) {
    if (!page.url().startsWith("https://remanga.org")) continue;
    const token = await page.evaluate(() => {
      for (const key of ["token", "accessToken", "access_token"]) {
        const value = localStorage.getItem(key);
        if (value) return value;
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
    const startedAt = Date.now();
    const timers: { interval?: NodeJS.Timeout; timeout?: NodeJS.Timeout } = {};
    const stopWatchingWindow = watchAuthorizationWindow(context, () =>
      finish({ error: new Error("ReManga authorization window was closed") }),
    );

    const finish = (result: { token?: string; error?: Error }) => {
      if (finished) return;
      finished = true;
      clearInterval(timers.interval);
      clearTimeout(timers.timeout);
      context.off("request", onRequest);
      stopWatchingWindow();
      signal?.removeEventListener("abort", onAbort);
      if (result.error) reject(result.error);
      else resolve(result.token as string);
    };

    const onRequest = (request: Request) => {
      const token = bearerFromRequest(request);
      if (token) finish({ token });
    };
    const onAbort = () => finish({ error: new Error("ReManga authorization cancelled") });

    context.on("request", onRequest);
    signal?.addEventListener("abort", onAbort, { once: true });

    timers.interval = setInterval(() => {
      void tokenFromStorage(context).then((token) => {
        if (token) finish({ token });
      }).catch(() => {
        // A page may be navigating while storage is inspected; the next tick retries.
      });
      if (Date.now() - startedAt >= timeoutMs) {
        finish({ error: new Error("Timed out waiting for ReManga authorization") });
      }
    }, 500);

    timers.timeout = setTimeout(
      () => finish({ error: new Error("Timed out waiting for ReManga authorization") }),
      timeoutMs,
    );

    if (signal?.aborted) onAbort();
  });
}

export class LocalReMangaAuthBrowser implements AuthBrowserTransport {
  async captureSession(options: AuthBrowserOptions = {}): Promise<CapturedProviderSession> {
    const browser = await chromium.launch({ headless: options.headless ?? false });
    const context = await browser.newContext();

    try {
      const page = await context.newPage();
      const userAgent = await page.evaluate(() => navigator.userAgent);
      await page.goto("https://remanga.org", { waitUntil: "domcontentloaded" });

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
            return domain === "remanga.org" || domain.endsWith(".remanga.org");
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

      const adapter = new ReMangaAdapter();
      const profile = await adapter.verifySession(session, { fetch: globalThis.fetch });
      return { provider: "remanga", session, profile };
    } finally {
      await context.close();
      await browser.close();
    }
  }
}
