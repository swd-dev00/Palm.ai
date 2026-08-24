import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  addAssistantMessage: vi.fn(), appendRunnerEvent: vi.fn(), claimQueuedTaskForLocalRunner: vi.fn(), claimRunnerRunForLocalRunner: vi.fn(), createPendingLocalTaskApproval: vi.fn(), createLocalRunner: vi.fn(), createRunnerRun: vi.fn(), getLastRunnerEventSequence: vi.fn(), getLocalRunnerByTokenHash: vi.fn(), getLocalRunnerForUser: vi.fn(), getLocalTaskApproval: vi.fn(), getRunnerRun: vi.fn(), getSkillCatalog: vi.fn(), getTaskDetail: vi.fn(), listQueuedTasksForLocalRunner: vi.fn(), recordLocalRunnerAudit: vi.fn(), touchLocalRunner: vi.fn(), updateExecutionStep: vi.fn(), updateRunnerRun: vi.fn(), updateTaskStatus: vi.fn(),
}));
vi.mock("./db", () => db);

import { authenticateLocalRunner, claimLocalTask, registerLocalRunner, requestLocalBrowserApproval } from "./localRunner";

describe("Palm zero-cost Local Runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.createLocalRunner.mockResolvedValue(7);
    db.getLocalRunnerByTokenHash.mockResolvedValue({ id: 7, userId: 4, label: "My laptop", status: "offline", allowedToolsJson: '["inventory_files","extract_text_metadata","profile_csv","write_result_record"]', requiresApprovalForSensitive: true });
    db.claimQueuedTaskForLocalRunner.mockResolvedValue({ id: 22, title: "Local task", prompt: "Create a local record" });
    db.listQueuedTasksForLocalRunner.mockResolvedValue([{ id: 22, title: "Local task", prompt: "Create a local record" }]);
    db.createRunnerRun.mockResolvedValue(9);
    db.claimRunnerRunForLocalRunner.mockResolvedValue({ id: 9, taskId: 22, provider: "local", policyJson: JSON.stringify({ allowedTools: ["inventory_files", "extract_text_metadata", "profile_csv", "write_result_record"] }) });
    db.getTaskDetail.mockResolvedValue({ task: { id: 22, title: "Local task", prompt: "Create a local record" }, attachments: [] });
    db.getLocalTaskApproval.mockResolvedValue(null);
    db.getSkillCatalog.mockResolvedValue([{ slug: "document-intelligence", enabled: true }]);
    db.appendRunnerEvent.mockResolvedValue({ duplicate: false });
  });

  it("creates a one-time token while persisting only its hash", async () => {
    const registration = await registerLocalRunner(4, "My laptop");
    expect(registration).toMatchObject({ runnerId: 7 });
    expect(registration.token).toMatch(/^palm_local_/);
    expect(db.createLocalRunner).toHaveBeenCalledWith(4, "My laptop", expect.not.stringContaining(registration.token), "file");
  });

  it("rejects a revoked device token before it can claim any task", async () => {
    db.getLocalRunnerByTokenHash.mockResolvedValueOnce({ id: 7, userId: 4, label: "Retired laptop", status: "revoked" });
    await expect(authenticateLocalRunner("palm_local_revoked")).rejects.toThrow("revoked");
    expect(db.touchLocalRunner).not.toHaveBeenCalled();
    expect(db.claimQueuedTaskForLocalRunner).not.toHaveBeenCalled();
  });

  it("does not assign work to a device that lacks the required result-record tool scope", async () => {
    db.getLocalRunnerByTokenHash.mockResolvedValueOnce({ id: 7, userId: 4, label: "Read-only laptop", status: "offline", allowedToolsJson: '["inventory_files"]', requiresApprovalForSensitive: true });
    await expect(claimLocalTask("palm_local_scoped")).resolves.toMatchObject({ scopeRestricted: true, allowedTools: ["inventory_files"] });
    expect(db.listQueuedTasksForLocalRunner).not.toHaveBeenCalled();
    expect(db.createRunnerRun).not.toHaveBeenCalled();
  });

  it("skips a task when the device forbids its requested sensitive action class", async () => {
    db.getLocalRunnerByTokenHash.mockResolvedValueOnce({ id: 7, userId: 4, label: "Offline archive", status: "offline", allowedToolsJson: '["inventory_files","write_result_record"]', allowedSkillSlugsJson: '["document-intelligence"]', allowedSensitiveActionsJson: '["file_mutation"]', requiresApprovalForSensitive: true });
    db.listQueuedTasksForLocalRunner.mockResolvedValue([{ id: 25, title: "External send", prompt: "Upload the local report" }]);
    await expect(claimLocalTask("palm_local_action-scope")).resolves.toMatchObject({ scopeRestricted: true, reason: expect.stringContaining("external sharing") });
    expect(db.claimQueuedTaskForLocalRunner).not.toHaveBeenCalled();
    expect(db.createRunnerRun).not.toHaveBeenCalled();
  });

  it("authenticates the local token, claims queued work, and emits a durable local run event", async () => {
    const registration = await registerLocalRunner(4, "My laptop");
    await expect(authenticateLocalRunner(registration.token)).resolves.toMatchObject({ id: 7, userId: 4 });
    const assignment = await claimLocalTask(registration.token);
    expect(assignment).toMatchObject({ runId: 9, task: { id: 22 }, capabilityScope: ["document-intelligence"] });
    expect(db.updateRunnerRun).toHaveBeenCalledWith(9, "running");
    expect(db.appendRunnerEvent).toHaveBeenCalledWith(9, 22, expect.objectContaining({ type: "local.claimed", status: "running" }));
    expect(db.recordLocalRunnerAudit).toHaveBeenCalledWith(expect.objectContaining({ runnerId: 7, taskId: 22, eventType: "runner.run_claimed" }));
  });

  it("filters the task capability payload to the claiming device’s permitted Palm capabilities", async () => {
    db.getLocalRunnerByTokenHash.mockResolvedValueOnce({ id: 7, userId: 4, label: "Analysis laptop", status: "offline", allowedToolsJson: '["inventory_files","write_result_record"]', allowedSkillSlugsJson: '["document-intelligence"]', requiresApprovalForSensitive: true });
    db.getSkillCatalog.mockResolvedValueOnce([{ slug: "document-intelligence", enabled: true }, { slug: "web-research", enabled: true }]);
    const assignment = await claimLocalTask("palm_local_scoped-capabilities");
    expect(assignment).toMatchObject({ capabilityScope: ["document-intelligence"], localToolPolicy: { allowedTools: ["inventory_files", "write_result_record"] } });
  });

  it("passes local-only attachment references to a file runner without a cloud storage URL", async () => {
    db.getTaskDetail.mockResolvedValueOnce({ task: { id: 22, title: "Local task", prompt: "Analyze customer margin" }, attachments: [{ id: 15, originalName: "margin.csv", mimeType: "text/csv", source: "local_reference", localRelativePath: "margin.csv" }] });
    const assignment = await claimLocalTask("palm_local_attachment-reference");
    expect(assignment).toMatchObject({ attachments: [{ id: 15, name: "margin.csv", source: "local_reference", localRelativePath: "margin.csv" }] });
    expect(JSON.stringify(assignment)).not.toContain("storageUrl");
  });

  it("creates an explicit approval request before a browser write tool can proceed", async () => {
    db.getLocalRunnerByTokenHash.mockResolvedValueOnce({ id: 8, userId: 4, label: "Browser Mac", runnerType: "browser", status: "online", allowedToolsJson: "[]", allowedBrowserToolsJson: '["open_tab","navigate","screenshot","read_page_text","close_tab","type_text"]', navigationAllowlistJson: '["docs.example.com"]', allowedSensitiveActionsJson: '["browser_control"]', requiresApprovalForSensitive: true, requiresApprovalForBrowserWrites: true });
    db.getRunnerRun.mockResolvedValueOnce({ id: 9, provider: "local", taskId: 22, localRunnerId: 8 });
    db.getTaskDetail.mockResolvedValueOnce({ task: { id: 22, title: "Browser task", prompt: "Update the documentation" }, attachments: [] });
    db.createPendingLocalTaskApproval.mockResolvedValueOnce({ id: 17, status: "pending" });
    await expect(requestLocalBrowserApproval("palm_local_browser", 9, { tool: "type_text", url: "https://docs.example.com/edit", targetSummary: "Update the draft" })).resolves.toMatchObject({ approvalRequired: true, taskId: 22 });
    expect(db.createPendingLocalTaskApproval).toHaveBeenCalledWith(4, 22, expect.objectContaining({ sensitiveActionClass: "browser_control", allowedBrowserTools: ["type_text"] }), 8);
    expect(db.recordLocalRunnerAudit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "browser.approval_requested", runnerId: 8 }));
  });

  it("holds a sensitive request in the queue and creates an owner approval record before assigning it", async () => {
    db.claimQueuedTaskForLocalRunner.mockResolvedValue({ id: 22, title: "Sensitive task", prompt: "Delete the local archive after review" });
    db.listQueuedTasksForLocalRunner.mockResolvedValue([{ id: 22, title: "Sensitive task", prompt: "Delete the local archive after review" }]);
    const assignment = await claimLocalTask("palm_local_example");
    expect(assignment).toMatchObject({ approvalRequired: true, taskId: 22, policy: { requiresApproval: true } });
    expect(db.createPendingLocalTaskApproval).toHaveBeenCalledWith(4, 22, expect.objectContaining({ requiresApproval: true }), 7);
    expect(db.updateTaskStatus).toHaveBeenCalledWith(22, "queued");
    expect(db.createRunnerRun).not.toHaveBeenCalled();
  });

  it("releases an approved task and marks a rejected request as needing review", async () => {
    db.claimQueuedTaskForLocalRunner.mockResolvedValue({ id: 22, title: "Sensitive task", prompt: "Upload the local report" });
    db.listQueuedTasksForLocalRunner.mockResolvedValue([{ id: 22, title: "Sensitive task", prompt: "Upload the local report" }]);
    db.getLocalTaskApproval.mockResolvedValueOnce({ status: "approved" });
    await expect(claimLocalTask("palm_local_example")).resolves.toMatchObject({ runId: 9 });
    expect(db.createRunnerRun).toHaveBeenCalled();

    db.createRunnerRun.mockClear();
    db.claimQueuedTaskForLocalRunner.mockResolvedValue({ id: 23, title: "Rejected task", prompt: "Upload the local report" });
    db.listQueuedTasksForLocalRunner.mockResolvedValue([{ id: 23, title: "Rejected task", prompt: "Upload the local report" }]);
    db.getLocalTaskApproval.mockResolvedValueOnce({ status: "rejected" });
    await expect(claimLocalTask("palm_local_example")).resolves.toBeNull();
    expect(db.updateTaskStatus).toHaveBeenCalledWith(23, "error", expect.objectContaining({ errorMessage: expect.stringContaining("rejected") }));
    expect(db.createRunnerRun).not.toHaveBeenCalled();
  });

  it("marks a queued sensitive task for review when its approval has expired", async () => {
    db.claimQueuedTaskForLocalRunner.mockResolvedValue({ id: 24, title: "Expired approval", prompt: "Upload the local report" });
    db.listQueuedTasksForLocalRunner.mockResolvedValue([{ id: 24, title: "Expired approval", prompt: "Upload the local report" }]);
    db.getLocalTaskApproval.mockResolvedValueOnce({ id: 4, status: "expired" });
    await expect(claimLocalTask("palm_local_example")).resolves.toBeNull();
    expect(db.updateTaskStatus).toHaveBeenCalledWith(24, "error", expect.objectContaining({ errorMessage: expect.stringContaining("expired") }));
    expect(db.createRunnerRun).not.toHaveBeenCalled();
  });
});
