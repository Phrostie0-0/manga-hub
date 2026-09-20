import {
  ProviderAuthError,
  ProviderChallengeError,
  ProviderRateLimitError,
  ProviderResponseError,
} from "./errors";
import type { ProviderRequestContext, ProviderSession } from "./types";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function parseRetryAfter(value: string | null, now: Date): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;

  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now.getTime());
}

function cookieHeader(session: ProviderSession, url: URL): string | undefined {
  const nowSeconds = Date.now() / 1_000;
  const cookies = session.cookies.filter((cookie) => {
    const domain = cookie.domain.replace(/^\./, "");
    const domainMatches = url.hostname === domain || url.hostname.endsWith(`.${domain}`);
    const pathMatches = url.pathname.startsWith(cookie.path || "/");
    const isAlive = cookie.expires === undefined || cookie.expires < 0 || cookie.expires > nowSeconds;
    return domainMatches && pathMatches && isAlive;
  });

  if (cookies.length === 0) return undefined;
  return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}

export async function fetchProviderJson(
  url: URL,
  session: ProviderSession,
  allowedOrigins: readonly string[],
  context: ProviderRequestContext,
  options: { headers?: Readonly<Record<string, string>> } = {},
): Promise<unknown> {
  if (!allowedOrigins.includes(url.origin)) {
    throw new ProviderResponseError(`Blocked provider origin: ${url.origin}`);
  }

  const headers = new Headers({
    Accept: "application/json",
    "User-Agent": session.userAgent ?? "MangaHub/0.1",
    ...options.headers,
  });

  if (session.accessToken) {
    const token = session.accessToken.startsWith("Bearer ")
      ? session.accessToken
      : `Bearer ${session.accessToken}`;
    headers.set("Authorization", token);
  }

  const cookies = cookieHeader(session, url);
  if (cookies) headers.set("Cookie", cookies);

  let response: Response;
  try {
    response = await context.fetch(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: context.signal,
    });
  } catch (error) {
    throw new ProviderResponseError("Provider request failed", { cause: error });
  }

  if (response.status === 401) throw new ProviderAuthError();
  if (response.status === 403) throw new ProviderChallengeError();
  if (response.status === 429) {
    throw new ProviderRateLimitError(
      parseRetryAfter(response.headers.get("retry-after"), context.now?.() ?? new Date()),
    );
  }
  if (!response.ok) {
    throw new ProviderResponseError(`Provider returned HTTP ${response.status}`);
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new ProviderResponseError("Provider response is too large");
  }

  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_RESPONSE_BYTES) {
    throw new ProviderResponseError("Provider response is too large");
  }

  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch (error) {
    throw new ProviderResponseError("Provider returned invalid JSON", { cause: error });
  }
}
