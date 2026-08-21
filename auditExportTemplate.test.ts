import { describe, expect, it } from "vitest";
import { applyDeviceAuditExportTemplate, restoreAuditExportTemplateColumns } from "../client/src/lib/auditExportTemplate";
import { serializeAuditCsv } from "../client/src/lib/auditCsv";

describe("Palm device CSV export templates", () => {
  it("restores a device template in canonical column order", () => {
    expect(restoreAuditExportTemplateColumns('["metadata","detail","device"]')).toEqual(["device", "detail", "metadata"]);
  });

  it("falls back to the full stable column set for malformed templates", () => {
    expect(restoreAuditExportTemplateColumns("not-json")).toEqual(["timestamp", "event_type", "device", "runner_id", "task_id", "approval_id", "detail", "metadata"]);
  });

  it("applies a template’s columns to the actual CSV output only for its owning device", () => {
    const templates = [{ id: 1, runnerId: 9, columnsJson: '["detail","device"]' }, { id: 2, runnerId: 10, columnsJson: '["timestamp","metadata"]' }];
    const columns = applyDeviceAuditExportTemplate(templates, 9, 1);
    const csv = serializeAuditCsv([{ id: 1, createdAt: "2026-08-21T12:00:00.000Z", eventType: "runner.heartbeat", detail: "Online", runnerId: 9 }], new Map([[9, "Studio Mac"]]), columns ?? []);
    expect(csv.split("\n")[0]).toBe('"device","detail"');
    expect(csv.split("\n")[1]).toBe('"Studio Mac","Online"');
    expect(applyDeviceAuditExportTemplate(templates, 10, 1)).toBeNull();
  });
});
