import { applyPalmStreamEvent, type PalmStreamEvent, type PalmStreamOutcome } from "./runnerEvents";

export async function consumePalmExecutionStream(input: {
  taskId: number;
  onEvent: (event: PalmStreamEvent) => Promise<void> | void;
  fetchImpl?: typeof fetch;
}): Promise<PalmStreamOutcome> {
  const response = await (input.fetchImpl ?? fetch)(`/api/palm/tasks/${input.taskId}/execute-stream`, {
    method: "POST",
    headers: { Accept: "text/event-stream" },
    credentials: "include",
  });
  if (!response.ok || !response.body) throw new Error(await response.text().catch(() => "Palm could not start this action."));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outcome: PalmStreamOutcome = { githubActionsAccepted: false, localQueued: false };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const data = frame.split("\n").find(line => line.startsWith("data: "))?.slice(6);
      if (!data) continue;
      const event = JSON.parse(data) as PalmStreamEvent;
      if (event.type === "error") throw new Error(event.detail || "Palm could not complete this action.");
      outcome = applyPalmStreamEvent(outcome, event);
      await input.onEvent(event);
    }
    if (done) break;
  }
  return outcome;
}
