import { beforeEach, describe, expect, it, vi } from "vitest";
import { localApprovalSettings, localRunnerAuditEvents, localRunners, localTaskApprovals } from "../drizzle/schema";

const state = vi.hoisted(() => {
  process.env.DATABASE_URL = "mysql://palm-dashboard-test";
  const runner = { id: 9, userId: 41, label: "Studio Mac", status: "offline", lastSeenAt: null, allowedToolsJson: '["inventory_files","write_result_record"]', allowedSkillSlugsJson: '["document-intelligence"]', requiresApprovalForSensitive: true, createdAt: new Date(), updatedAt: new Date() };
  const audit: any[] = [];
  const rowsFor = (table: unknown) => table === localRunners ? [runner] : table === localRunnerAuditEvents ? audit : table === localApprovalSettings ? [] : table === localTaskApprovals ? [] : [];
  const queryFor = (table: unknown) => {
    const chain: any = Promise.resolve(rowsFor(table));
    chain.limit = vi.fn(async () => rowsFor(table));
    chain.orderBy = vi.fn(() => chain);
    return chain;
  };
  const db = {
    select: vi.fn(() => ({ from: vi.fn((table: unknown) => ({ where: vi.fn(() => queryFor(table)), orderBy: vi.fn(() => queryFor(table)) })) })),
    update: vi.fn((table: unknown) => ({ set: vi.fn((values: Record<string, unknown>) => ({ where: vi.fn(async () => { if (table === localRunners) Object.assign(runner, values); }) })) })),
    insert: vi.fn((table: unknown) => ({ values: vi.fn(async (values: Record<string, unknown>) => { if (table === localRunnerAuditEvents) audit.unshift({ id: audit.length + 1, ...values, createdAt: new Date() }); return [{ insertId: audit.length + 1 }]; }) })),
  };
  return { db, runner, audit };
});

vi.mock("drizzle-orm/mysql2", () => ({ drizzle: vi.fn(() => state.db) }));

import { getLocalRunnerDashboard, touchLocalRunner } from "./db";

describe("Palm Local Runner activity dashboard", () => {
  beforeEach(() => {
    Object.assign(state.runner, { status: "offline", lastSeenAt: null });
    state.audit.splice(0, state.audit.length);
    vi.clearAllMocks();
  });

  it("records heartbeat activity and reports a recently seen device as online", async () => {
    await touchLocalRunner(9, "online");
    const dashboard = await getLocalRunnerDashboard(41);
    expect(state.audit[0]).toMatchObject({ userId: 41, runnerId: 9, eventType: "runner.heartbeat" });
    expect(dashboard.runners[0]).toMatchObject({ id: 9, connectionStatus: "online" });
    expect(dashboard.activity[0]).toMatchObject({ eventType: "runner.heartbeat" });
  });
});
