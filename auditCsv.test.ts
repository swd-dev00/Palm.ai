import { describe, expect, it } from "vitest";
import { serializeAuditCsv } from "../client/src/lib/auditCsv";

describe("Palm Local Runner audit CSV export", () => {
  it("writes a stable header and escapes evidence details safely", () => {
    const csv = serializeAuditCsv([{ id: 1, createdAt: "2026-08-21T12:00:00.000Z", eventType: "approval.requested", detail: 'Requested "review" for a local action.', runnerId: 9, taskId: 22, approvalId: 4, metadataJson: '{"expiryMinutes":15}' }], new Map([[9, "Studio Mac"]]));
    expect(csv).toContain('"timestamp","event_type","device","runner_id","task_id","approval_id","detail","metadata"');
    expect(csv).toContain('"Studio Mac"');
    expect(csv).toContain('"Requested ""review"" for a local action."');
  });

  it("exports only selected audit columns in canonical stable order after reselecting fields", () => {
    const csv = serializeAuditCsv([{ id: 2, createdAt: "2026-08-21T12:00:00.000Z", eventType: "runner.heartbeat", detail: "Online", runnerId: 9 }], new Map([[9, "Studio Mac"]]), ["device", "event_type", "detail"]);
    expect(csv.split("\n")[0]).toBe('"event_type","device","detail"');
    expect(csv.split("\n")[1]).toBe('"runner.heartbeat","Studio Mac","Online"');
  });
});
