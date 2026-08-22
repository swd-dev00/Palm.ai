import { describe, expect, it } from "vitest";
import { restoreAuditPresetFilters } from "./client/src/lib/auditPreset";

describe("Palm saved audit filter presets", () => {
  it("restores persisted device, event type, and date filters for the audit controls", () => {
    expect(restoreAuditPresetFilters('{"runnerId":9,"eventType":"runner.heartbeat","startDate":"2026-08-01","endDate":"2026-08-21"}')).toEqual({ runnerId: "9", eventType: "runner.heartbeat", startDate: "2026-08-01", endDate: "2026-08-21" });
  });

  it("falls back safely for malformed preset JSON", () => {
    expect(restoreAuditPresetFilters("not-json")).toEqual({ runnerId: "all", eventType: "all", startDate: "", endDate: "" });
  });
});
