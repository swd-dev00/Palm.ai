import { SignJWT, jwtVerify } from "jose";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ENV } from "./_core/env";
import { readGithubActionsRunnerConfig, startGithubActionsRunner, stopGithubActionsRunner } from "./githubActionsRunner";
import {
  addAssistantMessage,
  appendRunnerEvent,
  createRunnerRun,
  getLastRunnerEventSequence,
  getRunnerRun,
  getRunnerTaskManifestDetail,
  getSkillCatalog,
  getTaskDetail,
  listLocalRunners,
  updateExecutionStep,
  updateRunnerRun,
  updateTaskStatus,
} from "./db";
import { storageGetSignedUrl, storagePut } from "./storage";
import { runPalmTask, type PalmExecutionEvent } from "./actionRuntime";
import { selectRunnerAdapter } from "./runnerAdapters";

const encoder = new TextEncoder();
const eventTokenKey = () => encoder.encode(ENV.cookieSecret || "palm-local-development-key-change-before-production");
const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

const runnerEventSchema = z.object({
  eventSeq: z.number().int().positive(),
  type: z.string().min(1).max(96),
  status: z.string().min(1).max(48),
  detail: z.string().min(1).max(8_000),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type PalmRunnerEvent = z.infer<typeof runnerEventSchema>;

export async function issueRunnerEventToken(runId: number, taskId: number) {
  return new SignJWT({ taskId, scope: "runner:event:write" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(runId))
    .setAudience("palm-runner-events")
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("20m")
    .sign(eventTokenKey());
}

export async function verifyRunnerEventToken(token: string, runId: number) {
  const verified = await jwtVerify(token, eventTokenKey(), { audience: "palm-runner-events" });
  if (verified.payload.sub !== String(runId) || verified.payload.scope !== "runner:event:write") {
    throw new Error("Runner event token is not valid for this execution.");
  }
  return verified.payload;
}

export function parseRunnerEvent(input: unknown) {
  return runnerEventSchema.parse(input);
}

function githubRunnerSignature(sharedSecret: string, runId: number) {
  return createHmac("sha256", sharedSecret).update(String(runId)).digest("hex");
}

function signatureMatches(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

async function createRunnerManifest(taskId: number) {
  const detail = await getRunnerTaskManifestDetail(taskId);
  if (!detail) throw new Error("Task not found");
  const skills = (await getSkillCatalog(detail.task.userId)).filter(skill => skill.enabled).map(skill => skill.slug);
  const attachments = await Promise.all(detail.attachments.map(async attachment => {
    if (!attachment.storageKey || attachment.source !== "cloud_upload") {
      throw new Error("A local-only attachment cannot be placed in a GitHub Actions runner manifest.");
    }
    return {
      name: attachment.originalName,
      mimeType: attachment.mimeType,
      url: await storageGetSignedUrl(attachment.storageKey),
    };
  }));
  const manifest = Buffer.from(JSON.stringify({
    version: "palm-github-actions-runner/v1",
    taskId,
    objective: detail.task.prompt,
    capabilityScope: skills,
    attachments,
    constraints: { noBrowserIngress: true, maxRuntimeSeconds: 900, requireEventEvidence: true, allowedHandlers: ["inventory_files", "extract_text_metadata", "profile_csv", "write_result_record"] },
  }, null, 2));
  const stored = await storagePut(`palm-ai/runner-manifests/${detail.task.userId}/${taskId}/${randomUUID()}.json`, manifest, "application/json");
  return storageGetSignedUrl(stored.key);
}

// Called only by the GitHub-hosted workflow after it presents a run-scoped HMAC.
// The response supplies short-lived, per-run capability material instead of placing
// signed URLs or event credentials in public workflow inputs.
export async function getGithubActionsRunnerAssignment(input: { runId: number; signature: string }) {
  const config = readGithubActionsRunnerConfig();
  if (!config) throw new Error("GitHub Actions runner is not configured.");
  if (!signatureMatches(input.signature, githubRunnerSignature(config.runnerSharedSecret, input.runId))) {
    throw new Error("GitHub Actions runner signature is invalid.");
  }
  const run = await getRunnerRun(input.runId);
  if (!run || run.provider !== "github_actions") throw new Error("This run is not assigned to GitHub Actions.");
  if (terminalStatuses.has(run.status)) throw new Error("This runner execution is already terminal.");
  const [manifestUrl, eventToken] = await Promise.all([createRunnerManifest(run.taskId), issueRunnerEventToken(run.id, run.taskId)]);
  return { runId: run.id, taskId: run.taskId, manifestUrl, eventToken, eventUrlPath: `/api/palm/runs/${run.id}/events` };
}

export async function executePalmAction(input: { taskId: number; userId: number; onEvent?: (event: PalmExecutionEvent | { type: "runner"; detail: string; runId: number } | { type: "local_queue"; detail: string; runnerId: number }) => void }) {
  const detail = await getTaskDetail(input.userId, input.taskId);
  if (!detail) throw new Error("Task not found");
  const onlineRunners = (await listLocalRunners(input.userId)).filter(runner => runner.status === "online" && runner.lastSeenAt && Date.now() - runner.lastSeenAt.getTime() < 90_000);
  const needsLocalFileRunner = detail.task.executionTarget === "local_file" || detail.attachments.some(attachment => attachment.source === "local_reference");
  const needsLocalBrowserRunner = detail.task.executionTarget === "local_browser";
  const onlineLocalRunner = needsLocalBrowserRunner
    ? onlineRunners.find(runner => runner.runnerType === "browser")
    : onlineRunners.find(runner => runner.runnerType === "file");
  const config = readGithubActionsRunnerConfig();
  const selectedAdapter = selectRunnerAdapter({ localRunnerAvailable: Boolean(onlineLocalRunner), githubActionsRunnerConfigured: Boolean(config) });
  if (selectedAdapter.provider === "local" && onlineLocalRunner) {
    const runnerLabel = onlineLocalRunner.runnerType === "browser" ? "Local Browser Runner" : "Local Runner";
    await updateExecutionStep(input.taskId, 1, "completed", `Palm queued this objective for the ${runnerLabel.toLowerCase()} “${onlineLocalRunner.label}”.`);
    await updateExecutionStep(input.taskId, 2, "pending", detail.attachments.some(attachment => attachment.source === "local_reference") ? "Palm retained local-only attachment references; file bytes will not be uploaded or sent to GitHub Actions." : "The local runner will seal enabled capabilities into the assignment when it claims the task.");
    input.onEvent?.({ type: "local_queue", detail: `Queued for ${runnerLabel.toLowerCase()} “${onlineLocalRunner.label}”.`, runnerId: onlineLocalRunner.id });
    return { provider: "local" as const, runnerId: onlineLocalRunner.id };
  }
  if (needsLocalFileRunner || needsLocalBrowserRunner) {
    const requiredRunner = needsLocalBrowserRunner ? "Local Browser Runner" : "Local Runner";
    await updateExecutionStep(input.taskId, 1, "completed", `Palm retained the task for a user-controlled ${requiredRunner}.`);
    await updateExecutionStep(input.taskId, 2, "pending", "The task remains queued. Palm will not upload local-only attachment bytes or send them to GitHub Actions.");
    input.onEvent?.({ type: "local_queue", detail: `Waiting for an online ${requiredRunner}; the task will not fall back to cloud execution.`, runnerId: 0 });
    return { provider: "local" as const, runnerId: 0 };
  }
  if (selectedAdapter.provider === "built_in" || !config) return runPalmTask(input);

  const runId = await createRunnerRun({
    taskId: input.taskId,
    provider: "github_actions",
    runnerClass: "github_actions_ubuntu",
    idempotencyKey: randomUUID(),
    policy: { runnerClass: "github_actions_ubuntu", maxRuntimeSeconds: 900, publicIngress: false, retryLimit: 0, attachmentBoundary: "cloud_upload_only", noBrowserIngress: true },
  });
  try {
    await updateTaskStatus(input.taskId, "running");
    await updateExecutionStep(input.taskId, 1, "completed", "Palm accepted the objective and created an isolated GitHub Actions runner request.");
    await updateExecutionStep(input.taskId, 2, "completed", "Enabled capability preferences will be sealed into a short-lived runner manifest after the workflow authenticates.");
    await updateExecutionStep(input.taskId, 3, "running", "Palm is dispatching a time-boxed GitHub Actions workflow.");
    await updateRunnerRun(runId, "dispatching");
    await appendRunnerEvent(runId, input.taskId, { eventSeq: 1, source: "control_plane", type: "run.dispatching", status: "dispatching", detail: "The execution request is being sent to GitHub Actions." });
    input.onEvent?.({ type: "runner", detail: "Dispatching a GitHub Actions runner.", runId });

    const started = await startGithubActionsRunner(config, { runId, taskId: input.taskId });
    await updateRunnerRun(runId, "provisioning", { githubWorkflowRunId: started.workflowRunId ?? undefined, githubWorkflowRunUrl: started.workflowRunUrl ?? undefined });
    await appendRunnerEvent(runId, input.taskId, { eventSeq: 2, source: "github_actions", type: "runner.provisioning", status: "provisioning", detail: started.workflowRunId ? `GitHub Actions accepted workflow run ${started.workflowRunId}.` : "GitHub Actions accepted the runner request and is provisioning the workflow." });
    input.onEvent?.({ type: "runner", detail: "GitHub Actions accepted the runner request; workflow provisioning is in progress.", runId });
    return { provider: "github_actions" as const, runId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub Actions runner dispatch failed.";
    await updateRunnerRun(runId, "failed", { errorMessage: message });
    await appendRunnerEvent(runId, input.taskId, { eventSeq: 2, source: "control_plane", type: "run.failed", status: "failed", detail: message });
    await updateExecutionStep(input.taskId, 3, "error", "The GitHub Actions runner request could not be completed.");
    await updateTaskStatus(input.taskId, "error", { errorMessage: message });
    throw error;
  }
}

export async function ingestRunnerEvent(input: { runId: number; token: string; body: unknown }) {
  await verifyRunnerEventToken(input.token, input.runId);
  const event = parseRunnerEvent(input.body);
  const run = await getRunnerRun(input.runId);
  if (!run) throw new Error("Runner execution not found.");
  const lastSequence = await getLastRunnerEventSequence(input.runId);
  if (event.eventSeq > lastSequence + 1) throw new Error("Runner event sequence contains a gap.");

  const append = await appendRunnerEvent(input.runId, run.taskId, { ...event, source: "runner" });
  if (append.duplicate) return { duplicate: true, status: run.status };
  if (event.status === "running") {
    await updateRunnerRun(run.id, "running");
    await updateExecutionStep(run.taskId, 3, "running", event.detail);
  } else if (event.status === "collecting") {
    await updateRunnerRun(run.id, "collecting");
    await updateExecutionStep(run.taskId, 4, "running", event.detail);
  } else if (event.status === "completed") {
    const finalMessage = typeof event.data?.finalMessage === "string" ? event.data.finalMessage : "Palm's GitHub Actions runner completed the delegated action. Review the registered artifacts and trace evidence.";
    await updateRunnerRun(run.id, "completed");
    await updateExecutionStep(run.taskId, 3, "completed", event.detail);
    await updateExecutionStep(run.taskId, 4, "completed", "Runner evidence and deliverables are ready for review.");
    await addAssistantMessage(run.taskId, finalMessage);
    await updateTaskStatus(run.taskId, "completed", { assistantResponse: finalMessage });
  } else if (event.status === "failed") {
    await updateRunnerRun(run.id, "failed", { errorMessage: event.detail });
    await updateExecutionStep(run.taskId, 3, "error", event.detail);
    await updateTaskStatus(run.taskId, "error", { errorMessage: event.detail });
  } else if (event.status === "cancelled") {
    await updateRunnerRun(run.id, "cancelled");
    await updateExecutionStep(run.taskId, 3, "error", "The GitHub Actions runner confirmed cancellation.");
    await updateTaskStatus(run.taskId, "error", { errorMessage: "GitHub Actions runner execution was cancelled." });
  }
  return { duplicate: false, status: terminalStatuses.has(event.status) ? event.status : "accepted" };
}

export async function cancelPalmRun(input: { taskId: number; userId: number }) {
  const detail = await getTaskDetail(input.userId, input.taskId);
  if (!detail?.latestRun) throw new Error("No runner execution is associated with this task.");
  const run = detail.latestRun;
  if (run.provider !== "github_actions") throw new Error("This task is not running through GitHub Actions.");
  if (terminalStatuses.has(run.status)) return { status: run.status };
  const config = readGithubActionsRunnerConfig();
  if (!config || !run.githubWorkflowRunId) throw new Error("GitHub Actions cancellation is not configured for this execution.");
  await stopGithubActionsRunner(config, run.githubWorkflowRunId);
  await updateRunnerRun(run.id, "cancellation_requested");
  const sequence = (await getLastRunnerEventSequence(run.id)) + 1;
  await appendRunnerEvent(run.id, input.taskId, { eventSeq: sequence, source: "control_plane", type: "run.cancellation_requested", status: "cancellation_requested", detail: "Palm requested GitHub Actions to cancel this runner execution." });
  return { status: "cancellation_requested" as const };
}
