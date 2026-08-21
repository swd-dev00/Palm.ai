import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { executePalmAction, getGithubActionsRunnerAssignment, ingestRunnerEvent } from "../runnerRuntime";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { createTask, getAttachmentForUser, getLocalTaskApproval, getTaskDetail } from "../db";
import { deriveTaskTitle } from "../palmDomain";
import { storageGetSignedUrl } from "../storage";
import { cancelPalmRun } from "../runnerRuntime";
import { authenticateLocalRunner, claimLocalTask, ingestLocalRunnerEvent, registerLocalRunner, requestLocalBrowserApproval } from "../localRunner";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  const authenticatedUser = async (req: express.Request, res: express.Response) => {
    const ctx = await createContext({
      req,
      res,
      info: { accept: null, type: "query", isBatchCall: false, calls: [], connectionParams: null, signal: new AbortController().signal, url: null },
    });
    return ctx.user;
  };
  const asPositiveId = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  };
  app.post("/api/v1/tasks", async (req, res) => {
    const user = await authenticatedUser(req, res);
    const objective = typeof req.body?.objective === "string" ? req.body.objective.trim() : "";
    if (!user) return res.status(401).json({ error: "Authentication is required." });
    if (objective.length < 2 || objective.length > 12_000) return res.status(400).json({ error: "objective must contain 2–12,000 characters." });
    const projectId = Number.isInteger(req.body?.projectId) && req.body.projectId > 0 ? req.body.projectId : undefined;
    const taskId = await createTask({ userId: user.id, projectId, prompt: objective, title: deriveTaskTitle(objective) });
    res.status(201).json(await getTaskDetail(user.id, taskId));
  });
  app.get("/api/v1/tasks/:taskId", async (req, res) => {
    const user = await authenticatedUser(req, res);
    const taskId = asPositiveId(req.params.taskId);
    if (!user) return res.status(401).json({ error: "Authentication is required." });
    if (!taskId) return res.status(400).json({ error: "A valid task id is required." });
    const detail = await getTaskDetail(user.id, taskId);
    if (!detail) return res.status(404).json({ error: "Task not found." });
    res.json(detail);
  });
  app.post("/api/v1/tasks/:taskId/execute", async (req, res) => {
    const user = await authenticatedUser(req, res);
    const taskId = asPositiveId(req.params.taskId);
    if (!user) return res.status(401).json({ error: "Authentication is required." });
    if (!taskId) return res.status(400).json({ error: "A valid task id is required." });
    try {
      const result = await executePalmAction({ taskId, userId: user.id });
      res.status(result && "provider" in result && result.provider === "github_actions" ? 202 : 200).json(await getTaskDetail(user.id, taskId));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Task execution failed." });
    }
  });
  app.post("/api/v1/tasks/:taskId/cancel", async (req, res) => {
    const user = await authenticatedUser(req, res);
    const taskId = asPositiveId(req.params.taskId);
    if (!user) return res.status(401).json({ error: "Authentication is required." });
    if (!taskId) return res.status(400).json({ error: "A valid task id is required." });
    try {
      res.status(202).json(await cancelPalmRun({ taskId, userId: user.id }));
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : "Task cannot be cancelled." });
    }
  });
  app.get("/api/v1/artifacts/:artifactId/download", async (req, res) => {
    const user = await authenticatedUser(req, res);
    const attachmentId = asPositiveId(req.params.artifactId);
    if (!user) return res.status(401).json({ error: "Authentication is required." });
    if (!attachmentId) return res.status(400).json({ error: "A valid artifact id is required." });
    const attachment = await getAttachmentForUser(user.id, attachmentId);
    if (!attachment) return res.status(404).json({ error: "Artifact not found." });
    if (!attachment.storageKey) return res.status(409).json({ error: "This attachment is local-only and was not uploaded to cloud storage." });
    res.redirect(302, await storageGetSignedUrl(attachment.storageKey));
  });
  app.post("/api/v1/local-runners", async (req, res) => {
    const user = await authenticatedUser(req, res);
    const label = typeof req.body?.label === "string" ? req.body.label : "My local runner";
    const runnerType = req.body?.runnerType === "browser" ? "browser" : "file";
    if (!user) return res.status(401).json({ error: "Authentication is required." });
    try {
      const registered = await registerLocalRunner(user.id, label, runnerType);
      res.status(201).json({ runnerId: registered.runnerId, token: registered.token, warning: "Save this token now. Palm.ai never displays it again." });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Local runner registration failed." });
    }
  });
  app.post("/api/v1/local-runners/heartbeat", async (req, res) => {
    const token = req.header("authorization")?.replace(/^Local\s+/i, "");
    if (!token) return res.status(401).json({ error: "A Local runner token is required." });
    try {
      const runner = await authenticateLocalRunner(token);
      res.json({ runnerId: runner.id, status: "online" });
    } catch (error) {
      res.status(401).json({ error: error instanceof Error ? error.message : "Local runner authentication failed." });
    }
  });
  app.post("/api/v1/local-runners/claim", async (req, res) => {
    const token = req.header("authorization")?.replace(/^Local\s+/i, "");
    if (!token) return res.status(401).json({ error: "A Local runner token is required." });
    try {
      const assignment = await claimLocalTask(token);
      if (!assignment) return res.status(204).end();
      res.status(200).json(assignment);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Local task claim failed." });
    }
  });
  app.get("/api/v1/local-runners/tasks/:taskId/approval", async (req, res) => {
    const token = req.header("authorization")?.replace(/^Local\s+/i, "");
    const taskId = asPositiveId(req.params.taskId);
    if (!token) return res.status(401).json({ error: "A Local runner token is required." });
    if (!taskId) return res.status(400).json({ error: "A valid task id is required." });
    try {
      const runner = await authenticateLocalRunner(token);
      const approval = await getLocalTaskApproval(runner.userId, taskId);
      if (!approval) return res.status(404).json({ error: "No local-action approval exists for this task." });
      res.json({ taskId, status: approval.status, policyJson: approval.policyJson, decidedAt: approval.decidedAt });
    } catch (error) {
      res.status(401).json({ error: error instanceof Error ? error.message : "Local runner authentication failed." });
    }
  });
  app.post("/api/v1/local-runners/runs/:runId/browser-approval", async (req, res) => {
    const token = req.header("authorization")?.replace(/^Local\s+/i, "");
    const runId = asPositiveId(req.params.runId);
    if (!token || !runId) return res.status(401).json({ error: "A Local runner token and run id are required." });
    try {
      res.status(202).json(await requestLocalBrowserApproval(token, runId, req.body));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Browser-action approval request failed." });
    }
  });
  app.post("/api/v1/local-runners/runs/:runId/events", async (req, res) => {
    const token = req.header("authorization")?.replace(/^Local\s+/i, "");
    const runId = asPositiveId(req.params.runId);
    if (!token || !runId) return res.status(401).json({ error: "A Local runner token and runner id are required." });
    try {
      res.status(202).json(await ingestLocalRunnerEvent(token, runId, req.body));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Local runner event failed." });
    }
  });
  app.get("/api/v1/runs/:runId/events", async (req, res) => {
    const user = await authenticatedUser(req, res);
    const runId = asPositiveId(req.params.runId);
    const taskId = asPositiveId(String(req.query.taskId ?? ""));
    if (!user) return res.status(401).json({ error: "Authentication is required." });
    if (!runId || !taskId) return res.status(400).json({ error: "A valid runner id and taskId query parameter are required." });
    const detail = await getTaskDetail(user.id, taskId);
    if (detail?.latestRun?.id !== runId) return res.status(404).json({ error: "Runner execution not found." });
    res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
    res.flushHeaders();
    let nextSequence = Number.parseInt(req.header("last-event-id") || "0", 10) + 1;
    const timer = setInterval(async () => {
      try {
        const refreshed = await getTaskDetail(user.id, taskId);
        if (!refreshed || refreshed.latestRun?.id !== runId) return;
        for (const event of refreshed.runnerEvents.filter(event => event.eventSeq >= nextSequence)) {
          res.write(`id: ${event.eventSeq}\ndata: ${JSON.stringify(event)}\n\n`);
          nextSequence = event.eventSeq + 1;
        }
        if (["completed", "failed", "cancelled"].includes(refreshed.latestRun.status)) {
          clearInterval(timer);
          res.end();
        }
      } catch {
        clearInterval(timer);
        res.end();
      }
    }, 1500);
    req.on("close", () => clearInterval(timer));
  });
  app.post("/api/palm/tasks/:taskId/execute-stream", async (req, res) => {
    const taskId = Number.parseInt(req.params.taskId, 10);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      res.status(400).json({ error: "A valid task id is required." });
      return;
    }

    const ctx = await createContext({
      req,
      res,
      info: {
        accept: null,
        type: "query",
        isBatchCall: false,
        calls: [],
        connectionParams: null,
        signal: new AbortController().signal,
        url: null,
      },
    });
    if (!ctx.user) {
      res.status(401).json({ error: "Authentication is required." });
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    try {
      const result = await executePalmAction({ taskId, userId: ctx.user.id, onEvent: send });
      if (result && "provider" in result && result.provider === "github_actions") send({ type: "accepted", runId: result.runId });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Palm could not complete this task.";
      send({ type: "error", detail });
    } finally {
      res.end();
    }
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
      res.status(400).json({ error: "A runner id and bearer event token are required." });
      return;
    }
    try {
      const accepted = await ingestRunnerEvent({ runId, token, body: req.body });
      res.status(accepted.duplicate ? 200 : 202).json(accepted);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Runner event could not be accepted.";
      res.status(message.includes("token") ? 401 : 400).json({ error: message });
    }
  });
  app.post("/api/v1/internal/runs/:runId/events", async (req, res) => {
    const runId = Number.parseInt(req.params.runId, 10);
    const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!Number.isInteger(runId) || runId <= 0 || !token) return res.status(400).json({ error: "A runner id and bearer event token are required." });
    try {
      const accepted = await ingestRunnerEvent({ runId, token, body: req.body });
      res.status(accepted.duplicate ? 200 : 202).json(accepted);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Runner event could not be accepted.";
      res.status(message.includes("token") ? 401 : 400).json({ error: message });
    }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
