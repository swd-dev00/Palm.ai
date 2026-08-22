import { z } from "zod";
import { COOKIE_NAME, getSessionCookieOptions } from "./server/_core/cookies";
import { systemRouter } from "./server/_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./server/_core/trpc";
import {
  addAttachment,
  createProject,
  createTask,
  decideLocalTaskApproval,
  deleteTask,
  getDashboardSnapshot,
  getLocalApprovalSettings,
  getLocalRunnerDashboard,
  getSkillCatalog,
  getTaskDetail,
  deleteLocalAuditExportTemplate,
  deleteLocalAuditFilterPreset,
  listLocalAuditExportTemplates,
  listLocalRunnerAudit,
  listLocalAuditFilterPresets,
  listPendingLocalApprovals,
  listLocalRunners,
  listProjects,
  renameLocalRunner,
  revokeLocalRunner,
  setLocalApprovalExpiry,
  setLocalRunnerApprovalExpiryOverride,
  saveLocalAuditFilterPreset,
  saveLocalAuditExportTemplate,
  listTasks,
  setSkillEnabled,
  updateLocalRunnerScope,
} from "./db";
import { deriveTaskTitle, PALM_SKILLS } from "./palmDomain";
import { storagePut } from "./storage";
import { cancelPalmRun, executePalmAction } from "./runnerRuntime";
import { registerLocalRunner } from "./localRunner";
import { LOCAL_FILE_TOOL_ALLOWLIST, LOCAL_SENSITIVE_ACTION_CLASSES } from "./localPolicy";

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  palm: router({
    dashboard: protectedProcedure.query(({ ctx }) => getDashboardSnapshot(ctx.user.id)),
    projects: protectedProcedure.query(({ ctx }) => listProjects(ctx.user.id)),
    createProject: protectedProcedure.input(z.object({ title: z.string().trim().min(1).max(160), description: z.string().trim().max(1000).optional() }))
      .mutation(({ ctx, input }) => createProject(ctx.user.id, input.title, input.description)),
    tasks: protectedProcedure.query(({ ctx }) => listTasks(ctx.user.id)),
    task: protectedProcedure.input(z.object({ taskId: z.number().int().positive() }))
      .query(({ ctx, input }) => getTaskDetail(ctx.user.id, input.taskId)),
    createTask: protectedProcedure.input(z.object({ projectId: z.number().int().positive().optional(), prompt: z.string().trim().min(2).max(12_000), executionTarget: z.enum(["auto", "local_file", "local_browser"]).optional() }))
      .mutation(async ({ ctx, input }) => {
        const taskId = await createTask({ userId: ctx.user.id, projectId: input.projectId, prompt: input.prompt, title: deriveTaskTitle(input.prompt), executionTarget: input.executionTarget });
        return { taskId };
      }),
    deleteTask: protectedProcedure.input(z.object({ taskId: z.number().int().positive() }))
      .mutation(({ ctx, input }) => deleteTask(ctx.user.id, input.taskId)),
    resumeTask: protectedProcedure.input(z.object({ taskId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const detail = await getTaskDetail(ctx.user.id, input.taskId);
        if (!detail) throw new Error("Task not found");
        const taskId = await createTask({ userId: ctx.user.id, projectId: detail.task.projectId ?? undefined, prompt: detail.task.prompt, title: `Resume — ${detail.task.title}` });
        return { taskId };
      }),
    skills: protectedProcedure.query(({ ctx }) => getSkillCatalog(ctx.user.id)),
    localRunners: protectedProcedure.query(({ ctx }) => listLocalRunners(ctx.user.id)),
    localRunnerDashboard: protectedProcedure.query(({ ctx }) => getLocalRunnerDashboard(ctx.user.id)),
    localRunnerAudit: protectedProcedure.input(z.object({ runnerId: z.number().int().positive().optional(), eventType: z.string().trim().min(1).max(80).optional(), startAt: z.date().optional(), endAt: z.date().optional() }).optional())
      .query(({ ctx, input }) => listLocalRunnerAudit(ctx.user.id, { ...input, limit: 500 })),
    pendingLocalApprovals: protectedProcedure.query(({ ctx }) => listPendingLocalApprovals(ctx.user.id)),
    localAuditFilterPresets: protectedProcedure.query(({ ctx }) => listLocalAuditFilterPresets(ctx.user.id)),
    localAuditExportTemplates: protectedProcedure.input(z.object({ runnerId: z.number().int().positive().optional() }).optional()).query(({ ctx, input }) => listLocalAuditExportTemplates(ctx.user.id, input?.runnerId)),
    localApprovalSettings: protectedProcedure.query(({ ctx }) => getLocalApprovalSettings(ctx.user.id)),
    registerLocalRunner: protectedProcedure.input(z.object({ label: z.string().trim().min(1).max(120), runnerType: z.enum(["file", "browser"]).optional() }))
      .mutation(({ ctx, input }) => registerLocalRunner(ctx.user.id, input.label, input.runnerType)),
    renameLocalRunner: protectedProcedure.input(z.object({ runnerId: z.number().int().positive(), label: z.string().trim().min(1).max(120) }))
      .mutation(async ({ ctx, input }) => { await renameLocalRunner(ctx.user.id, input.runnerId, input.label); return { success: true }; }),
    revokeLocalRunner: protectedProcedure.input(z.object({ runnerId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => { await revokeLocalRunner(ctx.user.id, input.runnerId); return { success: true }; }),
    updateLocalRunnerScope: protectedProcedure.input(z.object({ runnerId: z.number().int().positive(), allowedTools: z.array(z.enum(LOCAL_FILE_TOOL_ALLOWLIST)).min(1), allowedSkillSlugs: z.array(z.enum(PALM_SKILLS.map(skill => skill.slug) as [string, ...string[]])), allowedSensitiveActions: z.array(z.enum(LOCAL_SENSITIVE_ACTION_CLASSES)), allowedBrowserTools: z.array(z.enum(["open_tab", "navigate", "screenshot", "read_page_text", "close_tab", "click_element", "type_text", "submit_form"])).default(["open_tab", "navigate", "screenshot", "read_page_text", "close_tab"]), navigationAllowlist: z.array(z.string().trim().min(1).max(255)).max(50).default([]), requiresApprovalForSensitive: z.boolean(), requiresApprovalForBrowserWrites: z.boolean().default(true) }))
      .mutation(({ ctx, input }) => updateLocalRunnerScope(ctx.user.id, input.runnerId, { allowedTools: input.allowedTools, allowedSkillSlugs: input.allowedSkillSlugs, allowedSensitiveActions: input.allowedSensitiveActions, allowedBrowserTools: input.allowedBrowserTools, navigationAllowlist: input.navigationAllowlist, requiresApprovalForSensitive: input.requiresApprovalForSensitive, requiresApprovalForBrowserWrites: input.requiresApprovalForBrowserWrites })),
    setLocalApprovalExpiry: protectedProcedure.input(z.object({ expiryMinutes: z.number().int().min(1).max(1440) }))
      .mutation(({ ctx, input }) => setLocalApprovalExpiry(ctx.user.id, input.expiryMinutes)),
    setLocalRunnerApprovalExpiryOverride: protectedProcedure.input(z.object({ runnerId: z.number().int().positive(), expiryMinutes: z.number().int().min(1).max(1440).nullable() }))
      .mutation(({ ctx, input }) => setLocalRunnerApprovalExpiryOverride(ctx.user.id, input.runnerId, input.expiryMinutes)),
    saveLocalAuditFilterPreset: protectedProcedure.input(z.object({ label: z.string().trim().min(1).max(80), filters: z.record(z.string(), z.unknown()) }))
      .mutation(({ ctx, input }) => saveLocalAuditFilterPreset(ctx.user.id, input.label, input.filters)),
    deleteLocalAuditFilterPreset: protectedProcedure.input(z.object({ presetId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => ({ success: await deleteLocalAuditFilterPreset(ctx.user.id, input.presetId) })),
    saveLocalAuditExportTemplate: protectedProcedure.input(z.object({ runnerId: z.number().int().positive(), label: z.string().trim().min(1).max(80), columns: z.array(z.enum(["timestamp", "event_type", "device", "runner_id", "task_id", "approval_id", "detail", "metadata"])) .min(1) }))
      .mutation(({ ctx, input }) => saveLocalAuditExportTemplate(ctx.user.id, input.runnerId, input.label, input.columns)),
    deleteLocalAuditExportTemplate: protectedProcedure.input(z.object({ templateId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => ({ success: await deleteLocalAuditExportTemplate(ctx.user.id, input.templateId) })),
    decideLocalApproval: protectedProcedure.input(z.object({ taskId: z.number().int().positive(), decision: z.enum(["approved", "rejected"]) }))
      .mutation(({ ctx, input }) => decideLocalTaskApproval(ctx.user.id, input.taskId, input.decision)),
    setSkill: protectedProcedure.input(z.object({ skillSlug: z.enum(PALM_SKILLS.map(skill => skill.slug) as [string, ...string[]]), enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await setSkillEnabled(ctx.user.id, input.skillSlug, input.enabled);
        return { success: true };
      }),
    uploadAttachment: protectedProcedure.input(z.object({
      taskId: z.number().int().positive(),
      name: z.string().trim().min(1).max(255),
      mimeType: z.string().trim().min(1).max(120),
      data: z.string().min(1),
    })).mutation(async ({ ctx, input }) => {
      const task = await getTaskDetail(ctx.user.id, input.taskId);
      if (!task) throw new Error("Task not found");
      const data = Buffer.from(input.data, "base64");
      if (data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("Attachments must be 5 MB or smaller.");
      const safeName = input.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const stored = await storagePut(`palm-ai/${ctx.user.id}/${input.taskId}/${safeName}`, data, input.mimeType);
      await addAttachment({
        taskId: input.taskId,
        userId: ctx.user.id,
        originalName: input.name,
        mimeType: input.mimeType,
        fileSize: data.byteLength,
        source: "cloud_upload",
        storageKey: stored.key,
        storageUrl: stored.url,
      });
      return { name: input.name, url: stored.url };
    }),
    referenceLocalAttachment: protectedProcedure.input(z.object({
      taskId: z.number().int().positive(),
      name: z.string().trim().min(1).max(255),
      mimeType: z.string().trim().min(1).max(120),
      fileSize: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
      localRelativePath: z.string().trim().min(1).max(255).refine(value => !value.includes("/") && !value.includes("\\") && value !== "." && value !== "..", "Use a filename located directly inside PALM_INPUT_DIR."),
    })).mutation(async ({ ctx, input }) => {
      const task = await getTaskDetail(ctx.user.id, input.taskId);
      if (!task) throw new Error("Task not found");
      if (input.localRelativePath !== input.name) throw new Error("The local attachment reference must match its filename.");
      await addAttachment({ taskId: input.taskId, userId: ctx.user.id, originalName: input.name, mimeType: input.mimeType, fileSize: input.fileSize, source: "local_reference", localRelativePath: input.localRelativePath });
      return { name: input.name, source: "local_reference" as const };
    }),
    executeTask: protectedProcedure.input(z.object({ taskId: z.number().int().positive() }))
      .mutation(({ ctx, input }) => executePalmAction({ taskId: input.taskId, userId: ctx.user.id })),
    cancelTask: protectedProcedure.input(z.object({ taskId: z.number().int().positive() }))
      .mutation(({ ctx, input }) => cancelPalmRun({ taskId: input.taskId, userId: ctx.user.id })),
  }),
});

export type AppRouter = typeof appRouter;
