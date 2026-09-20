import { describe, expect, it } from "vitest";

import { planConnectionAction } from "../../src/server/services/connection-actions";

describe("planConnectionAction", () => {
  it.each([
    "active",
    "pending_auth",
    "awaiting_user",
    "validating",
    "importing",
    "rate_limited",
  ] as const)("does not duplicate work while a connection is %s", (status) => {
    expect(planConnectionAction(status, true)).toEqual({ status, nextAction: "none" });
  });

  it("reuses a stored session only for a degraded sync", () => {
    expect(planConnectionAction("degraded", true)).toEqual({
      status: "importing",
      nextAction: "sync",
    });
    expect(planConnectionAction("degraded", false)).toEqual({
      status: "pending_auth",
      nextAction: "authorize",
    });
  });

  it.each(["needs_attention", "reauth_required"] as const)(
    "starts a fresh authorization after %s",
    (status) => {
      expect(planConnectionAction(status, true)).toEqual({
        status: "pending_auth",
        nextAction: "authorize",
      });
    },
  );
});
