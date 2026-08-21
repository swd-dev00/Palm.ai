import { beforeEach, describe, expect, it, vi } from "vitest";
import { localRunners, localTaskApprovals } from "../drizzle/schema";

const state = vi.hoisted(() => {
  process.env.DATABASE_URL = "mysql://palm-test";
  const runner = { label: "Desk Mac", status: "offline" };
  const approval = { id: 5, userId: 41, taskId: 81, status: "pending", policyJson: "{}", expiresAt: new Date(Date.now() + 60_000), decidedAt: null };
  const db = {
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          if (table === localRunners) Object.assign(runner, values);
          if (table === localTaskApprovals) Object.assign(approval, values);
        }),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(async () => [{ insertId: 1 }]) })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => [approval]) })),
      })),
    })),
  };
  return { db, runner, approval };
});

vi.mock("drizzle-orm/mysql2", () => ({ drizzle: vi.fn(() => state.db) }));

import { decideLocalTaskApproval, getLocalTaskApproval, renameLocalRunner, revokeLocalRunner } from "./db";

describe("Palm Local Runner persistence controls", () => {
  beforeEach(() => {
    Object.assign(state.runner, { label: "Desk Mac", status: "offline" });
    Object.assign(state.approval, { status: "pending", expiresAt: new Date(Date.now() + 60_000), decidedAt: null });
    vi.clearAllMocks();
  });

  it("persists an updated device name and revocation state", async () => {
    await renameLocalRunner(41, 9, "Studio Mac");
    expect(state.runner.label).toBe("Studio Mac");
    await revokeLocalRunner(41, 9);
    expect(state.runner.status).toBe("revoked");
  });

  it("persists an approval transition with a decision timestamp", async () => {
    const approval = await decideLocalTaskApproval(41, 81, "approved");
    expect(approval).toMatchObject({ status: "approved" });
    expect(state.approval.decidedAt).toBeInstanceOf(Date);
  });

  it("automatically expires a pending approval when it is read after its timeout", async () => {
    state.approval.expiresAt = new Date(Date.now() - 1_000);
    const approval = await getLocalTaskApproval(41, 81);
    expect(approval).toMatchObject({ status: "expired" });
    expect(state.approval.status).toBe("expired");
    expect(state.approval.decidedAt).toBeInstanceOf(Date);
  });
});
