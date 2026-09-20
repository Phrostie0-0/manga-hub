import {
  ProviderAuthError,
  ProviderChallengeError,
  ProviderRateLimitError,
} from "../../packages/connectors/src";

export const HOURLY_SYNC_MS = 60 * 60 * 1_000;
const MINIMUM_RETRY_MS = 15 * 60 * 1_000;
const MAXIMUM_RETRY_MS = 24 * HOURLY_SYNC_MS;

type SyncFailureDisposition = {
  status: "reauth_required" | "needs_attention" | "rate_limited" | "degraded";
  retryDelayMs?: number;
};

export function syncFailureDisposition(error: unknown): SyncFailureDisposition {
  if (error instanceof ProviderAuthError) return { status: "reauth_required" };
  if (error instanceof ProviderChallengeError) return { status: "needs_attention" };
  if (error instanceof ProviderRateLimitError) {
    return {
      status: "rate_limited",
      retryDelayMs: Math.min(
        MAXIMUM_RETRY_MS,
        Math.max(MINIMUM_RETRY_MS, error.retryAfterMs ?? MINIMUM_RETRY_MS),
      ),
    };
  }
  return { status: "degraded", retryDelayMs: HOURLY_SYNC_MS };
}
