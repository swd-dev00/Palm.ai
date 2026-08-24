import express, { type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../../routers";
import {
  authenticateSignedLocalRunnerRequest,
  claimLocalTaskForRunner,
  claimLocalRunForRunner,
  getLocalTaskApprovalForAuthenticatedRunner,
  ingestLocalRunnerEventForRunner,
  requestLocalBrowserApprovalForRunner,
} from "../../localRunner";
import { getGithubActionsRunnerAssignment, ingestRunnerEvent } from "../../runnerRuntime";
import { createContext } from "./context";

type RawBodyRequest = Request & { rawBody?: Buffer };

const app = express();
const port = Number.parseInt(process.env.PORT || "3000", 10);

app.disable("x-powered-by");
// Production listens only behind the Nginx TLS terminator described in DEPLOY_ORACLE.md.
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
app.use(express.json({
  limit: "5mb",
  verify: (req, _res, buffer) => { (req as RawBodyRequest).rawBody = Buffer.from(buffer); },
}));
app.use(express.urlencoded({ extended: false, limit: "5mb" }));

function positiveId(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readLocalRunnerToken(req: Request) {
  return req.header("authorization")?.replace(/^Local\s+/i, "") || "";
}

/**
 * Browser sessions authenticate ordinary tRPC traffic. This separate profile is
 * exclusively for user-installed Local Runners, whose requests must arrive via
 * HTTPS and must carry a fresh signature over their exact request body.
 */
async function requireSignedLocalRunner(req: RawBodyRequest, res: Response) {
  if (process.env.NODE_ENV === "production" && !req.secure) {
    res.status(426).json({ error: "Local Runner connections require HTTPS." });
    return null;
  }
  const token = readLocalRunnerToken(req);
  if (!token) {
    res.status(401).json({ error: "A Local Runner credential is required." });
    return null;
  }
  try {
    return await authenticateSignedLocalRunnerRequest({
      token,
      method: req.method,
      path: req.path,
      rawBody: req.rawBody ?? Buffer.alloc(0),
      timestamp: req.header("x-palm-runner-timestamp") ?? undefined,
      nonce: req.header("x-palm-runner-nonce") ?? undefined,
      signature: req.header("x-palm-runner-signature") ?? undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local Runner authentication failed.";
    res.status(401).json({ error: message });
    return null;
  }
}

app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok", service: "palm-control-plane" });
});

app.post("/api/palm/runs/:runId/assignment", async (req, res) => {
  const runId = positiveId(req.params.runId);
  const signature = req.header("x-palm-runner-signature") || "";
  if (!runId || !signature) {
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
  const runId = positiveId(req.params.runId);
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!runId || !token) {
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

app.post("/api/v1/local-runners/heartbeat", async (req: RawBodyRequest, res) => {
  const runner = await requireSignedLocalRunner(req, res);
  if (!runner) return;
  res.json({ runnerId: runner.id, status: "online" });
});

app.post("/api/v1/local-runners/claim", async (req: RawBodyRequest, res) => {
  const runner = await requireSignedLocalRunner(req, res);
  if (!runner) return;
  try {
    const assignment = await claimLocalTaskForRunner(runner);
    if (!assignment) return res.status(204).end();
    res.status(200).json(assignment);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local task claim failed.";
    res.status(400).json({ error: message });
  }
});
app.post("/api/v1/local-runners/runs/:runId/claim", async (req: RawBodyRequest, res) => {
  const runner = await requireSignedLocalRunner(req, res);
  const runId = positiveId(req.params.runId);
  if (!runner) return;
  if (!runId) return res.status(400).json({ error: "A valid run id is required." });
  try {
    res.status(200).json(await claimLocalRunForRunner(runner, runId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local run claim failed.";
    res.status(message.includes("authorized") ? 401 : 409).json({ error: message });
  }
});


app.get("/api/v1/local-runners/tasks/:taskId/approval", async (req: RawBodyRequest, res) => {
  const runner = await requireSignedLocalRunner(req, res);
  const taskId = positiveId(req.params.taskId);
  if (!runner) return;
  if (!taskId) return res.status(400).json({ error: "A valid task id is required." });
  try {
    const approval = await getLocalTaskApprovalForAuthenticatedRunner(runner, taskId);
    if (!approval) return res.status(404).json({ error: "No local-action approval exists for this task." });
    res.json({ taskId, status: approval.status, policyJson: approval.policyJson, decidedAt: approval.decidedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local Runner approval lookup failed.";
    res.status(400).json({ error: message });
  }
});

app.post("/api/v1/local-runners/runs/:runId/browser-approval", async (req: RawBodyRequest, res) => {
  const runner = await requireSignedLocalRunner(req, res);
  const runId = positiveId(req.params.runId);
  if (!runner) return;
  if (!runId) return res.status(400).json({ error: "A valid runner id is required." });
  try {
    res.status(202).json(await requestLocalBrowserApprovalForRunner(runner, runId, req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Browser-action approval request failed.";
    res.status(400).json({ error: message });
  }
});

app.post("/api/v1/local-runners/runs/:runId/events", async (req: RawBodyRequest, res) => {
  const runner = await requireSignedLocalRunner(req, res);
  const runId = positiveId(req.params.runId);
  if (!runner) return;
  if (!runId) return res.status(400).json({ error: "A valid runner id is required." });
  try {
    const accepted = await ingestLocalRunnerEventForRunner(runner, runId, req.body);
    res.status(accepted.duplicate ? 200 : 202).json(accepted);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local Runner event failed.";
    res.status(400).json({ error: message });
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

// Bind directly only to loopback in production. Nginx owns public HTTPS.
const host = process.env.NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0";
app.listen(port, host, () => {
  console.log(`Palm control plane listening on ${host}:${port}`);
});
