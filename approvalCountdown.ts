export function approvalRemainingMs(expiresAt: Date | string, now = Date.now()) {
  return Math.max(0, new Date(expiresAt).getTime() - now);
}

export function isApprovalNearExpiry(expiresAt: Date | string, now = Date.now(), thresholdMs = 10 * 60_000) {
  return approvalRemainingMs(expiresAt, now) <= thresholdMs;
}

export function formatApprovalCountdown(expiresAt: Date | string, now = Date.now()) {
  const remaining = approvalRemainingMs(expiresAt, now);
  return `${Math.floor(remaining / 60_000)}:${String(Math.floor((remaining % 60_000) / 1_000)).padStart(2, "0")}`;
}
