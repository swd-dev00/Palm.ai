export type PalmStreamEvent = { type?: string; detail?: string; runId?: number; runnerId?: number };

export function isLocalRunnerQueueEvent(event: PalmStreamEvent) {
  return event.type === "local_queue" && typeof event.runnerId === "number" && event.runnerId > 0;
}

export type PalmStreamOutcome = { githubActionsAccepted: boolean; localQueued: boolean };

export function applyPalmStreamEvent(outcome: PalmStreamOutcome, event: PalmStreamEvent): PalmStreamOutcome {
  if (isLocalRunnerQueueEvent(event)) return { ...outcome, localQueued: true };
  if (event.type === "accepted" && typeof event.runId === "number" && event.runId > 0) return { ...outcome, githubActionsAccepted: true };
  return outcome;
}

export function palmExecutionFeedback(outcome: PalmStreamOutcome) {
  if (outcome.localQueued) return "queued" as const;
  if (outcome.githubActionsAccepted) return "dispatched" as const;
  return "completed" as const;
}
