import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../../routers";
import { getGithubActionsRunnerAssignment, ingestRunnerEvent } from "../../runnerRuntime";
import { createContext } from "./context";

const app = express();
const port = Number.parseInt(process.env.PORT || "3000", 10);

app.disable("x-powered-by");
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false, limit: "5mb" }));

app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok", service: "palm-control-plane" });
});

app.post("/api/palm/runs/:runId/assignment", async (req, res) => {
  const runId = Number.parseInt(req.params.runId, 10);
  const signature = req.header("x-palm-runner-signature") || "";
  if (!Number.isInteger(runId) || runId <= 0 || !signature) {
    return res.status(400).json({ error: "A runner id and GitHub Actions runner signature are required." });
  }
  try {
    res.status(200).json(await getGithubActionsRunnerAssignment({ runId, signature }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub Actions runner assignment could not be issued.";
    res.status(message.includes("signature") ? 401 : 400).json({ error: message });
  }
});

app.post("/api/palm/runs/:runId/events", async (req, res) => {
  const runId = Number.parseInt(req.params.runId, 10);
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!Number.isInteger(runId) || runId <= 0 || !token) {
    return res.status(400).json({ error: "A runner id and bearer event token are required." });
  }
  try {
    const accepted = await ingestRunnerEvent({ runId, token, body: req.body });
    res.status(accepted.duplicate ? 200 : 202).json(accepted);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runner event could not be accepted.";
    res.status(message.includes("token") ? 401 : 400).json({ error: message });
  }
});

app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

const clientDist = resolve(process.cwd(), "dist");
if (process.env.NODE_ENV === "production" && existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(resolve(clientDist, "index.html")));
} else {
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
}

app.listen(port, "0.0.0.0", () => {
  console.log(`Palm control plane listening on 0.0.0.0:${port}`);
});
