export type AuditPresetFilters = { runnerId: string; eventType: string; startDate: string; endDate: string };

export const emptyAuditPresetFilters: AuditPresetFilters = { runnerId: "all", eventType: "all", startDate: "", endDate: "" };

export function restoreAuditPresetFilters(filterJson: string): AuditPresetFilters {
  try {
    const raw = JSON.parse(filterJson);
    return {
      runnerId: typeof raw.runnerId === "number" && raw.runnerId > 0 ? String(raw.runnerId) : "all",
      eventType: typeof raw.eventType === "string" && raw.eventType ? raw.eventType : "all",
      startDate: typeof raw.startDate === "string" ? raw.startDate : "",
      endDate: typeof raw.endDate === "string" ? raw.endDate : "",
    };
  } catch { return { ...emptyAuditPresetFilters }; }
}
