import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  addAssistantMessage,
  appendRunnerEvent,
  claimQueuedTaskForLocalRunner,
  createPendingLocalTaskApproval,
  createLocalRunner,
  getLocalTaskApproval,
  createRunnerRun,
  consumeLocalRunnerRequestNonce,
  getLastRunnerEventSequence,
  getLocalRunnerByTokenHash,
  getLocalRunnerForUser,
  getRunnerRun,
  getSkillCatalog,
  getTaskDetail,
  listQueuedTasksForLocalRunner,
  recordLocalRunnerAudit,
  touchLocalRunner,
  updateExecutionStep,
  updateRunnerRun,
  updateTaskStatus,
} from "./db";
import { getLocalActionPolicy, LOCAL_BROWSER_ALL_TOOLS, LOCAL_BROWSER_TOOL_ALLOWLIST, LOCAL_BROWSER_WRITE_TOOLS, LOCAL_FILE_TOOL_ALLOWLIST, type LocalBrowserTool, type LocalFileTool, type LocalRunnerType } from "./localPolicy";

const eventSchema = z.object({
  eventSeq: z.number().int().positive(),
  type: z.string().min(1).max(96),
  status: z.enum(["running", "collecting", "completed", "failed", "cancelled"]),
  detail: z.string().min(1).max(8_000),
  data: z.record(z.string(), z.unknown()).optional(),
});

const browserApprovalSchema = z.object({
  tool: z.enum(LOCAL_BROWSER_ALL_TOOLS),
  url: z.string().url().max(2_000).optional(),
  targetSummary: z.string().trim().min(1).max(240).optional(),
});

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function registerLocalRunner(userId: number, label: string, runnerType: LocalRunnerType = "file") {
  const token = `palm_local_${randomBytes(24).toString("base64url")}`;
  const runnerId = await createLocalRunner(userId, label.trim().slice(0, 120) || (runnerType === "browser" ? "My local browser runner" : "My local runner"), hash(token), runnerType);
  return { runnerId, token };
}

export async function authenticateLocalRunner(token: string) {
  const runner = await getLocalRunnerByTokenHash(hash(token));
  if (!runner || runner.status === "revoked") throw new Error("The local runner token is not recognized or was revoked.");
  await touchLocalRunner(runner.id, "online");
  return runner;
}

export type LocalRunnerRequestAuth = {
  token: string;
  method: string;
  path: string;
  rawBody: Buffer;
  timestamp: string | undefined;
  nonce: string | undefined;
  signature: string | undefined;
};

const SIGNED_REQUEST_WINDOW_MS = 60_000;
const noncePattern = /^[A-Za-z0-9_-]{22,96}$/;
const signaturePattern = /^[a-f0-9]{64}$/i;

function signatureMatches(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

/**
 * Authenticates a Local Runner HTTP request. TLS protects the channel, while
 * the HMAC binds method, path, body, freshness, and one-time nonce so a
 * proxy/log replay cannot repeat an authenticated local action.
 */
export async function authenticateSignedLocalRunnerRequest(input: LocalRunnerRequestAuth) {
  const timestamp = Number(input.timestamp);
  const now = Date.now();
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > SIGNED_REQUEST_WINDOW_MS) {
    throw new Error("The Local Runner request timestamp is expired or invalid.");
  }
  if (!input.nonce || !noncePattern.test(input.nonce)) throw new Error("The Local Runner request nonce is invalid.");
  if (!input.signature || !signaturePattern.test(input.signature)) throw new Error("The Local Runner request signature is invalid.");

  const runner = await authenticateLocalRunner(input.token);
  const bodyHash = hash(input.rawBody.toString("utf8"));
  const signatureBase = `v1\n${input.method.toUpperCase()}\n${input.path}\n${timestamp}\n${input.nonce}\n${bodyHash}`;
  const expected = createHmac("sha256", input.token).update(signatureBase).digest("hex");
  if (!signatureMatches(input.signature, expected)) throw new Error("The Local Runner request signature is invalid.");

  const nonceAccepted = await consumeLocalRunnerRequestNonce(runner.id, input.nonce, new Date(timestamp + SIGNED_REQUEST_WINDOW_MS));
  if (!nonceAccepted) throw new Error("The Local Runner request was already processed.");
  return runner;
}

export async function claimLocalTask(token: string) {
  return claimLocalTaskForRunner(await authenticateLocalRunner(token));
}

export async function claimLocalTaskForRunner(runner: Awaited<ReturnType<typeof authenticateLocalRunner>>) {
  const runnerType: LocalRunnerType = runner.runnerType === "browser" ? "browser" : "file";
  const configuredTools = (() => {
    try {
      const parsed = JSON.parse(runner.allowedToolsJson) as string[];
      return LOCAL_FILE_TOOL_ALLOWLIST.filter(tool => parsed.includes(tool));
    } catch { return [...LOCAL_FILE_TOOL_ALLOWLIST]; }
  })();
  const configuredSkillSlugs = (() => {
    try { return new Set(JSON.parse(runner.allowedSkillSlugsJson) as string[]); }
    catch { return null; }
  })();
  const configuredSensitiveActions = (() => {
    try { return new Set(JSON.parse(runner.allowedSensitiveActionsJson) as string[]); }
    catch { return new Set(["file_mutation", "external_sharing", "command_execution", "browser_control"]); }
  })();
  const configuredBrowserTools = (() => {
    try {
      const parsed = JSON.parse(runner.allowedBrowserToolsJson) as string[];
      return LOCAL_BROWSER_ALL_TOOLS.filter(tool => parsed.includes(tool));
    } catch { return [...LOCAL_BROWSER_TOOL_ALLOWLIST]; }
  })();
  const navigationAllowlist = (() => {
    try { return (JSON.parse(runner.navigationAllowlistJson) as string[]).filter(value => typeof value === "string" && value.length > 0).slice(0, 50); }
    catch { return []; }
  })();
  if (runnerType === "file" && !configuredTools.includes("write_result_record")) {
    return { scopeRestricted: true, reason: "This Local Runner does not permit the required result-record tool.", allowedTools: configuredTools };
  }
  if (runnerType === "browser" && !configuredBrowserTools.some(tool => LOCAL_BROWSER_TOOL_ALLOWLIST.includes(tool as typeof LOCAL_BROWSER_TOOL_ALLOWLIST[number]))) {
    return { scopeRestricted: true, reason: "This Local Browser Runner does not permit any browser read tools.", allowedBrowserTools: configuredBrowserTools };
  }
  const queuedTasks = await listQueuedTasksForLocalRunner(runner.userId, runnerType);
  let blockedActionClass: string | null = null;
  for (const queuedTask of queuedTasks) {
    const actionPolicy = runnerType === "browser"
      ? { ...getLocalActionPolicy(queuedTask.prompt, "browser"), allowedBrowserTools: configuredBrowserTools as LocalBrowserTool[], navigationAllowlist, requiresApprovalForBrowserWrites: runner.requiresApprovalForBrowserWrites }
      : { ...getLocalActionPolicy(queuedTask.prompt), allowedTools: configuredTools as LocalFileTool[] };
    if (actionPolicy.sensitiveActionClass && !configuredSensitiveActions.has(actionPolicy.sensitiveActionClass)) {
      blockedActionClass = actionPolicy.sensitiveActionClass;
      continue;
    }
    const task = await claimQueuedTaskForLocalRunner(runner.userId, queuedTask.id);
    if (!task) continue;
    if (actionPolicy.requiresApproval && runner.requiresApprovalForSensitive) {
    const existingApproval = await getLocalTaskApproval(runner.userId, task.id);
    if (existingApproval?.status === "rejected") {
      await updateTaskStatus(task.id, "error", { errorMessage: "The owner rejected the requested sensitive local action." });
      await recordLocalRunnerAudit({ userId: runner.userId, runnerId: runner.id, taskId: task.id, eventType: "runner.task_rejected", detail: "The device encountered a task whose sensitive action was rejected by its owner." });
      continue;
    }
    if (existingApproval?.status === "expired") {
      await updateTaskStatus(task.id, "error", { errorMessage: "The required local-action approval expired before the task was released to a device." });
      await recordLocalRunnerAudit({ userId: runner.userId, runnerId: runner.id, taskId: task.id, approvalId: existingApproval.id, eventType: "runner.approval_expired", detail: "The device encountered a task whose required approval had expired." });
      continue;
    }
    if (existingApproval?.status !== "approved") await createPendingLocalTaskApproval(runner.userId, task.id, actionPolicy, runner.id);
    if (existingApproval?.status !== "approved") {
      await updateTaskStatus(task.id, "queued");
      await updateExecutionStep(task.id, 1, "completed", "Palm prepared this sensitive local task for an explicit owner decision.");
      await updateExecutionStep(task.id, 2, "pending", "The Local Runner will not claim this task until the requested local action is approved.");
      return { approvalRequired: true, taskId: task.id, policy: actionPolicy };
    }
    }
  const runId = await createRunnerRun({
    taskId: task.id,
    provider: "local",
    localRunnerId: runner.id,
    runnerClass: runnerType === "browser" ? "user_browser" : "user_machine",
    idempotencyKey: randomUUID(),
    policy: { cost: "zero", executionHost: "user_machine", network: "user_controlled", runnerType, ...actionPolicy },
  });
  await updateExecutionStep(task.id, 1, "completed", "Palm assigned this objective to the user’s local runner.");
  await updateExecutionStep(task.id, 2, "completed", "Enabled capability preferences were packaged for the local runner.");
  await updateExecutionStep(task.id, 3, "running", "The local runner claimed this task and is reporting evidence directly to Palm.");
  await updateRunnerRun(runId, "running");
  await appendRunnerEvent(runId, task.id, { eventSeq: 1, source: "runner", type: runnerType === "browser" ? "browser.claimed" : "local.claimed", status: "running", detail: `${runnerType === "browser" ? "Local Browser Runner" : "Local runner"} “${runner.label}” claimed this task.` });
  await recordLocalRunnerAudit({ userId: runner.userId, runnerId: runner.id, taskId: task.id, eventType: "runner.task_claimed", detail: `${runnerType === "browser" ? "Local Browser Runner" : "Local Runner"} “${runner.label}” claimed a task.`, metadata: { runnerType, allowedTools: configuredTools, allowedBrowserTools: configuredBrowserTools } });
  const detail = await getTaskDetail(runner.userId, task.id);
  const skills = (await getSkillCatalog(runner.userId)).filter(skill => skill.enabled && (!configuredSkillSlugs || configuredSkillSlugs.has(skill.slug))).map(skill => skill.slug);
  return { runId, task: detail?.task, attachments: detail?.attachments.map(item => ({ id: item.id, name: item.originalName, mimeType: item.mimeType, source: item.source, ...(item.source === "local_reference" ? { localRelativePath: item.localRelativePath } : {}) })) ?? [], capabilityScope: skills, localToolPolicy: actionPolicy };
  }
  if (blockedActionClass) return { scopeRestricted: true, reason: `This Local Runner is not permitted to perform the ${blockedActionClass.replace(/_/g, " ")} action class.`, allowedTools: configuredTools };
  return null;
}

export async function getLocalTaskApprovalForRunner(token: string, taskId: number) {
  return getLocalTaskApprovalForAuthenticatedRunner(await authenticateLocalRunner(token), taskId);
}

export async function getLocalTaskApprovalForAuthenticatedRunner(runner: Awaited<ReturnType<typeof authenticateLocalRunner>>, taskId: number) {
  return getLocalTaskApproval(runner.userId, taskId);
}

function domainIsAllowed(url: string | undefined, domains: string[]) {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return domains.some(domain => hostname === domain.toLowerCase() || hostname.endsWith(`.${domain.toLowerCase()}`));
  } catch {
    return false;
  }
}

export async function requestLocalBrowserApproval(token: string, runId: number, input: unknown) {
  return requestLocalBrowserApprovalForRunner(await authenticateLocalRunner(token), runId, input);
}

export async function requestLocalBrowserApprovalForRunner(runner: Awaited<ReturnType<typeof authenticateLocalRunner>>, runId: number, input: unknown) {
  if (runner.runnerType !== "browser") throw new Error("Only a Local Browser Runner can request browser-action approval.");
  const action = browserApprovalSchema.parse(input);
  const configuredBrowserTools = (() => {
    try {
      const parsed = JSON.parse(runner.allowedBrowserToolsJson) as string[];
      return LOCAL_BROWSER_ALL_TOOLS.filter(tool => parsed.includes(tool));
    } catch { return [...LOCAL_BROWSER_TOOL_ALLOWLIST]; }
  })();
  if (!configuredBrowserTools.includes(action.tool)) throw new Error(`This device is not permitted to use ${action.tool}.`);
  const navigationAllowlist = (() => {
    try { return (JSON.parse(runner.navigationAllowlistJson) as string[]).filter(value => typeof value === "string" && value.length > 0); }
    catch { return []; }
  })();
  const isWrite = LOCAL_BROWSER_WRITE_TOOLS.includes(action.tool as typeof LOCAL_BROWSER_WRITE_TOOLS[number]);
  const requiresApproval = isWrite ? runner.requiresApprovalForBrowserWrites : action.tool === "navigate" && !domainIsAllowed(action.url, navigationAllowlist);
  if (!requiresApproval) return { approvalRequired: false as const, reason: "This read-only browser action is inside the device navigation boundary." };
  const configuredSensitiveActions = (() => {
    try { return new Set(JSON.parse(runner.allowedSensitiveActionsJson) as string[]); }
    catch { return new Set(["browser_control"]); }
  })();
  if (!configuredSensitiveActions.has("browser_control")) throw new Error("This device is not permitted to request browser-control approval.");
  const run = await getRunnerRun(runId);
  if (!run || run.provider !== "local") throw new Error("This browser action is not attached to a Local Runner task.");
  if (run.localRunnerId !== runner.id) throw new Error("This browser action was not assigned to this Local Runner.");
  const detail = await getTaskDetail(runner.userId, run.taskId);
  if (!detail) throw new Error("This browser runner is not authorized for the task.");
  const policy = {
    allowedTools: [],
    allowedBrowserTools: [action.tool],
    requiresApproval: true,
    sensitiveActionClass: "browser_control" as const,
    approvalReason: `Browser action “${action.tool.replace(/_/g, " ")}” requires your explicit approval before this device continues.`,
    inputBoundary: "PALM_INPUT_DIR" as const,
    outputBoundary: "PALM_RUNNER_DIR" as const,
    navigationBoundary: "device_allowlist" as const,
    browserAction: { tool: action.tool, url: action.url ? new URL(action.url).origin : undefined, targetSummary: action.targetSummary },
  };
  const approval = await createPendingLocalTaskApproval(runner.userId, run.taskId, policy, runner.id);
  await updateExecutionStep(run.taskId, 3, "running", "The Local Browser Runner paused before a controlled browser action and requested explicit approval.");
  await recordLocalRunnerAudit({ userId: runner.userId, runnerId: runner.id, taskId: run.taskId, approvalId: approval.id, eventType: "browser.approval_requested", detail: `The Local Browser Runner requested approval for ${action.tool.replace(/_/g, " ")}.`, metadata: { tool: action.tool, url: action.url ? new URL(action.url).origin : undefined } });
  return { approvalRequired: approval.status !== "approved", taskId: run.taskId, approval };
}

export async function ingestLocalRunnerEvent(token: string, runId: number, input: unknown) {
  return ingestLocalRunnerEventForRunner(await authenticateLocalRunner(token), runId, input);
}

export async function ingestLocalRunnerEventForRunner(runner: Awaited<ReturnType<typeof authenticateLocalRunner>>, runId: number, input: unknown) {
  const event = eventSchema.parse(input);
  const run = await getRunnerRun(runId);
  if (!run || run.provider !== "local") throw new Error("This execution is not assigned to a local runner.");
  if (run.localRunnerId !== runner.id) throw new Error("This execution is not assigned to this Local Runner.");
  const detail = await getTaskDetail(runner.userId, run.taskId);
  if (!detail) throw new Error("This local runner is not authorized for the task.");
  const last = await getLastRunnerEventSequence(runId);
  if (event.eventSeq > last + 1) throw new Error("Runner event sequence contains a gap.");
  const append = await appendRunnerEvent(runId, run.taskId, { ...event, source: "runner" });
  if (append.duplicate) return { duplicate: true };
  if (event.status === "running") {
    await updateRunnerRun(runId, "running");
    await updateExecutionStep(run.taskId, 3, "running", event.detail);
  } else if (event.status === "collecting") {
    await updateRunnerRun(runId, "collecting");
    await updateExecutionStep(run.taskId, 4, "running", event.detail);
  } else if (event.status === "completed") {
    const finalMessage = typeof event.data?.finalMessage === "string" ? event.data.finalMessage : "The local runner completed the delegated task.";
    await updateRunnerRun(runId, "completed");
    await updateExecutionStep(run.taskId, 3, "completed", event.detail);
    await updateExecutionStep(run.taskId, 4, "completed", "Local runner results are ready for review.");
    await addAssistantMessage(run.taskId, finalMessage);
    await updateTaskStatus(run.taskId, "completed", { assistantResponse: finalMessage });
  } else if (event.status === "failed" || event.status === "cancelled") {
    await updateRunnerRun(runId, event.status === "cancelled" ? "cancelled" : "failed", { errorMessage: event.detail });
    await updateExecutionStep(run.taskId, 3, "error", event.detail);
    await updateTaskStatus(run.taskId, "error", { errorMessage: event.detail });
  }
  return { duplicate: false };
}

export async function verifyLocalRunnerOwnership(userId: number, runnerId: number) {
  return getLocalRunnerForUser(userId, runnerId);
}
