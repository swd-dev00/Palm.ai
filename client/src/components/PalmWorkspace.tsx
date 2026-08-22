import { trpc } from "../lib/trpc";

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
