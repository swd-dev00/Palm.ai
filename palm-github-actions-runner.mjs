#!/usr/bin/env node
import { createHmac } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.PALM_BASE_URL?.replace(/\/$/, "");
const runnerSecret = process.env.PALM_RUNNER_SHARED_SECRET;
const runId = process.env.PALM_RUN_ID;
const maxAttachmentBytes = 5 * 1024 * 1024;
const inputDir = path.resolve(process.env.PALM_INPUT_DIR || ".palm-runner-input");
const outputDir = path.resolve(process.env.PALM_RUNNER_DIR || ".palm-runner-output");

if (!baseUrl || !runnerSecret || !runId) throw new Error("PALM_BASE_URL, PALM_RUNNER_SHARED_SECRET, and PALM_RUN_ID are required.");

function runnerSignature() {
  return createHmac("sha256", runnerSecret).update(runId).digest("hex");
}

async function api(relativePath, init = {}) {
  const response = await fetch(`${baseUrl}${relativePath}`, init);
  if (!response.ok) throw new Error(`Palm request failed (${response.status}).`);
  return response;
}

async function report(assignment, eventSeq, type, status, detail, finalMessage) {
  await api(assignment.eventUrlPath, {
    method: "POST",
    headers: { Authorization: `Bearer ${assignment.eventToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ eventSeq, type, status, detail, ...(finalMessage ? { data: { finalMessage } } : {}) }),
  });
}

function safeName(value, index) {
  const normalized = String(value || `attachment-${index}`).replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return `${String(index).padStart(3, "0")}-${normalized.slice(0, 180) || "attachment"}`;
}

async function loadAssignment() {
  const response = await api(`/api/palm/runs/${encodeURIComponent(runId)}/assignment`, {
    method: "POST",
    headers: { "X-Palm-Runner-Signature": runnerSignature() },
  });
  return response.json();
}

async function loadManifest(assignment) {
  const response = await fetch(assignment.manifestUrl, { redirect: "error" });
  if (!response.ok) throw new Error(`Runner manifest download failed (${response.status}).`);
  return response.json();
}

async function downloadAttachments(manifest) {
  await rm(inputDir, { recursive: true, force: true });
  await mkdir(inputDir, { recursive: true });
  for (const [index, attachment] of (manifest.attachments || []).entries()) {
    const url = new URL(attachment.url);
    if (url.protocol !== "https:") throw new Error("Runner attachments must use HTTPS URLs.");
    const response = await fetch(url, { redirect: "error" });
    if (!response.ok) throw new Error(`Attachment download failed (${response.status}).`);
    const expectedLength = Number(response.headers.get("content-length") || "0");
    if (expectedLength > maxAttachmentBytes) throw new Error("Attachment exceeds the GitHub Actions runner size limit.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxAttachmentBytes) throw new Error("Attachment exceeds the GitHub Actions runner size limit.");
    await writeFile(path.join(inputDir, safeName(attachment.name, index + 1)), bytes, { mode: 0o600 });
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(candidate));
    else if (entry.isFile()) files.push(candidate);
  }
  return files;
}

async function createEvidence(manifest) {
  const files = await walk(inputDir);
  const inventory = [];
  const textRecords = [];
  const csvRecords = [];
  for (const file of files) {
    const relative = path.relative(inputDir, file);
    const details = await stat(file);
    inventory.push(`${relative}\t${details.size} bytes`);
    const bytes = await readFile(file);
    if (!bytes.includes(0)) {
      const text = bytes.toString("utf8");
      textRecords.push(`File: ${relative}\nBytes: ${bytes.length}\nLines: ${text.split(/\r?\n/).length}\nPreview: ${text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").slice(0, 180)}\n`);
      if (relative.toLowerCase().endsWith(".csv")) {
        const rows = text.split(/\r?\n/).filter(Boolean);
        csvRecords.push(`File: ${relative}\nHeader: ${rows[0] || ""}\nRows: ${Math.max(rows.length - 1, 0)}\n`);
      }
    }
  }
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "execution-record.md"), [
    "# Palm GitHub Actions execution record",
    "",
    "## Objective",
    "",
    manifest.objective || "",
    "",
    "## Boundary",
    "",
    "This disposable GitHub-hosted runner processed only cloud-uploaded attachments with fixed read-oriented handlers. It did not access local file references, browser state, or arbitrary shell commands.",
    "",
    "## File inventory",
    "",
    inventory.sort().join("\n") || "No uploaded attachments were supplied.",
    "",
    "## Text metadata",
    "",
    textRecords.join("\n") || "No readable text attachments were identified.",
    "",
    "## CSV profile",
    "",
    csvRecords.join("\n") || "No CSV attachments were identified.",
  ].join("\n"), { mode: 0o600 });
}

async function main() {
  const assignment = await loadAssignment();
  let nextEventSeq = 3;
  try {
    await report(assignment, nextEventSeq++, "github_actions.started", "running", "GitHub Actions Runner authenticated and is preparing its ephemeral workspace.");
    const manifest = await loadManifest(assignment);
    await downloadAttachments(manifest);
    await createEvidence(manifest);
    await report(assignment, nextEventSeq++, "github_actions.completed", "completed", "GitHub Actions Runner completed the allowlisted uploaded-file handlers.", "Palm completed the task through its GitHub Actions runner using an ephemeral uploaded-file workspace.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub Actions Runner failed.";
    await report(assignment, nextEventSeq, "github_actions.failed", "failed", message).catch(() => undefined);
    throw error;
  } finally {
    await rm(inputDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "GitHub Actions Runner failed.");
  process.exitCode = 1;
});
