export type AuditExportRow = {
  id: number;
  createdAt: Date | string;
  eventType: string;
  detail: string;
  runnerId?: number | null;
  taskId?: number | null;
  approvalId?: number | null;
  metadataJson?: string | null;
};

export const AUDIT_EXPORT_COLUMNS = ["timestamp", "event_type", "device", "runner_id", "task_id", "approval_id", "detail", "metadata"] as const;
export type AuditExportColumn = (typeof AUDIT_EXPORT_COLUMNS)[number];

const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export function serializeAuditCsv(events: AuditExportRow[], runnerLabels: Map<number, string>, columns: AuditExportColumn[] = [...AUDIT_EXPORT_COLUMNS]) {
  const selected = new Set(columns.length ? columns : AUDIT_EXPORT_COLUMNS);
  const selectedColumns = AUDIT_EXPORT_COLUMNS.filter(column => selected.has(column));
  const valueFor = (event: AuditExportRow, column: AuditExportColumn) => ({
    timestamp: new Date(event.createdAt).toISOString(),
    event_type: event.eventType,
    device: event.runnerId ? runnerLabels.get(event.runnerId) ?? "Unknown device" : "Workspace",
    runner_id: event.runnerId,
    task_id: event.taskId,
    approval_id: event.approvalId,
    detail: event.detail,
    metadata: event.metadataJson,
  })[column];
  const lines = events.map(event => selectedColumns.map(column => valueFor(event, column)).map(escape).join(","));
  return [selectedColumns.map(escape).join(","), ...lines].join("\n");
}
