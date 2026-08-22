import { trpc } from "../lib/trpc";

export type LocalRunnerStatusRun = {
  provider?: "local" | string;
  status?: "queued" | "dispatching" | "provisioning" | "running" | "collecting" | "completed" | "failed" | "cancellation_requested" | "cancelled" | string;
  runnerClass?: string;
};

export type RunnerStatusCardProps = {
  run: LocalRunnerStatusRun | null;
  isExecuting: boolean;
  waitingForLocalRunner: boolean;
  onCancel: () => void;
  isCancelling: boolean;
};

/**
 * Intentionally describes only the state Palm can prove. In particular, a
 * queued task is never represented as completed before a user-controlled
 * Local Runner has claimed and reported it.
 */
export function RunnerStatusCard({ run, isExecuting, waitingForLocalRunner, onCancel, isCancelling }: RunnerStatusCardProps) {
  const terminal = ["completed", "failed", "cancelled"].includes(run?.status ?? "");
  const label = waitingForLocalRunner
    ? "Queued for your Local Runner"
    : run?.status === "running"
      ? "Local Runner is executing"
      : run?.status === "collecting"
        ? "Local Runner is collecting local results"
        : run?.status === "completed"
          ? "Local Runner evidence is available"
          : run?.status === "failed"
            ? "Local Runner needs review"
            : run?.status === "cancelled"
              ? "Local Runner task was cancelled"
              : isExecuting
                ? "Preparing a Local Runner task"
                : "Local Runner status";
  const detail = waitingForLocalRunner
    ? "Palm will remain queued until the local-runner script on your machine claims this task."
    : run?.status === "running"
      ? "Your own machine claimed this task. Palm receives only the ordered evidence and result that the runner reports."
      : run?.status === "collecting"
        ? "The Local Runner is preparing its final local evidence record."
        : run?.status === "completed"
          ? "Palm received the Local Runner’s completion evidence. Review the reported result before taking further action."
          : run?.status === "failed"
            ? "The Local Runner reported a problem. The task was not silently moved to hosted execution."
            : run?.status === "cancelled"
              ? "No hosted fallback was selected for this Local Runner task."
              : "Palm has not yet received a Local Runner claim or evidence event.";

  return (
    <section className="card runner-status-card" aria-live="polite" data-runner-provider="local">
      <div className="runner-status-heading">
        <div>
          <span className="status">Local execution</span>
          <h2>{label}</h2>
          <p>{detail}</p>
        </div>
        {run && !terminal && !waitingForLocalRunner ? (
          <button type="button" className="runner-status-cancel" onClick={onCancel} disabled={isCancelling || run.status === "cancellation_requested"}>
            {isCancelling ? "Stopping…" : "Stop"}
          </button>
        ) : null}
      </div>
      <div className="runner-status-badges" aria-label="Local Runner safety properties">
        <span>Your own machine</span>
        <span>No hosted fallback</span>
        <span>Evidence required</span>
      </div>
    </section>
  );
}

export function PalmWorkspace() {
  const health = trpc.system.health.useQuery(undefined, { retry: false, refetchInterval: 30_000 });
  const capabilities = trpc.system.capabilities.useQuery(undefined, { retry: false });

  const status = health.isLoading ? "Checking" : health.data?.status === "ok" ? "Online" : "Unavailable";
  const detail = health.error?.message || "Connect a real authentication adapter to enable Palm task management.";

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Palm.ai control plane</p>
        <h1>Execution infrastructure is being restored.</h1>
        <p className="lede">This minimal dashboard verifies the API, surfaces the available runner modes, and keeps the client buildable while the original UI component library is reconstructed.</p>
      </section>
      <section className="grid" aria-label="Control plane status">
        <article className="card">
          <span className={`status ${health.data?.status === "ok" ? "status-ok" : ""}`}>{status}</span>
          <h2>API health</h2>
          <p>{detail}</p>
        </article>
        <article className="card">
          <span className="status">Runner policy</span>
          <h2>Execution modes</h2>
          <ul>
            <li>GitHub Actions: {capabilities.data?.hostedRunner ?? "loading"}</li>
            <li>Local Runner: {capabilities.data?.localRunner ? "available" : "loading"}</li>
            <li>Local Browser Runner: {capabilities.data?.localBrowserRunner ? "available" : "loading"}</li>
          </ul>
        </article>
      </section>
      <section className="next-steps">
        <h2>Next required work</h2>
        <ol>
          <li>Restore the original OAuth/session adapter and authenticated task UI.</li>
          <li>Configure a MySQL database and run the Drizzle migration.</li>
          <li>Deploy the control plane, then configure GitHub Actions secrets.</li>
        </ol>
      </section>
    </main>
  );
}
