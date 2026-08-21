import { boolean, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  description: text("description"),
  accent: varchar("accent", { length: 24 }).default("indigo").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("projects_user_created_idx").on(table.userId, table.createdAt)]);

export const agentTasks = mysqlTable("agent_tasks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId"),
  title: varchar("title", { length: 180 }).notNull(),
  prompt: text("prompt").notNull(),
  executionTarget: mysqlEnum("executionTarget", ["auto", "local_file", "local_browser"]).default("auto").notNull(),
  status: mysqlEnum("status", ["queued", "running", "completed", "error"]).default("queued").notNull(),
  assistantResponse: text("assistantResponse"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => [
  index("agent_tasks_user_updated_idx").on(table.userId, table.updatedAt),
  index("agent_tasks_project_updated_idx").on(table.projectId, table.updatedAt),
]);

export const taskMessages = mysqlTable("task_messages", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("task_messages_task_created_idx").on(table.taskId, table.createdAt)]);

export const executionSteps = mysqlTable("execution_steps", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  stepOrder: int("stepOrder").notNull(),
  kind: mysqlEnum("kind", ["plan", "tool", "decision", "result"]).notNull(),
  status: mysqlEnum("status", ["pending", "running", "completed", "error"]).default("pending").notNull(),
  label: varchar("label", { length: 180 }).notNull(),
  detail: text("detail"),
  toolName: varchar("toolName", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("execution_steps_task_order_idx").on(table.taskId, table.stepOrder)]);

export const skillSettings = mysqlTable("skill_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  skillSlug: varchar("skillSlug", { length: 80 }).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("skill_settings_user_slug_idx").on(table.userId, table.skillSlug)]);

export const taskAttachments = mysqlTable("task_attachments", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  userId: int("userId").notNull(),
  originalName: varchar("originalName", { length: 255 }).notNull(),
  mimeType: varchar("mimeType", { length: 120 }).notNull(),
  fileSize: int("fileSize").notNull(),
  source: mysqlEnum("source", ["cloud_upload", "local_reference"]).default("cloud_upload").notNull(),
  storageKey: varchar("storageKey", { length: 512 }),
  storageUrl: varchar("storageUrl", { length: 512 }),
  localRelativePath: varchar("localRelativePath", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("task_attachments_task_idx").on(table.taskId)]);

export const runnerRuns = mysqlTable("runner_runs", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  provider: mysqlEnum("provider", ["local", "github_actions"]).notNull(),
  runnerClass: varchar("runnerClass", { length: 64 }).default("standard").notNull(),
  status: mysqlEnum("status", ["queued", "dispatching", "provisioning", "running", "collecting", "completed", "failed", "cancellation_requested", "cancelled"]).default("queued").notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
  githubWorkflowRunId: varchar("githubWorkflowRunId", { length: 32 }),
  githubWorkflowRunUrl: varchar("githubWorkflowRunUrl", { length: 512 }),
  policyJson: text("policyJson"),
  errorMessage: text("errorMessage"),
  dispatchedAt: timestamp("dispatchedAt"),
  startedAt: timestamp("startedAt"),
  endedAt: timestamp("endedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("runner_runs_idempotency_idx").on(table.idempotencyKey),
  index("runner_runs_task_created_idx").on(table.taskId, table.createdAt),
  index("runner_runs_github_workflow_idx").on(table.githubWorkflowRunId),
]);

export const runnerEvents = mysqlTable("runner_events", {
  id: int("id").autoincrement().primaryKey(),
  runId: int("runId").notNull(),
  taskId: int("taskId").notNull(),
  eventSeq: int("eventSeq").notNull(),
  source: mysqlEnum("source", ["control_plane", "github_actions", "runner", "artifact_store"]).notNull(),
  type: varchar("type", { length: 96 }).notNull(),
  status: varchar("status", { length: 48 }).notNull(),
  detail: text("detail").notNull(),
  dataJson: text("dataJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("runner_events_run_sequence_idx").on(table.runId, table.eventSeq),
  index("runner_events_task_created_idx").on(table.taskId, table.createdAt),
]);

export const localRunners = mysqlTable("local_runners", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  label: varchar("label", { length: 120 }).notNull(),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull(),
  runnerType: mysqlEnum("runnerType", ["file", "browser"]).default("file").notNull(),
  status: mysqlEnum("status", ["offline", "online", "revoked"]).default("offline").notNull(),
  allowedToolsJson: varchar("allowedToolsJson", { length: 512 }).notNull().default("[\"inventory_files\",\"extract_text_metadata\",\"profile_csv\",\"write_result_record\"]"),
  allowedSkillSlugsJson: varchar("allowedSkillSlugsJson", { length: 512 }).notNull().default("[\"web-research\",\"document-intelligence\",\"code-workspace\",\"data-analysis\",\"visual-creation\",\"workflow-automation\"]"),
  allowedSensitiveActionsJson: varchar("allowedSensitiveActionsJson", { length: 256 }).notNull().default("[\"file_mutation\",\"external_sharing\",\"command_execution\"]"),
  allowedBrowserToolsJson: varchar("allowedBrowserToolsJson", { length: 512 }).notNull().default("[\"open_tab\",\"navigate\",\"screenshot\",\"read_page_text\",\"close_tab\"]"),
  navigationAllowlistJson: varchar("navigationAllowlistJson", { length: 1024 }).notNull().default("[]"),
  requiresApprovalForSensitive: boolean("requiresApprovalForSensitive").default(true).notNull(),
  requiresApprovalForBrowserWrites: boolean("requiresApprovalForBrowserWrites").default(true).notNull(),
  approvalExpiryOverrideMinutes: int("approvalExpiryOverrideMinutes"),
  lastSeenAt: timestamp("lastSeenAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("local_runners_token_hash_idx").on(table.tokenHash),
  index("local_runners_user_updated_idx").on(table.userId, table.updatedAt),
]);

export const localTaskApprovals = mysqlTable("local_task_approvals", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  userId: int("userId").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "expired"]).default("pending").notNull(),
  policyJson: text("policyJson").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  decidedAt: timestamp("decidedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("local_task_approvals_task_idx").on(table.taskId),
  index("local_task_approvals_user_updated_idx").on(table.userId, table.updatedAt),
  index("local_task_approvals_expiry_idx").on(table.status, table.expiresAt),
]);

export const localApprovalSettings = mysqlTable("local_approval_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  expiryMinutes: int("expiryMinutes").default(15).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("local_approval_settings_user_idx").on(table.userId),
]);

export const localRunnerAuditEvents = mysqlTable("local_runner_audit_events", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  runnerId: int("runnerId"),
  taskId: int("taskId"),
  approvalId: int("approvalId"),
  eventType: varchar("eventType", { length: 80 }).notNull(),
  detail: text("detail").notNull(),
  metadataJson: text("metadataJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("local_runner_audit_user_created_idx").on(table.userId, table.createdAt),
  index("local_runner_audit_runner_created_idx").on(table.runnerId, table.createdAt),
  index("local_runner_audit_task_created_idx").on(table.taskId, table.createdAt),
]);

export const localAuditFilterPresets = mysqlTable("local_audit_filter_presets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  label: varchar("label", { length: 80 }).notNull(),
  filterJson: text("filterJson").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("local_audit_filter_presets_user_label_idx").on(table.userId, table.label),
  index("local_audit_filter_presets_user_updated_idx").on(table.userId, table.updatedAt),
]);

export const localAuditExportTemplates = mysqlTable("local_audit_export_templates", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  runnerId: int("runnerId").notNull(),
  label: varchar("label", { length: 80 }).notNull(),
  columnsJson: text("columnsJson").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("local_audit_export_templates_user_runner_label_idx").on(table.userId, table.runnerId, table.label),
  index("local_audit_export_templates_user_runner_updated_idx").on(table.userId, table.runnerId, table.updatedAt),
]);

export type Project = typeof projects.$inferSelect;
export type AgentTask = typeof agentTasks.$inferSelect;
export type TaskMessage = typeof taskMessages.$inferSelect;
export type ExecutionStep = typeof executionSteps.$inferSelect;
export type SkillSetting = typeof skillSettings.$inferSelect;
export type TaskAttachment = typeof taskAttachments.$inferSelect;
export type RunnerRun = typeof runnerRuns.$inferSelect;
export type RunnerEvent = typeof runnerEvents.$inferSelect;
export type LocalRunner = typeof localRunners.$inferSelect;
export type LocalTaskApproval = typeof localTaskApprovals.$inferSelect;
export type LocalApprovalSettings = typeof localApprovalSettings.$inferSelect;
export type LocalRunnerAuditEvent = typeof localRunnerAuditEvents.$inferSelect;
export type LocalAuditFilterPreset = typeof localAuditFilterPresets.$inferSelect;
export type LocalAuditExportTemplate = typeof localAuditExportTemplates.$inferSelect;
