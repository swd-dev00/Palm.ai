import { and, asc, desc, eq, gte, isNull, lte, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  agentTasks,
  executionSteps,
  InsertUser,
  localApprovalSettings,
  localAuditExportTemplates,
  localAuditFilterPresets,
  localRunnerAuditEvents,
  localRunnerRequestNonces,
  localRunners,
  localTaskApprovals,
  projects,
  runnerEvents,
  runnerRuns,
  skillSettings,
  taskAttachments,
  taskMessages,
  users,
} from "./schema";
import { ENV } from "./_core/env";
import { createInitialWorkflowSteps, mergeSkillPreferences } from "./palmDomain";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("The Palm.ai database is temporarily unavailable.");
  return db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");

  const db = await requireDb();
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;

  textFields.forEach(field => {
    const value = user[field];
    if (value !== undefined) {
      values[field] = value ?? null;
      updateSet[field] = value ?? null;
    }
  });

  values.role = user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user");
  updateSet.role = values.role;
  values.lastSignedIn = user.lastSignedIn ?? new Date();
  updateSet.lastSignedIn = values.lastSignedIn;

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function listProjects(userId: number) {
  const db = await requireDb();
  return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.updatedAt));
}

export async function createProject(userId: number, title: string, description?: string) {
  const db = await requireDb();
  const result = await db.insert(projects).values({ userId, title, description: description || null });
  return Number(result[0].insertId);
}

export async function listTasks(userId: number) {
  const db = await requireDb();
  return db.select().from(agentTasks).where(eq(agentTasks.userId, userId)).orderBy(desc(agentTasks.updatedAt));
}

export async function getTaskDetail(userId: number, taskId: number) {
  const db = await requireDb();
  const task = (await db.select().from(agentTasks).where(and(eq(agentTasks.id, taskId), eq(agentTasks.userId, userId))).limit(1))[0];
  if (!task) return null;

  const [messages, steps, attachments, runs] = await Promise.all([
    db.select().from(taskMessages).where(eq(taskMessages.taskId, taskId)).orderBy(taskMessages.createdAt),
    db.select().from(executionSteps).where(eq(executionSteps.taskId, taskId)).orderBy(executionSteps.stepOrder),
    db.select().from(taskAttachments).where(eq(taskAttachments.taskId, taskId)).orderBy(desc(taskAttachments.createdAt)),
    db.select().from(runnerRuns).where(eq(runnerRuns.taskId, taskId)).orderBy(desc(runnerRuns.createdAt)),
  ]);
  const latestRun = runs[0] ?? null;
  const runnerEventsForRun = latestRun
    ? await db.select().from(runnerEvents).where(eq(runnerEvents.runId, latestRun.id)).orderBy(asc(runnerEvents.eventSeq))
    : [];
  const localApproval = await getLocalTaskApproval(userId, taskId);
  if (localApproval?.status === "expired" && task.status === "queued") {
    const errorMessage = "The required Local Runner approval expired before a device could execute the task.";
    await db.update(agentTasks).set({ status: "error", errorMessage, completedAt: new Date() }).where(eq(agentTasks.id, task.id));
    task.status = "error";
    task.errorMessage = errorMessage;
  }
  return { task, messages, steps, attachments, latestRun, runnerEvents: runnerEventsForRun, localApproval };
}

// This lookup is deliberately narrower than getTaskDetail. It is used by an
// authenticated external runner to construct a manifest only after the runner
// is bound to an existing runner_runs record.
export async function getRunnerTaskManifestDetail(taskId: number) {
  const db = await requireDb();
  const task = (await db.select().from(agentTasks).where(eq(agentTasks.id, taskId)).limit(1))[0];
  if (!task) return null;
  const attachments = await db.select().from(taskAttachments).where(eq(taskAttachments.taskId, taskId)).orderBy(desc(taskAttachments.createdAt));
  return { task, attachments };
}

export async function createTask(input: { userId: number; projectId?: number; prompt: string; title: string; executionTarget?: "auto" | "local_file" | "local_browser" }) {
  const db = await requireDb();
  const result = await db.insert(agentTasks).values({
    userId: input.userId,
    projectId: input.projectId ?? null,
    title: input.title,
    prompt: input.prompt,
    executionTarget: input.executionTarget ?? "auto",
    status: "queued",
  });
  const taskId = Number(result[0].insertId);
  await db.insert(taskMessages).values({ taskId, role: "user", content: input.prompt });
  await db.insert(executionSteps).values(createInitialWorkflowSteps().map(step => ({ taskId, ...step })));
  return taskId;
}

export async function updateTaskStatus(taskId: number, status: "queued" | "running" | "completed" | "error", extras?: { assistantResponse?: string; errorMessage?: string }) {
  const db = await requireDb();
  await db.update(agentTasks).set({
    status,
    assistantResponse: extras?.assistantResponse,
    errorMessage: extras?.errorMessage,
    completedAt: status === "completed" || status === "error" ? new Date() : null,
  }).where(eq(agentTasks.id, taskId));
}

export async function updateExecutionStep(taskId: number, stepOrder: number, status: "pending" | "running" | "completed" | "error", detail?: string) {
  const db = await requireDb();
  await db.update(executionSteps).set({ status, ...(detail ? { detail } : {}) })
    .where(and(eq(executionSteps.taskId, taskId), eq(executionSteps.stepOrder, stepOrder)));
}

export async function addAssistantMessage(taskId: number, content: string) {
  const db = await requireDb();
  await db.insert(taskMessages).values({ taskId, role: "assistant", content });
}

export async function deleteTask(userId: number, taskId: number) {
  const db = await requireDb();
  const existing = await getTaskDetail(userId, taskId);
  if (!existing) return false;
  const runs = await db.select().from(runnerRuns).where(eq(runnerRuns.taskId, taskId));
  for (const run of runs) await db.delete(runnerEvents).where(eq(runnerEvents.runId, run.id));
  await db.delete(runnerRuns).where(eq(runnerRuns.taskId, taskId));
  await db.delete(taskAttachments).where(eq(taskAttachments.taskId, taskId));
  await db.delete(taskMessages).where(eq(taskMessages.taskId, taskId));
  await db.delete(executionSteps).where(eq(executionSteps.taskId, taskId));
  await db.delete(agentTasks).where(and(eq(agentTasks.id, taskId), eq(agentTasks.userId, userId)));
  return true;
}

export type RunnerRunStatus = "queued" | "claimable" | "claimed" | "dispatching" | "provisioning" | "running" | "collecting" | "completed" | "failed" | "cancellation_requested" | "cancelled";
export type RunnerEventInput = {
  eventSeq: number;
  source: "control_plane" | "github_actions" | "runner" | "artifact_store";
  type: string;
  status: string;
  detail: string;
  data?: Record<string, unknown>;
};

export async function createRunnerRun(input: { taskId: number; provider: "local" | "github_actions"; userId?: number; localRunnerId?: number | null; runnerClass?: string; status?: RunnerRunStatus; idempotencyKey: string; policy?: Record<string, unknown> }) {
  const db = await requireDb();
  const task = (await db.select({ userId: agentTasks.userId }).from(agentTasks).where(eq(agentTasks.id, input.taskId)).limit(1))[0];
  const userId = input.userId ?? task?.userId;
  if (!userId) throw new Error("Cannot create a runner run without an owning user.");
  const result = await db.insert(runnerRuns).values({
    taskId: input.taskId,
    userId,
    provider: input.provider,
    localRunnerId: input.localRunnerId ?? null,
    status: input.status ?? "queued",
    runnerClass: input.runnerClass ?? "standard",
    idempotencyKey: input.idempotencyKey,
    policyJson: input.policy ? JSON.stringify(input.policy) : null,
  });
  return Number(result[0].insertId);
}

export async function claimRunnerRunForLocalRunner(input: { runId: number; runnerId: number; userId: number; runnerType: "file" | "browser" }) {
  const db = await requireDb();
  const runnerClass = input.runnerType === "browser" ? "user_browser" : "user_machine";
  const result = await db.update(runnerRuns).set({
    status: "claimed",
    localRunnerId: input.runnerId,
    runnerClass,
    startedAt: new Date(),
  }).where(and(
    eq(runnerRuns.id, input.runId),
    eq(runnerRuns.userId, input.userId),
    eq(runnerRuns.provider, "local"),
    eq(runnerRuns.status, "claimable"),
    isNull(runnerRuns.localRunnerId),
  ));
  const affectedRows = Number((result as unknown as [{ affectedRows?: number; changedRows?: number }])?.[0]?.affectedRows ?? (result as unknown as { rowCount?: number })?.rowCount ?? 0);
  if (affectedRows < 1) return null;
  return getRunnerRun(input.runId);
}

export async function getRunnerRun(runId: number) {
  const db = await requireDb();
  return (await db.select().from(runnerRuns).where(eq(runnerRuns.id, runId)).limit(1))[0] ?? null;
}

export async function updateRunnerRun(runId: number, status: RunnerRunStatus, extras?: { githubWorkflowRunId?: string; githubWorkflowRunUrl?: string; errorMessage?: string }) {
  const db = await requireDb();
  const terminal = status === "completed" || status === "failed" || status === "cancelled";
  await db.update(runnerRuns).set({
    status,
    ...(extras?.githubWorkflowRunId ? { githubWorkflowRunId: extras.githubWorkflowRunId } : {}),
    ...(extras?.githubWorkflowRunUrl ? { githubWorkflowRunUrl: extras.githubWorkflowRunUrl } : {}),
    ...(extras?.errorMessage ? { errorMessage: extras.errorMessage } : {}),
    ...(status === "dispatching" ? { dispatchedAt: new Date() } : {}),
    ...(status === "running" ? { startedAt: new Date() } : {}),
    ...(terminal ? { endedAt: new Date() } : {}),
  }).where(eq(runnerRuns.id, runId));
}

export async function appendRunnerEvent(runId: number, taskId: number, event: RunnerEventInput) {
  const db = await requireDb();
  const existing = (await db.select().from(runnerEvents).where(and(eq(runnerEvents.runId, runId), eq(runnerEvents.eventSeq, event.eventSeq))).limit(1))[0];
  if (existing) return { event: existing, duplicate: true };
  const result = await db.insert(runnerEvents).values({
    runId,
    taskId,
    eventSeq: event.eventSeq,
    source: event.source,
    type: event.type.slice(0, 96),
    status: event.status.slice(0, 48),
    detail: event.detail,
    dataJson: event.data ? JSON.stringify(event.data) : null,
  });
  const created = (await db.select().from(runnerEvents).where(eq(runnerEvents.id, Number(result[0].insertId))).limit(1))[0];
  return { event: created, duplicate: false };
}

export async function getLastRunnerEventSequence(runId: number) {
  const db = await requireDb();
  const result = await db.select({ sequence: max(runnerEvents.eventSeq) }).from(runnerEvents).where(eq(runnerEvents.runId, runId));
  return result[0]?.sequence ?? 0;
}

export async function addAttachment(input: { taskId: number; userId: number; originalName: string; mimeType: string; fileSize: number; source: "cloud_upload" | "local_reference"; storageKey?: string | null; storageUrl?: string | null; localRelativePath?: string | null }) {
  const db = await requireDb();
  await db.insert(taskAttachments).values(input);
}

export async function getAttachmentForUser(userId: number, attachmentId: number) {
  const db = await requireDb();
  return (await db.select().from(taskAttachments).where(and(eq(taskAttachments.id, attachmentId), eq(taskAttachments.userId, userId))).limit(1))[0] ?? null;
}

export async function createLocalRunner(userId: number, label: string, tokenHash: string, runnerType: "file" | "browser" = "file") {
  const db = await requireDb();
  const result = await db.insert(localRunners).values({ userId, label, tokenHash, runnerType, allowedSensitiveActionsJson: JSON.stringify(["file_mutation", "external_sharing", "command_execution", "browser_control"]), status: "offline" });
  const runnerId = Number(result[0].insertId);
  await recordLocalRunnerAudit({ userId, runnerId, eventType: "runner.registered", detail: `Registered ${runnerType === "browser" ? "Local Browser Runner" : "Local Runner"} “${label}”.`, metadata: { runnerType } });
  return runnerId;
}

export async function getLocalRunnerForUser(userId: number, runnerId: number) {
  const db = await requireDb();
  return (await db.select().from(localRunners).where(and(eq(localRunners.id, runnerId), eq(localRunners.userId, userId))).limit(1))[0] ?? null;
}

export async function getLocalRunnerByTokenHash(tokenHash: string) {
  const db = await requireDb();
  return (await db.select().from(localRunners).where(eq(localRunners.tokenHash, tokenHash)).limit(1))[0] ?? null;
}

/** Atomically consumes a nonce for a signed Local Runner request. */
export async function consumeLocalRunnerRequestNonce(runnerId: number, nonce: string, expiresAt: Date) {
  const db = await requireDb();
  await db.delete(localRunnerRequestNonces).where(lte(localRunnerRequestNonces.expiresAt, new Date()));
  try {
    await db.insert(localRunnerRequestNonces).values({ runnerId, nonce, expiresAt });
    return true;
  } catch (error) {
    if (error instanceof Error && /duplicate|ER_DUP_ENTRY/i.test(error.message)) return false;
    throw error;
  }
}

export async function listLocalRunners(userId: number) {
  const db = await requireDb();
  return db.select().from(localRunners).where(eq(localRunners.userId, userId)).orderBy(desc(localRunners.updatedAt));
}

export async function recordLocalRunnerAudit(input: { userId: number; runnerId?: number | null; taskId?: number | null; approvalId?: number | null; eventType: string; detail: string; metadata?: Record<string, unknown> }) {
  const db = await requireDb();
  await db.insert(localRunnerAuditEvents).values({
    userId: input.userId,
    runnerId: input.runnerId ?? null,
    taskId: input.taskId ?? null,
    approvalId: input.approvalId ?? null,
    eventType: input.eventType.slice(0, 80),
    detail: input.detail,
    metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
  });
}

export async function listLocalRunnerAudit(userId: number, filters: { runnerId?: number; eventType?: string; startAt?: Date; endAt?: Date; limit?: number } = {}) {
  const db = await requireDb();
  const conditions = [eq(localRunnerAuditEvents.userId, userId)];
  if (filters.runnerId) conditions.push(eq(localRunnerAuditEvents.runnerId, filters.runnerId));
  if (filters.eventType) conditions.push(eq(localRunnerAuditEvents.eventType, filters.eventType));
  if (filters.startAt) conditions.push(gte(localRunnerAuditEvents.createdAt, filters.startAt));
  if (filters.endAt) conditions.push(lte(localRunnerAuditEvents.createdAt, filters.endAt));
  return db.select().from(localRunnerAuditEvents).where(and(...conditions)).orderBy(desc(localRunnerAuditEvents.createdAt)).limit(Math.min(filters.limit ?? 100, 500));
}

export async function listPendingLocalApprovals(userId: number, limit = 12) {
  const db = await requireDb();
  const approvals = await db.select().from(localTaskApprovals).where(and(eq(localTaskApprovals.userId, userId), eq(localTaskApprovals.status, "pending"), gte(localTaskApprovals.expiresAt, new Date()))).orderBy(asc(localTaskApprovals.expiresAt)).limit(limit);
  return Promise.all(approvals.map(async approval => {
    const task = (await db.select().from(agentTasks).where(and(eq(agentTasks.id, approval.taskId), eq(agentTasks.userId, userId))).limit(1))[0] ?? null;
    return { ...approval, taskTitle: task?.title ?? `Task #${approval.taskId}` };
  }));
}

export async function listLocalAuditFilterPresets(userId: number) {
  const db = await requireDb();
  return db.select().from(localAuditFilterPresets).where(eq(localAuditFilterPresets.userId, userId)).orderBy(desc(localAuditFilterPresets.updatedAt));
}

export async function saveLocalAuditFilterPreset(userId: number, label: string, filters: Record<string, unknown>) {
  const db = await requireDb();
  const existing = (await db.select().from(localAuditFilterPresets).where(and(eq(localAuditFilterPresets.userId, userId), eq(localAuditFilterPresets.label, label))).limit(1))[0];
  const filterJson = JSON.stringify(filters);
  if (existing) await db.update(localAuditFilterPresets).set({ filterJson }).where(eq(localAuditFilterPresets.id, existing.id));
  else await db.insert(localAuditFilterPresets).values({ userId, label, filterJson });
  await recordLocalRunnerAudit({ userId, eventType: "audit.preset_saved", detail: `Saved audit filter preset “${label}”.`, metadata: { label, filters } });
  return listLocalAuditFilterPresets(userId);
}

export async function deleteLocalAuditFilterPreset(userId: number, presetId: number) {
  const db = await requireDb();
  const preset = (await db.select().from(localAuditFilterPresets).where(and(eq(localAuditFilterPresets.id, presetId), eq(localAuditFilterPresets.userId, userId))).limit(1))[0];
  if (!preset) return false;
  await db.delete(localAuditFilterPresets).where(and(eq(localAuditFilterPresets.id, presetId), eq(localAuditFilterPresets.userId, userId)));
  await recordLocalRunnerAudit({ userId, eventType: "audit.preset_deleted", detail: `Deleted audit filter preset “${preset.label}”.`, metadata: { presetId } });
  return true;
}

const AUDIT_EXPORT_COLUMNS = ["timestamp", "event_type", "device", "runner_id", "task_id", "approval_id", "detail", "metadata"] as const;

function normalizeAuditExportColumns(columns: string[]) {
  const selected = new Set(columns);
  const normalized = AUDIT_EXPORT_COLUMNS.filter(column => selected.has(column));
  if (!normalized.length) throw new Error("Select at least one audit export column.");
  return normalized;
}

export async function listLocalAuditExportTemplates(userId: number, runnerId?: number) {
  const db = await requireDb();
  const conditions = [eq(localAuditExportTemplates.userId, userId)];
  if (runnerId) conditions.push(eq(localAuditExportTemplates.runnerId, runnerId));
  return db.select().from(localAuditExportTemplates).where(and(...conditions)).orderBy(desc(localAuditExportTemplates.updatedAt));
}

export async function saveLocalAuditExportTemplate(userId: number, runnerId: number, label: string, columns: string[]) {
  const db = await requireDb();
  const runner = (await db.select().from(localRunners).where(and(eq(localRunners.id, runnerId), eq(localRunners.userId, userId))).limit(1))[0];
  if (!runner) throw new Error("Local Runner device not found.");
  const columnsJson = JSON.stringify(normalizeAuditExportColumns(columns));
  const existing = (await db.select().from(localAuditExportTemplates).where(and(eq(localAuditExportTemplates.userId, userId), eq(localAuditExportTemplates.runnerId, runnerId), eq(localAuditExportTemplates.label, label))).limit(1))[0];
  if (existing) await db.update(localAuditExportTemplates).set({ columnsJson }).where(eq(localAuditExportTemplates.id, existing.id));
  else await db.insert(localAuditExportTemplates).values({ userId, runnerId, label, columnsJson });
  await recordLocalRunnerAudit({ userId, runnerId, eventType: "audit.export_template_saved", detail: `Saved CSV export template “${label}” for ${runner.label}.`, metadata: { label, columns: JSON.parse(columnsJson) } });
  return listLocalAuditExportTemplates(userId, runnerId);
}

export async function deleteLocalAuditExportTemplate(userId: number, templateId: number) {
  const db = await requireDb();
  const template = (await db.select().from(localAuditExportTemplates).where(and(eq(localAuditExportTemplates.id, templateId), eq(localAuditExportTemplates.userId, userId))).limit(1))[0];
  if (!template) return false;
  await db.delete(localAuditExportTemplates).where(and(eq(localAuditExportTemplates.id, templateId), eq(localAuditExportTemplates.userId, userId)));
  await recordLocalRunnerAudit({ userId, runnerId: template.runnerId, eventType: "audit.export_template_deleted", detail: `Deleted CSV export template “${template.label}”.`, metadata: { templateId } });
  return true;
}

export async function getLocalApprovalSettings(userId: number) {
  const db = await requireDb();
  return (await db.select().from(localApprovalSettings).where(eq(localApprovalSettings.userId, userId)).limit(1))[0] ?? { userId, expiryMinutes: 15 };
}

export async function setLocalApprovalExpiry(userId: number, expiryMinutes: number) {
  const db = await requireDb();
  const existing = await db.select().from(localApprovalSettings).where(eq(localApprovalSettings.userId, userId)).limit(1);
  if (existing[0]) await db.update(localApprovalSettings).set({ expiryMinutes }).where(eq(localApprovalSettings.id, existing[0].id));
  else await db.insert(localApprovalSettings).values({ userId, expiryMinutes });
  await recordLocalRunnerAudit({ userId, eventType: "approval.expiry_configured", detail: `Set the Local Runner approval timeout to ${expiryMinutes} minutes.`, metadata: { expiryMinutes } });
  return getLocalApprovalSettings(userId);
}

export async function setLocalRunnerApprovalExpiryOverride(userId: number, runnerId: number, expiryMinutes: number | null) {
  const db = await requireDb();
  await db.update(localRunners).set({ approvalExpiryOverrideMinutes: expiryMinutes }).where(and(eq(localRunners.id, runnerId), eq(localRunners.userId, userId)));
  await recordLocalRunnerAudit({ userId, runnerId, eventType: "runner.approval_timeout_override", detail: expiryMinutes === null ? "Cleared this device’s approval timeout override; Palm will use the workspace default." : `Set this device’s approval timeout override to ${expiryMinutes} minutes.`, metadata: { expiryMinutes } });
  return getLocalRunnerForUser(userId, runnerId);
}

export async function resolveLocalApprovalExpiryMinutes(userId: number, runnerId?: number) {
  const settings = await getLocalApprovalSettings(userId);
  if (!runnerId) return settings.expiryMinutes;
  const runner = await getLocalRunnerForUser(userId, runnerId);
  return runner?.approvalExpiryOverrideMinutes ?? settings.expiryMinutes;
}

export async function updateLocalRunnerScope(userId: number, runnerId: number, input: { allowedTools: string[]; allowedSkillSlugs: string[]; allowedSensitiveActions: string[]; allowedBrowserTools: string[]; navigationAllowlist: string[]; requiresApprovalForSensitive: boolean; requiresApprovalForBrowserWrites: boolean }) {
  const db = await requireDb();
  await db.update(localRunners).set({ allowedToolsJson: JSON.stringify(input.allowedTools), allowedSkillSlugsJson: JSON.stringify(input.allowedSkillSlugs), allowedSensitiveActionsJson: JSON.stringify(input.allowedSensitiveActions), allowedBrowserToolsJson: JSON.stringify(input.allowedBrowserTools), navigationAllowlistJson: JSON.stringify(input.navigationAllowlist), requiresApprovalForSensitive: input.requiresApprovalForSensitive, requiresApprovalForBrowserWrites: input.requiresApprovalForBrowserWrites }).where(and(eq(localRunners.id, runnerId), eq(localRunners.userId, userId)));
  await recordLocalRunnerAudit({ userId, runnerId, eventType: "runner.scope_updated", detail: "Updated this device’s permitted local tools and sensitive-action control.", metadata: input });
  return getLocalRunnerForUser(userId, runnerId);
}

export async function getLocalRunnerDashboard(userId: number) {
  const [runners, activity, approvalSettings] = await Promise.all([listLocalRunners(userId), listLocalRunnerAudit(userId, { limit: 40 }), getLocalApprovalSettings(userId)]);
  const now = Date.now();
  return {
    runners: runners.map(runner => ({ ...runner, connectionStatus: runner.status === "revoked" ? "revoked" : runner.lastSeenAt && now - runner.lastSeenAt.getTime() < 45_000 ? "online" : "offline" })),
    activity,
    approvalSettings,
  };
}

export async function touchLocalRunner(runnerId: number, status: "online" | "offline" | "revoked" = "online") {
  const db = await requireDb();
  await db.update(localRunners).set({ status, ...(status === "online" ? { lastSeenAt: new Date() } : {}) }).where(eq(localRunners.id, runnerId));
  if (status === "online") {
    const runner = (await db.select().from(localRunners).where(eq(localRunners.id, runnerId)).limit(1))[0];
    if (runner) await recordLocalRunnerAudit({ userId: runner.userId, runnerId, eventType: "runner.heartbeat", detail: `Local Runner “${runner.label}” reported that it is online.` });
  }
}

export async function renameLocalRunner(userId: number, runnerId: number, label: string) {
  const db = await requireDb();
  await db.update(localRunners).set({ label }).where(and(eq(localRunners.id, runnerId), eq(localRunners.userId, userId)));
  await recordLocalRunnerAudit({ userId, runnerId, eventType: "runner.renamed", detail: `Renamed Local Runner to “${label}”.` });
}

export async function revokeLocalRunner(userId: number, runnerId: number) {
  const db = await requireDb();
  await db.update(localRunners).set({ status: "revoked" }).where(and(eq(localRunners.id, runnerId), eq(localRunners.userId, userId)));
  await recordLocalRunnerAudit({ userId, runnerId, eventType: "runner.revoked", detail: "Revoked this Local Runner device and its token." });
}

export async function getLocalTaskApproval(userId: number, taskId: number) {
  const db = await requireDb();
  const approval = (await db.select().from(localTaskApprovals).where(and(eq(localTaskApprovals.taskId, taskId), eq(localTaskApprovals.userId, userId))).limit(1))[0] ?? null;
  if (!approval || approval.status !== "pending" || !approval.expiresAt || approval.expiresAt.getTime() > Date.now()) return approval;
  const decidedAt = new Date();
  await db.update(localTaskApprovals).set({ status: "expired", decidedAt }).where(eq(localTaskApprovals.id, approval.id));
  await recordLocalRunnerAudit({ userId, taskId, approvalId: approval.id, eventType: "approval.expired", detail: "A pending Local Runner approval expired before it was decided.", metadata: { expiresAt: approval.expiresAt.toISOString() } });
  return { ...approval, status: "expired" as const, decidedAt };
}

export async function createPendingLocalTaskApproval(userId: number, taskId: number, policy: unknown, runnerId?: number) {
  const db = await requireDb();
  const existing = await getLocalTaskApproval(userId, taskId);
  if (existing) return existing;
  const expiryMinutes = await resolveLocalApprovalExpiryMinutes(userId, runnerId);
  const expiresAt = new Date(Date.now() + expiryMinutes * 60_000);
  const result = await db.insert(localTaskApprovals).values({ userId, taskId, status: "pending", policyJson: JSON.stringify(policy), expiresAt });
  const approvalId = Number(result[0].insertId);
  await recordLocalRunnerAudit({ userId, runnerId, taskId, approvalId, eventType: "approval.requested", detail: `Requested explicit approval for a sensitive Local Runner action; it expires in ${expiryMinutes} minutes.`, metadata: { expiresAt: expiresAt.toISOString(), expiryMinutes, policy } });
  return (await db.select().from(localTaskApprovals).where(eq(localTaskApprovals.id, approvalId)).limit(1))[0];
}

export async function decideLocalTaskApproval(userId: number, taskId: number, status: "approved" | "rejected") {
  const db = await requireDb();
  const existing = await getLocalTaskApproval(userId, taskId);
  if (!existing || existing.status !== "pending") return existing;
  const decidedAt = new Date();
  await db.update(localTaskApprovals).set({ status, decidedAt }).where(eq(localTaskApprovals.id, existing.id));
  await recordLocalRunnerAudit({ userId, taskId, approvalId: existing.id, eventType: `approval.${status}`, detail: `The owner ${status} this sensitive Local Runner action.` });
  return { ...existing, status, decidedAt };
}

export async function listQueuedTasksForLocalRunner(userId: number, runnerType: "file" | "browser" = "file") {
  const db = await requireDb();
  const executionTargets = runnerType === "browser" ? ["local_browser"] as const : ["auto", "local_file"] as const;
  const queued = await db.select().from(agentTasks).where(and(eq(agentTasks.userId, userId), eq(agentTasks.status, "queued"))).orderBy(asc(agentTasks.createdAt)).limit(25);
  return queued.filter(task => (executionTargets as readonly string[]).includes(task.executionTarget));
}

export async function claimQueuedTaskForLocalRunner(userId: number, taskId?: number) {
  const db = await requireDb();
  const conditions = [eq(agentTasks.userId, userId), eq(agentTasks.status, "queued")];
  if (taskId) conditions.push(eq(agentTasks.id, taskId));
  const task = (await db.select().from(agentTasks).where(and(...conditions)).orderBy(asc(agentTasks.createdAt)).limit(1))[0] ?? null;
  if (!task) return null;
  await db.update(agentTasks).set({ status: "running" }).where(and(eq(agentTasks.id, task.id), eq(agentTasks.status, "queued")));
  return (await db.select().from(agentTasks).where(eq(agentTasks.id, task.id)).limit(1))[0] ?? null;
}

export async function getSkillCatalog(userId: number) {
  const db = await requireDb();
  const settings = await db.select().from(skillSettings).where(eq(skillSettings.userId, userId));
  return mergeSkillPreferences(settings);
}

export async function setSkillEnabled(userId: number, skillSlug: string, enabled: boolean) {
  const db = await requireDb();
  const existing = (await db.select().from(skillSettings).where(and(eq(skillSettings.userId, userId), eq(skillSettings.skillSlug, skillSlug))).limit(1))[0];
  if (existing) {
    await db.update(skillSettings).set({ enabled }).where(eq(skillSettings.id, existing.id));
  } else {
    await db.insert(skillSettings).values({ userId, skillSlug, enabled });
  }
}

export async function getDashboardSnapshot(userId: number) {
  const allTasks = await listTasks(userId);
  const completed = allTasks.filter(task => task.status === "completed").length;
  const running = allTasks.filter(task => task.status === "running" || task.status === "queued").length;
  const skills = await getSkillCatalog(userId);
  return {
    recentTasks: allTasks.slice(0, 5),
    totals: { tasks: allTasks.length, completed, running, activeSkills: skills.filter(skill => skill.enabled).length },
  };
}
/**
 * Counts per-user runner runs for a provider since the given UTC date.
 * Provides the runtime a persisted usage source for the quota gate.
 */
export async function countProviderRunsSince(
  userId: string, 
  provider: string, 
  sinceUTC: Date
): Promise<number> {
  // Note: Adjust the query syntax below if you are using an ORM like Drizzle or Prisma.
  // This is the raw SQL equivalent for the logic.
  const result = await db.query(
    `SELECT COUNT(*) as count FROM runs 
     WHERE user_id = $1 AND provider = $2 AND created_at >= $3`,
    [userId, provider, sinceUTC.toISOString()]
  );

  return parseInt(result[0].count, 10);
}
