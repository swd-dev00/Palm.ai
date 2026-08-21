export type RunnerProvider = "local" | "github_actions" | "built_in";

export type RunnerSelectionContext = {
  localRunnerAvailable: boolean;
  githubActionsRunnerConfigured: boolean;
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
  canDispatch: context => context.githubActionsRunnerConfigured,
};

export const builtInRunnerAdapter: RunnerAdapter = {
  provider: "built_in",
  canDispatch: () => true,
};

export const DEFAULT_RUNNER_ADAPTERS: RunnerAdapter[] = [localRunnerAdapter, githubActionsRunnerAdapter, builtInRunnerAdapter];

export function selectRunnerAdapter(context: RunnerSelectionContext, adapters: RunnerAdapter[] = DEFAULT_RUNNER_ADAPTERS) {
  return adapters.find(adapter => adapter.canDispatch(context)) ?? builtInRunnerAdapter;
}
