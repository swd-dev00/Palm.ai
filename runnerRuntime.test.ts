import { describe, expect, it } from "vitest";
import { issueRunnerEventToken, parseRunnerEvent, verifyRunnerEventToken } from "./runnerRuntime";

describe("Palm runner event security", () => {
  it("binds a short-lived runner event token to one execution", async () => {
    const token = await issueRunnerEventToken(41, 73);
    await expect(verifyRunnerEventToken(token, 41)).resolves.toMatchObject({ sub: "41", taskId: 73 });
    await expect(verifyRunnerEventToken(token, 42)).rejects.toThrow("not valid for this execution");
  });

  it("accepts only sequenced, bounded runner evidence", () => {
    expect(parseRunnerEvent({ eventSeq: 1, type: "runner.started", status: "running", detail: "Runner booted." })).toMatchObject({ eventSeq: 1, status: "running" });
    expect(() => parseRunnerEvent({ eventSeq: 0, type: "", status: "", detail: "" })).toThrow();
  });
});
