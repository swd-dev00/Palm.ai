export type RunnerProvider = "local" | "github_actions" | "built_in";

export type RunnerSelectionContext = {
  localRunnerAvailable: boolean;
  githubActionsRunnerConfigured: boolean;
  requiresLocalExecution?: boolean;
};

export type RunnerAdapter = {
  provider: RunnerProvider;
  canDispatch: (context: RunnerSelectionContext) => boolean;
};

export const localRunnerAdapter: RunnerAdapter = {
  provider: "local",
  canDispatch: context => context.localRunnerAvailable,
};

export const githubActionsRunnerAdapter: RunnerAdapter = {
  provider: "github_actions",
  canDispatch: context => !context.requiresLocalExecution && context.githubActionsRunnerConfigured,
};

export const builtInRunnerAdapter: RunnerAdapter = {
  provider: "built_in",
  canDispatch: context => !context.requiresLocalExecution,
};

export const DEFAULT_RUNNER_ADAPTERS: RunnerAdapter[] = [localRunnerAdapter, githubActionsRunnerAdapter, builtInRunnerAdapter];

/**
 * Returns null, rather than a cloud fallback, when a task requires a Local
 * Runner but no matching local device is available. Callers must queue it for
 * the user-controlled device and may never reinterpret it as hosted work.
 */
export function selectRunnerAdapter(context: RunnerSelectionContext, adapters: RunnerAdapter[] = DEFAULT_RUNNER_ADAPTERS) {
  if (context.requiresLocalExecution && !context.localRunnerAvailable) return null;
  return adapters.find(adapter => adapter.canDispatch(context)) ?? null;
}
