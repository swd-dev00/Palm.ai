import { AUDIT_EXPORT_COLUMNS, type AuditExportColumn } from "./auditCsv";

export function restoreAuditExportTemplateColumns(columnsJson: string): AuditExportColumn[] {
  try {
    const raw = JSON.parse(columnsJson);
    if (!Array.isArray(raw)) return [...AUDIT_EXPORT_COLUMNS];
    const selected = new Set(raw.filter((value): value is AuditExportColumn => typeof value === "string" && (AUDIT_EXPORT_COLUMNS as readonly string[]).includes(value)));
    const normalized = AUDIT_EXPORT_COLUMNS.filter(column => selected.has(column));
    return normalized.length ? normalized : [...AUDIT_EXPORT_COLUMNS];
  } catch { return [...AUDIT_EXPORT_COLUMNS]; }
}

export function applyDeviceAuditExportTemplate(templates: Array<{ id: number; runnerId: number; columnsJson: string }>, runnerId: number, templateId: number) {
  const template = templates.find(item => item.id === templateId && item.runnerId === runnerId);
  return template ? restoreAuditExportTemplateColumns(template.columnsJson) : null;
}
