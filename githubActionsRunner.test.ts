import { describe, expect, it, vi } from "vitest";
import { readGithubActionsRunnerConfig, startGithubActionsRunner, stopGithubActionsRunner } from "./githubActionsRunner";

const config = {
  owner: "swd-dev00",
  repo: "Palm.ai",
  workflow: "palm-runner.yml",
  ref: "main",
  dispatchToken: "a".repeat(40),
  runnerSharedSecret: "b".repeat(32),
};

describe("GitHub Actions Palm runner", () => {
  it("loads only a complete server-side configuration", () => {
    expect(readGithubActionsRunnerConfig({
      GITHUB_ACTIONS_OWNER: config.owner,
      GITHUB_ACTIONS_REPO: config.repo,
      GITHUB_ACTIONS_WORKFLOW: config.workflow,
      GITHUB_ACTIONS_REF: config.ref,
      GITHUB_ACTIONS_DISPATCH_TOKEN: config.dispatchToken,
      GITHUB_ACTIONS_RUNNER_SHARED_SECRET: config.runnerSharedSecret,
    })).toEqual(config);
    expect(readGithubActionsRunnerConfig({ GITHUB_ACTIONS_OWNER: config.owner })).toBeNull();
  });

  it("dispatches the workflow with only its public run identifier", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ workflow_run_id: 42, html_url: "https://github.com/swd-dev00/Palm.ai/actions/runs/42" }), { status: 200 }));
    await expect(startGithubActionsRunner(config, { runId: 19, taskId: 7 }, fetchImpl)).resolves.toEqual({ workflowRunId: "42", workflowRunUrl: "https://github.com/swd-dev00/Palm.ai/actions/runs/42" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/swd-dev00/Palm.ai/actions/workflows/palm-runner.yml/dispatches",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: `Bearer ${config.dispatchToken}`, "X-GitHub-Api-Version": "2026-03-10" }),
        body: JSON.stringify({ ref: "main", inputs: { run_id: "19" } }),
      }),
    );
  });

  it("uses GitHub’s workflow-run cancellation endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    await expect(stopGithubActionsRunner(config, "42", fetchImpl)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/swd-dev00/Palm.ai/actions/runs/42/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
