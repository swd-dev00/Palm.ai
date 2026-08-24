import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  addAssistantMessage: vi.fn(), appendRunnerEvent: vi.fn(), claimQueuedTaskForLocalRunner: vi.fn(), claimRunnerRunForLocalRunner: vi.fn(), createPendingLocalTaskApproval: vi.fn(), createLocalRunner: vi.fn(), createRunnerRun: vi.fn(), getLastRunnerEventSequence: vi.fn(), getLocalRunnerByTokenHash: vi.fn(), getLocalRunnerForUser: vi.fn(), getLocalTaskApproval: vi.fn(), getRunnerRun: vi.fn(), getSkillCatalog: vi.fn(), getTaskDetail: vi.fn(), listQueuedTasksForLocalRunner: vi.fn(), recordLocalRunnerAudit: vi.fn(), touchLocalRunner: vi.fn(), updateExecutionStep: vi.fn(), updateRunnerRun: vi.fn(), updateTaskStatus: vi.fn(), consumeLocalRunnerRequestNonce: vi.fn(),
}));

vi.mock("./db", () => db);

import { authenticateSignedLocalRunnerRequest, claimLocalRunForRunner } from "./localRunner";
import { selectRunnerAdapter } from "./runnerAdapters";

const token = "palm_local_signed-request-test-token";
const body = Buffer.from('{"example":true}');
const path = "/api/v1/local-runners/claim";
const timestamp = String(Date.now());
const nonce = "a".repeat(32);

function signatureFor(input: { method?: string; path?: string; body?: Buffer; timestamp?: string; nonce?: string } = {}) {
  const method = input.method ?? "POST";
  const requestPath = input.path ?? path;
  const requestBody = input.body ?? body;
  const requestTimestamp = input.timestamp ?? timestamp;
  const requestNonce = input.nonce ?? nonce;
  const bodyHash = createHash("sha256").update(requestBody.toString("utf8")).digest("hex");
  return createHmac("sha256", token)
    .update(`v1\n${method}\n${requestPath}\n${requestTimestamp}\n${requestNonce}\n${bodyHash}`)
    .digest("hex");
}

describe("strict local routing", () => {
  it("returns no adapter rather than a hosted fallback when local execution is required and unavailable", () => {
    expect(selectRunnerAdapter({ localRunnerAvailable: false, githubActionsRunnerConfigured: true, requiresLocalExecution: true })).toBeNull();
  });

  it("selects only the local adapter when a matching local runner is available", () => {
    expect(selectRunnerAdapter({ localRunnerAvailable: true, githubActionsRunnerConfigured: true, requiresLocalExecution: true })?.provider).toBe("local");
  });
});

describe("signed Local Runner requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getLocalRunnerByTokenHash.mockResolvedValue({ id: 7, userId: 4, status: "offline" });
    db.consumeLocalRunnerRequestNonce.mockResolvedValue(true);
  });

  it("accepts a fresh, correctly signed request and records its nonce", async () => {
    const result = await authenticateSignedLocalRunnerRequest({ token, method: "POST", path, rawBody: body, timestamp, nonce, signature: signatureFor() });
    expect(result).toMatchObject({ id: 7, userId: 4 });
    expect(db.consumeLocalRunnerRequestNonce).toHaveBeenCalledWith(7, nonce, expect.any(Date));
  });

  it("rejects a signature whose body has been changed", async () => {
    await expect(authenticateSignedLocalRunnerRequest({ token, method: "POST", path, rawBody: Buffer.from('{"example":false}'), timestamp, nonce, signature: signatureFor() }))
      .rejects.toThrow("signature is invalid");
    expect(db.consumeLocalRunnerRequestNonce).not.toHaveBeenCalled();
  });

  it("rejects replayed nonces after a valid signature check", async () => {
    db.consumeLocalRunnerRequestNonce.mockResolvedValueOnce(false);
    await expect(authenticateSignedLocalRunnerRequest({ token, method: "POST", path, rawBody: body, timestamp, nonce, signature: signatureFor() }))
      .rejects.toThrow("already processed");
  });
});


describe("deterministic local run binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getTaskDetail.mockResolvedValue({ task: { id: 22 }, attachments: [] });
    db.getSkillCatalog.mockResolvedValue([]);
    db.appendRunnerEvent.mockResolvedValue({ duplicate: false });
  });

  it("prevents double-claiming by relying on one atomic runId claim", async () => {
    const runnerA = { id: 7, userId: 4, label: "Laptop A", runnerType: "file", status: "online", allowedSkillSlugsJson: "[]" };
    const runnerB = { id: 8, userId: 4, label: "Laptop B", runnerType: "file", status: "online", allowedSkillSlugsJson: "[]" };
    db.claimRunnerRunForLocalRunner
      .mockResolvedValueOnce({ id: 9, taskId: 22, provider: "local", policyJson: null })
      .mockResolvedValueOnce(null);

    const claims = await Promise.allSettled([claimLocalRunForRunner(runnerA as never, 9), claimLocalRunForRunner(runnerB as never, 9)]);

    expect(claims.filter(claim => claim.status === "fulfilled")).toHaveLength(1);
    expect(claims.filter(claim => claim.status === "rejected")).toHaveLength(1);
    expect(db.claimRunnerRunForLocalRunner).toHaveBeenCalledWith({ runId: 9, runnerId: 7, userId: 4, runnerType: "file" });
    expect(db.claimRunnerRunForLocalRunner).toHaveBeenCalledWith({ runId: 9, runnerId: 8, userId: 4, runnerType: "file" });
  });
});
