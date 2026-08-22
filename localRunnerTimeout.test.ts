import { beforeEach, describe, expect, it, vi } from "vitest";
import { localApprovalSettings, localRunnerAuditEvents, localRunners, localTaskApprovals } from "./drizzle/schema";

const state = vi.hoisted(() => {
  process.env.DATABASE_URL = "mysql://palm-timeout-test";
  const runner = { id: 9, userId: 41, approvalExpiryOverrideMinutes: 3 };
  const settings = { id: 1, userId: 41, expiryMinutes: 15 };
  let approval: any = null;
  const rowsFor = (table: unknown) => table === localRunners ? [runner] : table === localApprovalSettings ? [settings] : table === localTaskApprovals ? approval ? [approval] : [] : [];
  const chainFor = (table: unknown) => {
    const chain: any = Promise.resolve(rowsFor(table));
    chain.limit = vi.fn(async () => rowsFor(table));
    chain.orderBy = vi.fn(() => chain);
    return chain;
  };
  const db = {
    select: vi.fn(() => ({ from: vi.fn((table: unknown) => ({ where: vi.fn(() => chainFor(table)), orderBy: vi.fn(() => chainFor(table)) })) })),
    insert: vi.fn((table: unknown) => ({ values: vi.fn(async (values: Record<string, unknown>) => { if (table === localTaskApprovals) approval = { id: 1, ...values }; return [{ insertId: 1 }]; }) })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => {}) })),
    })),
  };
  return { db, runner, getApproval: () => approval, reset: () => { approval = null; } };
});

vi.mock("drizzle-orm/mysql2", () => ({ drizzle: vi.fn(() => state.db) }));

import { createPendingLocalTaskApproval, resolveLocalApprovalExpiryMinutes } from "./db";

describe("Palm Local Runner approval timeout resolution", () => {
  beforeEach(() => { state.runner.approvalExpiryOverrideMinutes = 3; state.reset(); vi.clearAllMocks(); });

  it("uses the device override for a sensitive task approval", async () => {
    const before = Date.now();
    await createPendingLocalTaskApproval(41, 81, { requiresApproval: true }, 9);
    const expiresAt = state.getApproval().expiresAt.getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 179_000);
    expect(expiresAt).toBeLessThanOrEqual(before + 181_000);
  });

  it("falls back to the workspace default when a device has no override", async () => {
    state.runner.approvalExpiryOverrideMinutes = null as any;
    await expect(resolveLocalApprovalExpiryMinutes(41, 9)).resolves.toBe(15);
  });
});
