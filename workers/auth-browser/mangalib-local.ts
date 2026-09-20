import {
  chromium,
  type BrowserContext,
  type Page,
  type Request,
} from "playwright";

import { MangaLibAdapter, type ProviderSession } from "../../packages/connectors/src";
import type {
  AuthBrowserOptions,
  AuthBrowserTransport,
  CapturedProviderSession,
} from "./types";
import { watchAuthorizationWindow } from "./window-lifecycle";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;
const LOGIN_BOOTSTRAP_TIMEOUT_MS = 30_000;
export const MANGALIB_START_URL = "https://mangalib.org/ru?section=home-updates";
const MANGALIB_AUTH_ORIGIN = "https://auth.lib.social";
const ALLOWED_STORAGE_ORIGINS = new Set([
  "https://mangalib.org",
  MANGALIB_AUTH_ORIGIN,
]);

export function isMangaLibAuthUrl(value: URL | string): boolean {
  try {
    const url = typeof value === "string" ? new URL(value) : value;
    return url.origin === MANGALIB_AUTH_ORIGIN && url.pathname.startsWith("/auth/");
  } catch {
    return false;
  }
}

export function isAllowedMangaLibStorageOrigin(value: URL | string): boolean {
  try {
    const url = typeof value === "string" ? new URL(value) : value;
    return ALLOWED_STORAGE_ORIGINS.has(url.origin);
  } catch {
    return false;
  }
}

async function openMangaLibLogin(page: Page): Promise<void> {
  await page.goto(MANGALIB_START_URL, { waitUntil: "domcontentloaded" });

  const loginButton = page.getByRole("button", { name: /Вход\s*\|\s*Регистрация/i });
  await loginButton.waitFor({ state: "visible", timeout: LOGIN_BOOTSTRAP_TIMEOUT_MS });
  await Promise.all([
    page.waitForURL((url) => isMangaLibAuthUrl(url), {
      waitUntil: "domcontentloaded",
      timeout: LOGIN_BOOTSTRAP_TIMEOUT_MS,
    }),
    loginButton.click(),
  ]);
}

function bearerFromRequest(request: Request): string | undefined {
  if (new URL(request.url()).origin !== "https://api.cdnlibs.org") return undefined;
  const value = request.headers().authorization;
  return value?.startsWith("Bearer ") ? value : undefined;
}

async function tokenFromStorage(context: BrowserContext): Promise<string | undefined> {
  for (const page of context.pages()) {
    if (!isAllowedMangaLibStorageOrigin(page.url())) continue;
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
    const stopWatchingWindow = watchAuthorizationWindow(context, () =>
      finish({ error: new Error("MangaLib authorization window was closed") }),
    );

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
      stopWatchingWindow();
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
      await openMangaLibLogin(page);

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
