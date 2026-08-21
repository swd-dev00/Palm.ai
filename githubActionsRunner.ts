import { z } from "zod";

const GITHUB_API_VERSION = "2026-03-10";

const githubActionsRunnerSchema = z.object({
  owner: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
  repo: z.string().regex(/^[A-Za-z0-9._-]+$/),
  workflow: z.string().regex(/^[A-Za-z0-9._/-]+\.ya?ml$/),
  ref: z.string().min(1).max(255),
  dispatchToken: z.string().min(20),
  runnerSharedSecret: z.string().min(24),
});

export type GithubActionsRunnerConfig = z.infer<typeof githubActionsRunnerSchema>;
export type GithubActionsStartRequest = { runId: number; taskId: number };
export type GithubActionsStartResult = { workflowRunId: string | null; workflowRunUrl: string | null };

export function readGithubActionsRunnerConfig(env: NodeJS.ProcessEnv = process.env): GithubActionsRunnerConfig | null {
  const parsed = githubActionsRunnerSchema.safeParse({
    owner: env.GITHUB_ACTIONS_OWNER,
    repo: env.GITHUB_ACTIONS_REPO,
    workflow: env.GITHUB_ACTIONS_WORKFLOW || "palm-runner.yml",
    ref: env.GITHUB_ACTIONS_REF || "main",
    dispatchToken: env.GITHUB_ACTIONS_DISPATCH_TOKEN,
    runnerSharedSecret: env.GITHUB_ACTIONS_RUNNER_SHARED_SECRET,
  });
  return parsed.success ? parsed.data : null;
}

function headers(config: GithubActionsRunnerConfig) {
  return {
    Authorization: `Bearer ${config.dispatchToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "Content-Type": "application/json",
  };
}

function workflowUrl(config: GithubActionsRunnerConfig) {
  return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`;
}

export async function startGithubActionsRunner(config: GithubActionsRunnerConfig, request: GithubActionsStartRequest, fetchImpl: typeof fetch = fetch): Promise<GithubActionsStartResult> {
  const response = await fetchImpl(workflowUrl(config), {
    method: "POST",
    headers: headers(config),
    // The numeric Palm run ID is not a credential. The worker obtains its short-lived
    // manifest URL and event token from Palm with the repository-held shared secret.
    body: JSON.stringify({ ref: config.ref, inputs: { run_id: String(request.runId) } }),
  });
  if (response.status !== 200) {
    const detail = await response.text().catch(() => "");
    throw new Error(`GitHub Actions runner dispatch failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  const data = await response.json().catch(() => ({})) as { workflow_run_id?: unknown; html_url?: unknown };
  return {
    workflowRunId: typeof data.workflow_run_id === "number" ? String(data.workflow_run_id) : null,
    workflowRunUrl: typeof data.html_url === "string" ? data.html_url : null,
  };
}

export async function stopGithubActionsRunner(config: GithubActionsRunnerConfig, workflowRunId: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/actions/runs/${encodeURIComponent(workflowRunId)}/cancel`, {
    method: "POST",
    headers: headers(config),
  });
  if (response.status !== 202) {
    const detail = await response.text().catch(() => "");
    throw new Error(`GitHub Actions runner cancellation failed (${response.status}): ${detail.slice(0, 500)}`);
  }
}
