import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  addAttachment: vi.fn(), createProject: vi.fn(), createTask: vi.fn(), decideLocalTaskApproval: vi.fn(), deleteLocalAuditExportTemplate: vi.fn(), deleteLocalAuditFilterPreset: vi.fn(), deleteTask: vi.fn(), getDashboardSnapshot: vi.fn(), getLocalApprovalSettings: vi.fn(), getLocalRunnerDashboard: vi.fn(), getSkillCatalog: vi.fn(), getTaskDetail: vi.fn(), listLocalAuditExportTemplates: vi.fn(), listLocalAuditFilterPresets: vi.fn(), listLocalRunnerAudit: vi.fn(), listLocalRunners: vi.fn(), listPendingLocalApprovals: vi.fn(), listProjects: vi.fn(), listTasks: vi.fn(), renameLocalRunner: vi.fn(), revokeLocalRunner: vi.fn(), saveLocalAuditExportTemplate: vi.fn(), saveLocalAuditFilterPreset: vi.fn(), setLocalApprovalExpiry: vi.fn(), setLocalRunnerApprovalExpiryOverride: vi.fn(), setSkillEnabled: vi.fn(), updateLocalRunnerScope: vi.fn(),
}));

vi.mock("./db", () => db);
vi.mock("./localRunner", () => ({ registerLocalRunner: vi.fn() }));

import { appRouter } from "./routers";

describe("Palm Local Runner controls", () => {
  const caller = appRouter.createCaller({ user: { id: 41, openId: "runner-owner", role: "user" } } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    db.decideLocalTaskApproval.mockResolvedValue({ taskId: 81, status: "approved" });
    db.getLocalRunnerDashboard.mockResolvedValue({ runners: [], activity: [], approvalSettings: { expiryMinutes: 15 } });
    db.setLocalApprovalExpiry.mockResolvedValue({ expiryMinutes: 30 });
    db.setLocalRunnerApprovalExpiryOverride.mockResolvedValue({ id: 9, approvalExpiryOverrideMinutes: 45 });
    db.listLocalRunnerAudit.mockResolvedValue([]);
    db.listPendingLocalApprovals.mockResolvedValue([]);
    db.listLocalAuditFilterPresets.mockResolvedValue([]);
    db.saveLocalAuditFilterPreset.mockResolvedValue([]);
    db.deleteLocalAuditFilterPreset.mockResolvedValue(true);
    db.listLocalAuditExportTemplates.mockResolvedValue([]);
    db.saveLocalAuditExportTemplate.mockResolvedValue([]);
    db.deleteLocalAuditExportTemplate.mockResolvedValue(true);
  });

  it("renames and revokes only the caller’s selected runner device", async () => {
    await expect(caller.palm.renameLocalRunner({ runnerId: 9, label: "Studio Mac" })).resolves.toEqual({ success: true });
    await expect(caller.palm.revokeLocalRunner({ runnerId: 9 })).resolves.toEqual({ success: true });
    expect(db.renameLocalRunner).toHaveBeenCalledWith(41, 9, "Studio Mac");
    expect(db.revokeLocalRunner).toHaveBeenCalledWith(41, 9);
  });

  it("persists an explicit approved or rejected local-action decision", async () => {
    await expect(caller.palm.decideLocalApproval({ taskId: 81, decision: "approved" })).resolves.toMatchObject({ status: "approved" });
    await caller.palm.decideLocalApproval({ taskId: 81, decision: "rejected" });
    expect(db.decideLocalTaskApproval).toHaveBeenNthCalledWith(1, 41, 81, "approved");
    expect(db.decideLocalTaskApproval).toHaveBeenNthCalledWith(2, 41, 81, "rejected");
  });

  it("updates device-specific tools and approval controls, then returns live dashboard data", async () => {
    await caller.palm.updateLocalRunnerScope({ runnerId: 9, allowedTools: ["inventory_files", "write_result_record"], allowedSkillSlugs: ["document-intelligence"], allowedSensitiveActions: ["file_mutation"], requiresApprovalForSensitive: true });
    await caller.palm.setLocalApprovalExpiry({ expiryMinutes: 30 });
    await expect(caller.palm.localRunnerDashboard()).resolves.toMatchObject({ approvalSettings: { expiryMinutes: 15 } });
    expect(db.updateLocalRunnerScope).toHaveBeenCalledWith(41, 9, { allowedTools: ["inventory_files", "write_result_record"], allowedSkillSlugs: ["document-intelligence"], allowedSensitiveActions: ["file_mutation"], allowedBrowserTools: ["open_tab", "navigate", "screenshot", "read_page_text", "close_tab"], navigationAllowlist: [], requiresApprovalForSensitive: true, requiresApprovalForBrowserWrites: true });
    expect(db.setLocalApprovalExpiry).toHaveBeenCalledWith(41, 30);
    expect(db.getLocalRunnerDashboard).toHaveBeenCalledWith(41);
  });

  it("sets a device timeout override and forwards audit-history filters within the caller’s workspace", async () => {
    await caller.palm.setLocalRunnerApprovalExpiryOverride({ runnerId: 9, expiryMinutes: 45 });
    await caller.palm.localRunnerAudit({ runnerId: 9, eventType: "approval.requested", startAt: new Date("2026-08-01T00:00:00.000Z"), endAt: new Date("2026-08-21T23:59:59.999Z") });
    expect(db.setLocalRunnerApprovalExpiryOverride).toHaveBeenCalledWith(41, 9, 45);
    expect(db.listLocalRunnerAudit).toHaveBeenCalledWith(41, expect.objectContaining({ runnerId: 9, eventType: "approval.requested", limit: 500 }));
  });

  it("returns pending approval countdown data and persists saved audit filter presets for the caller", async () => {
    await caller.palm.pendingLocalApprovals();
    await caller.palm.saveLocalAuditFilterPreset({ label: "Studio activity", filters: { runnerId: 9, eventType: "runner.heartbeat" } });
    await caller.palm.deleteLocalAuditFilterPreset({ presetId: 3 });
    expect(db.listPendingLocalApprovals).toHaveBeenCalledWith(41);
    expect(db.saveLocalAuditFilterPreset).toHaveBeenCalledWith(41, "Studio activity", { runnerId: 9, eventType: "runner.heartbeat" });
    expect(db.deleteLocalAuditFilterPreset).toHaveBeenCalledWith(41, 3);
  });

  it("persists, lists, and deletes CSV column templates only inside the caller’s device scope", async () => {
    await caller.palm.localAuditExportTemplates({ runnerId: 9 });
    await caller.palm.saveLocalAuditExportTemplate({ runnerId: 9, label: "Evidence handoff", columns: ["timestamp", "device", "detail"] });
    await caller.palm.deleteLocalAuditExportTemplate({ templateId: 4 });
    expect(db.listLocalAuditExportTemplates).toHaveBeenCalledWith(41, 9);
    expect(db.saveLocalAuditExportTemplate).toHaveBeenCalledWith(41, 9, "Evidence handoff", ["timestamp", "device", "detail"]);
    expect(db.deleteLocalAuditExportTemplate).toHaveBeenCalledWith(41, 4);
  });
});
