#!/usr/bin/env node
/**
 * Palm.ai Local Browser Runner — zero-cost, user-owned browser execution.
 *
 * Install on the user-owned machine: npm install playwright
 * Defaults to a clean, isolated Chromium profile. To attach to a real browser
 * session, set PALM_BROWSER_MODE=cdp and PALM_BROWSER_CDP_URL explicitly.
 * CDP mode is intentionally opt-in because it can expose signed-in sessions.
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const BASE_URL = required("PALM_BASE_URL");
const TOKEN = required("PALM_LOCAL_TOKEN");
const RUNNER_DIR = process.env.PALM_RUNNER_DIR || path.join(process.env.HOME || ".", "palm-local-browser-results");
const MODE = process.env.PALM_BROWSER_MODE || "isolated";
const CDP_URL = process.env.PALM_BROWSER_CDP_URL;
const pollMs = Number(process.env.PALM_RUNNER_POLL_MS || 5_000);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before starting Palm Local Browser Runner.`);
  return value;
}

async function request(endpoint, options = {}) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: { authorization: `Local ${TOKEN}`, "content-type": "application/json", ...(options.headers || {}) },
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`);
  return body;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function report(runId, eventSeq, type, status, detail, data) {
  await request(`/api/v1/local-runners/runs/${runId}/events`, { method: "POST", body: JSON.stringify({ eventSeq, type, status, detail, ...(data ? { data } : {}) }) });
}

function hostnameAllowed(url, domains) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return domains.some(domain => hostname === domain.toLowerCase() || hostname.endsWith(`.${domain.toLowerCase()}`));
  } catch { return false; }
}

async function waitForApproval(taskId) {
  while (true) {
    const approval = await request(`/api/v1/local-runners/tasks/${taskId}/approval`);
    if (approval.status === "approved") return true;
    if (["rejected", "expired"].includes(approval.status)) return false;
    await sleep(pollMs);
  }
}

async function requestBrowserApproval(runId, taskId, action) {
  const result = await request(`/api/v1/local-runners/runs/${runId}/browser-approval`, { method: "POST", body: JSON.stringify(action) });
  return result.approvalRequired ? waitForApproval(taskId) : true;
}

async function openBrowser() {
  if (MODE === "isolated") return chromium.launch({ headless: false });
  if (MODE === "cdp" && CDP_URL) return chromium.connectOverCDP(CDP_URL);
  throw new Error("Use PALM_BROWSER_MODE=isolated, or explicitly set PALM_BROWSER_MODE=cdp with PALM_BROWSER_CDP_URL.");
}

function objectiveUrl(prompt) {
  return prompt.match(/https?:\/\/[^\s)]+/i)?.[0] || null;
}

async function execute(assignment) {
  const { runId, task, localToolPolicy: policy } = assignment;
  const navigationAllowlist = policy.navigationAllowlist || [];
  const allowedTools = policy.allowedBrowserTools || [];
  const url = objectiveUrl(task.prompt);
  await mkdir(RUNNER_DIR, { recursive: true });
  await report(runId, 2, "browser.preparing", "running", "Local Browser Runner opened an isolated browser workspace.");
  if (!url) {
    await report(runId, 3, "browser.awaiting_objective", "completed", "No URL was included in the objective, so Palm did not navigate or inspect a page.", { finalMessage: "Local Browser Runner is ready, but the objective did not include a URL. Add an explicit https:// URL to begin read-only browser work." });
    return;
  }
  if (!allowedTools.includes("navigate")) throw new Error("This Local Browser Runner does not permit navigation.");
  const approved = hostnameAllowed(url, navigationAllowlist) || await requestBrowserApproval(runId, task.id, { tool: "navigate", url, targetSummary: "Navigate to the requested site" });
  if (!approved) {
    await report(runId, 3, "browser.approval_denied", "cancelled", "The owner did not approve navigation outside this device’s domain boundary.");
    return;
  }
  const browser = await openBrowser();
  try {
    const context = browser.contexts()[0] || await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const title = await page.title();
    const screenshotPath = path.join(RUNNER_DIR, `palm-browser-task-${task.id}.png`);
    if (allowedTools.includes("screenshot")) await page.screenshot({ path: screenshotPath, fullPage: false });
    const readableCharacters = allowedTools.includes("read_page_text") ? await page.locator("body").innerText().then(text => text.length).catch(() => 0) : 0;
    await writeFile(path.join(RUNNER_DIR, `palm-browser-task-${task.id}.json`), JSON.stringify({ taskId: task.id, mode: MODE, url: new URL(url).origin, title, readableCharacters, screenshotPath, pageContentSentToPalm: false }, null, 2));
    await report(runId, 3, "browser.read_complete", "collecting", `The browser reached ${new URL(url).origin} and captured local-only evidence.`, { title, readableCharacters, pageContentSentToPalm: false });
    await report(runId, 4, "browser.completed", "completed", "Local Browser Runner completed the read-only browser step.", { finalMessage: `Local Browser Runner opened ${new URL(url).origin} in ${MODE} mode. Screenshot and page evidence remain on the local device; Palm received only factual metadata.` });
  } finally {
    await browser.close();
  }
}

console.log(`Palm Local Browser Runner started in ${MODE} mode. Evidence stays in ${RUNNER_DIR}.`);
while (true) {
  try {
    await request("/api/v1/local-runners/heartbeat", { method: "POST", body: "{}" });
    const assignment = await request("/api/v1/local-runners/claim", { method: "POST", body: "{}" });
    if (!assignment || assignment.approvalRequired || assignment.scopeRestricted) { await sleep(pollMs); continue; }
    await execute(assignment);
  } catch (error) {
    console.error("Palm Local Browser Runner:", error instanceof Error ? error.message : error);
    await sleep(Math.max(pollMs, 10_000));
  }
}
