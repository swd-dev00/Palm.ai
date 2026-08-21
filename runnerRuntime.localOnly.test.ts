import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getTaskDetail: vi.fn(),
  listLocalRunners: vi.fn(),
  updateExecutionStep: vi.fn(),
}));
const actionRuntime = vi.hoisted(() => ({ runPalmTask: vi.fn() }));

vi.mock("./db", () => db);
vi.mock("./actionRuntime", () => actionRuntime);
vi.mock("./runnerAdapters", () => ({ selectRunnerAdapter: vi.fn(({ localRunnerAvailable }: { localRunnerAvailable: boolean }) => ({ provider: localRunnerAvailable ? "local" : "built_in" })) }));
vi.mock("./githubActionsRunner", () => ({ readGithubActionsRunnerConfig: vi.fn(() => null), startGithubActionsRunner: vi.fn(), stopGithubActionsRunner: vi.fn() }));

import { executePalmAction } from "./runnerRuntime";

describe("Palm local-only attachment routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getTaskDetail.mockResolvedValue({
      task: { id: 41, executionTarget: "local_file" },
      attachments: [{ id: 8, originalName: "margin.csv", source: "local_reference", storageKey: null }],
    });
    db.listLocalRunners.mockResolvedValue([]);
  });

  it("queues local-only input for a file runner without calling the cloud action runtime", async () => {
    const events: unknown[] = [];
    await expect(executePalmAction({ taskId: 41, userId: 7, onEvent: event => events.push(event) })).resolves.toEqual({ provider: "local", runnerId: 0 });
    expect(actionRuntime.runPalmTask).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({ type: "local_queue", runnerId: 0, detail: expect.stringContaining("will not fall back to cloud") }));
    expect(db.updateExecutionStep).toHaveBeenCalledWith(41, 2, "pending", expect.stringContaining("will not upload local-only attachment bytes"));
  });

  it("queues a browser-targeted task only for a browser runner and never assigns it to an online file runner", async () => {
    db.getTaskDetail.mockResolvedValueOnce({ task: { id: 42, executionTarget: "local_browser" }, attachments: [] });
    db.listLocalRunners.mockResolvedValueOnce([{ id: 5, label: "File Mac", runnerType: "file", status: "online", lastSeenAt: new Date() }]);
    const events: unknown[] = [];
    await expect(executePalmAction({ taskId: 42, userId: 7, onEvent: event => events.push(event) })).resolves.toEqual({ provider: "local", runnerId: 0 });
    expect(actionRuntime.runPalmTask).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({ type: "local_queue", runnerId: 0, detail: expect.stringContaining("Local Browser Runner") }));
  });

  it("queues a browser-targeted task for the matching online browser runner", async () => {
    db.getTaskDetail.mockResolvedValueOnce({ task: { id: 43, executionTarget: "local_browser" }, attachments: [] });
    db.listLocalRunners.mockResolvedValueOnce([{ id: 6, label: "Browser Mac", runnerType: "browser", status: "online", lastSeenAt: new Date() }]);
    await expect(executePalmAction({ taskId: 43, userId: 7 })).resolves.toEqual({ provider: "local", runnerId: 6 });
    expect(actionRuntime.runPalmTask).not.toHaveBeenCalled();
    expect(db.updateExecutionStep).toHaveBeenCalledWith(43, 1, "completed", expect.stringContaining("local browser runner"));
  });
});
