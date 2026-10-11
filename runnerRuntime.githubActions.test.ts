import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  addAssistantMessage: vi.fn(),
  appendRunnerEvent: vi.fn(),
  countProviderRunsSince: vi.fn(),
  createRunnerRun: vi.fn(),
  getLastRunnerEventSequence: vi.fn(),
  getRunnerRun: vi.fn(),
  getRunnerTaskManifestDetail: vi.fn(),
  getSkillCatalog: vi.fn(),
  getTaskDetail: vi.fn(),
  listLocalRunners: vi.fn(),
  updateExecutionStep: vi.fn(),
  updateRunnerRun: vi.fn(),
  updateTaskStatus: vi.fn(),
}));
const github = vi.hoisted(() => ({ readGithubActionsRunnerConfig: vi.fn(), startGithubActionsRunner: vi.fn(), stopGithubActionsRunner: vi.fn() }));
const actionRuntime = vi.hoisted(() => ({ runPalmTask: vi.fn() }));

vi.mock("./db", () => db);
vi.mock("./githubActionsRunner", () => github);
vi.mock("./actionRuntime", () => actionRuntime);

import { executePalmAction } from "./runnerRuntime";

const config = { owner: "swd-dev00", repo: "Palm.ai", workflow: "palm-runner.yml", ref: "main", dispatchToken: "x".repeat(40), runnerSharedSecret: "y".repeat(32) };

describe("Palm GitHub Actions orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getTaskDetail.mockResolvedValue({ task: { id: 81, executionTarget: "auto" }, attachments: [] });
    db.listLocalRunners.mockResolvedValue([]);
    db.createRunnerRun.mockResolvedValue(17);
    db.countProviderRunsSince.mockResolvedValue(0);
    process.env.PALM_GITHUB_ACTIONS_DAILY_QUOTA = "3";
    db.appendRunnerEvent.mockResolvedValue({ duplicate: false });
    github.readGithubActionsRunnerConfig.mockReturnValue(config);
    github.startGithubActionsRunner.mockResolvedValue({ workflowRunId: "99", workflowRunUrl: "https://github.com/swd-dev00/Palm.ai/actions/runs/99" });
  });

  afterEach(() => {
    delete process.env.PALM_GITHUB_ACTIONS_DAILY_QUOTA;
  });

  it("dispatches an eligible cloud task to GitHub Actions and records its workflow reference", async () => {
    await expect(executePalmAction({ taskId: 81, userId: 5 })).resolves.toEqual({ provider: "github_actions", runId: 17 });
    expect(db.createRunnerRun).toHaveBeenCalledWith(expect.objectContaining({ taskId: 81, provider: "github_actions", runnerClass: "github_actions_ubuntu", policy: expect.objectContaining({ quotaContext: { quotaKey: "github_actions_daily_utc", dailyLimit: 3, usedTodayAtDispatch: 0 } }) }));
    expect(db.countProviderRunsSince).toHaveBeenCalledWith(5, "github_actions", expect.any(Date));
    expect(github.startGithubActionsRunner).toHaveBeenCalledWith(config, { runId: 17, taskId: 81 });
    expect(db.updateRunnerRun).toHaveBeenCalledWith(17, "provisioning", { githubWorkflowRunId: "99", githubWorkflowRunUrl: "https://github.com/swd-dev00/Palm.ai/actions/runs/99" });
    expect(db.appendRunnerEvent).toHaveBeenCalledWith(17, 81, expect.objectContaining({ source: "github_actions", type: "runner.provisioning" }));
  });

  it("uses the built-in runtime when GitHub Actions is not configured", async () => {
    github.readGithubActionsRunnerConfig.mockReturnValue(null);
    actionRuntime.runPalmTask.mockResolvedValue({ content: "Built-in answer" });
    await expect(executePalmAction({ taskId: 81, userId: 5 })).resolves.toEqual({ content: "Built-in answer" });
    expect(github.startGithubActionsRunner).not.toHaveBeenCalled();
  });

  it("refuses hosted dispatch before creating a run when the daily quota is exhausted", async () => {
    db.countProviderRunsSince.mockResolvedValue(3);
    await expect(executePalmAction({ taskId: 81, userId: 5 })).rejects.toThrow(/Exhausted daily quota/);
    expect(db.createRunnerRun).not.toHaveBeenCalled();
    expect(github.startGithubActionsRunner).not.toHaveBeenCalled();
    expect(db.updateTaskStatus).toHaveBeenCalledWith(81, "error", expect.objectContaining({ errorMessage: expect.stringContaining("3/3") }));
  });

  it("refuses hosted dispatch when no daily quota is configured", async () => {
    delete process.env.PALM_GITHUB_ACTIONS_DAILY_QUOTA;
    await expect(executePalmAction({ taskId: 81, userId: 5 })).rejects.toThrow(/quota/);
    expect(db.createRunnerRun).not.toHaveBeenCalled();
    expect(github.startGithubActionsRunner).not.toHaveBeenCalled();
  });
});
