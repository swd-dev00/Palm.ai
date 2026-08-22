import { describe, expect, it } from "vitest";
import { approvalRemainingMs, formatApprovalCountdown, isApprovalNearExpiry } from "./client/src/lib/approvalCountdown";

describe("Palm approval countdown", () => {
  const now = Date.parse("2026-08-21T12:00:00.000Z");

  it("identifies imminent approvals and formats their durable expiry countdown", () => {
    const expiresAt = "2026-08-21T12:04:09.000Z";
    expect(approvalRemainingMs(expiresAt, now)).toBe(249_000);
    expect(isApprovalNearExpiry(expiresAt, now)).toBe(true);
    expect(formatApprovalCountdown(expiresAt, now)).toBe("4:09");
  });

  it("does not mark a distant approval as urgent and floors expired countdowns at zero", () => {
    expect(isApprovalNearExpiry("2026-08-21T12:11:00.000Z", now)).toBe(false);
    expect(formatApprovalCountdown("2026-08-21T11:59:00.000Z", now)).toBe("0:00");
  });
});
