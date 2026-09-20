import type { sourceConnectionStatus } from "@/server/db/schema/product";

export type ConnectionStatus = (typeof sourceConnectionStatus.enumValues)[number];
export type ConnectionNextAction = "none" | "authorize" | "sync";

const NON_RESTARTABLE_STATES = new Set<ConnectionStatus>([
  "active",
  "pending_auth",
  "awaiting_user",
  "validating",
  "importing",
  "rate_limited",
  "disabled",
]);

export function planConnectionAction(
  status: ConnectionStatus,
  hasStoredSession: boolean,
): { status: ConnectionStatus; nextAction: ConnectionNextAction } {
  if (NON_RESTARTABLE_STATES.has(status)) {
    return { status, nextAction: "none" };
  }

  if (status === "degraded" && hasStoredSession) {
    return { status: "importing", nextAction: "sync" };
  }

  return { status: "pending_auth", nextAction: "authorize" };
}
