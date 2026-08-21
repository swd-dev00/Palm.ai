import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addAssistantMessage: vi.fn(),
  getSkillCatalog: vi.fn(),
  getTaskDetail: vi.fn(),
  updateExecutionStep: vi.fn(),
  updateTaskStatus: vi.fn(),
  invokeLLM: vi.fn(),
  profileCsvAttachment: vi.fn(),
  formatCsvProfileEvidence: vi.fn(),
}));

vi.mock("./db", () => ({
  addAssistantMessage: mocks.addAssistantMessage,
  getSkillCatalog: mocks.getSkillCatalog,
  getTaskDetail: mocks.getTaskDetail,
  updateExecutionStep: mocks.updateExecutionStep,
  updateTaskStatus: mocks.updateTaskStatus,
}));

vi.mock("./_core/llm", () => ({ invokeLLM: mocks.invokeLLM }));
vi.mock("./csvProfile", () => ({ profileCsvAttachment: mocks.profileCsvAttachment, formatCsvProfileEvidence: mocks.formatCsvProfileEvidence }));

import { runPalmTask } from "./actionRuntime";

describe("Palm server-sent action runtime", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getTaskDetail.mockResolvedValue({
      task: { prompt: "Synthesize this brief" },
      attachments: [],
    });
    mocks.getSkillCatalog.mockResolvedValue([{ name: "Web research", enabled: true }]);
    mocks.invokeLLM.mockResolvedValue({
      choices: [{ message: { content: "## Result\nA focused Palm deliverable." } }],
    });
    mocks.profileCsvAttachment.mockResolvedValue(null);
    mocks.formatCsvProfileEvidence.mockReturnValue("");
  });

  it("emits durable workflow updates before delivering the model result", async () => {
    const events: Array<{ type: string; stepOrder?: number; status?: string }> = [];

    const result = await runPalmTask({
      taskId: 41,
      userId: 7,
      onEvent: event => events.push(event),
    });

    expect(result.content).toContain("focused Palm deliverable");
    expect(events.filter(event => event.type === "trace").map(event => event.stepOrder)).toEqual([1, 1, 2, 2, 3, 3, 4]);
    expect(events.at(-1)).toMatchObject({ type: "complete" });
    expect(mocks.updateTaskStatus).toHaveBeenNthCalledWith(1, 41, "running");
    expect(mocks.updateTaskStatus).toHaveBeenLastCalledWith(41, "completed", { assistantResponse: result.content });
    expect(mocks.addAssistantMessage).toHaveBeenCalledWith(41, result.content);
  });

  it("continues the model conversation with factual CSV tool evidence before synthesis", async () => {
    const attachment = { id: 5, originalName: "margin-ledger.csv", mimeType: "text/csv", fileSize: 52, storageKey: "tasks/41/margin.csv" };
    mocks.getTaskDetail.mockResolvedValue({ task: { prompt: "Analyze customer profitability" }, attachments: [attachment] });
    mocks.profileCsvAttachment.mockResolvedValue({ tool: "profile_csv", fileName: "margin-ledger.csv", rowCount: 2, headers: ["customer", "revenue"], columns: [] });
    mocks.formatCsvProfileEvidence.mockReturnValue("profile_csv evidence for margin-ledger.csv: 2 data rows; columns: customer, revenue.");
    mocks.invokeLLM
      .mockResolvedValueOnce({ choices: [{ message: { content: "", tool_calls: [{ id: "tool-profile-1", type: "function", function: { name: "profile_csv", arguments: '{"attachmentId":5}' } }] } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: "## Analysis\nRevenue structure is now evidenced." } }] });

    const result = await runPalmTask({ taskId: 41, userId: 7 });

    expect(mocks.profileCsvAttachment).toHaveBeenCalledWith(attachment);
    expect(mocks.invokeLLM).toHaveBeenNthCalledWith(1, expect.objectContaining({ toolChoice: "auto", tools: expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: "profile_csv" }) })]) }));
    expect(mocks.invokeLLM).toHaveBeenNthCalledWith(2, expect.objectContaining({ messages: expect.arrayContaining([expect.objectContaining({ role: "assistant", tool_calls: expect.any(Array) }), expect.objectContaining({ role: "tool", tool_call_id: "tool-profile-1", content: expect.stringContaining("2 data rows") })]) }));
    expect(mocks.updateExecutionStep).toHaveBeenCalledWith(41, 3, "running", "Palm executed the allowlisted profile_csv tool for attached evidence.");
    expect(result.content).toContain("Revenue structure is now evidenced");
  });

  it("caps repeated attachment tool iterations before persisting a fallback deliverable", async () => {
    const attachment = { id: 5, originalName: "margin-ledger.csv", mimeType: "text/csv", fileSize: 52, storageKey: "tasks/41/margin.csv" };
    mocks.getTaskDetail.mockResolvedValue({ task: { prompt: "Analyze customer profitability" }, attachments: [attachment] });
    mocks.profileCsvAttachment.mockResolvedValue({ tool: "profile_csv", fileName: "margin-ledger.csv", rowCount: 2, headers: [], columns: [] });
    mocks.formatCsvProfileEvidence.mockReturnValue("profile_csv evidence");
    const loopingReply = { choices: [{ message: { content: "", tool_calls: [{ id: "tool-profile", type: "function", function: { name: "profile_csv", arguments: '{"attachmentId":5}' } }] } }] };
    mocks.invokeLLM.mockResolvedValue(loopingReply);

    const result = await runPalmTask({ taskId: 41, userId: 7 });

    expect(mocks.invokeLLM).toHaveBeenCalledTimes(3);
    expect(mocks.profileCsvAttachment).toHaveBeenCalledTimes(3);
    expect(result.content).toContain("iteration limit");
  });
});
