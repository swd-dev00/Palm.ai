import { storageGetSignedUrl } from "./storage";
import { LOCAL_FILE_TOOL_ALLOWLIST } from "./localPolicy";

export type CsvColumnProfile = {
  name: string;
  nonEmpty: number;
  numericCount: number;
  min?: number;
  max?: number;
  mean?: number;
};

export type CsvProfileEvidence = {
  tool: "profile_csv";
  fileName: string;
  rowCount: number;
  headers: string[];
  columns: CsvColumnProfile[];
};

const MAX_CSV_BYTES = 5 * 1024 * 1024;

function parseCsvRows(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(value); value = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(value); value = "";
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
    } else value += character;
  }
  row.push(value);
  if (row.some(cell => cell.trim())) rows.push(row);
  return rows;
}

function numericValue(value: string) {
  const normalized = value.trim().replace(/[$,%\s,]/g, "").replace(/^\((.+)\)$/, "-$1");
  if (!normalized || !/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function profileCsvText(fileName: string, input: string): CsvProfileEvidence {
  const rows = parseCsvRows(input);
  if (!rows.length) return { tool: "profile_csv", fileName, rowCount: 0, headers: [], columns: [] };
  const headers = rows[0].map((header, index) => header.trim() || `column_${index + 1}`);
  const records = rows.slice(1);
  const columns = headers.map((name, index) => {
    const values = records.map(row => row[index]?.trim() ?? "");
    const numeric = values.map(numericValue).filter((value): value is number => value !== null);
    return {
      name,
      nonEmpty: values.filter(Boolean).length,
      numericCount: numeric.length,
      ...(numeric.length ? { min: Math.min(...numeric), max: Math.max(...numeric), mean: Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(4)) } : {}),
    };
  });
  return { tool: "profile_csv", fileName, rowCount: records.length, headers, columns };
}

export async function profileCsvAttachment(attachment: { originalName: string; mimeType: string; fileSize: number; storageKey: string }) {
  if (!LOCAL_FILE_TOOL_ALLOWLIST.includes("profile_csv")) throw new Error("profile_csv is not allowlisted.");
  if (!attachment.originalName.toLowerCase().endsWith(".csv") && attachment.mimeType !== "text/csv") return null;
  if (attachment.fileSize > MAX_CSV_BYTES) throw new Error(`${attachment.originalName} exceeds the ${MAX_CSV_BYTES / (1024 * 1024)} MB CSV profiling limit.`);
  const url = await storageGetSignedUrl(attachment.storageKey);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Palm could not read attached CSV ${attachment.originalName}.`);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_CSV_BYTES) throw new Error(`${attachment.originalName} exceeds the CSV profiling limit after download.`);
  return profileCsvText(attachment.originalName, text);
}

export function formatCsvProfileEvidence(profiles: CsvProfileEvidence[]) {
  if (!profiles.length) return "";
  return profiles.map(profile => {
    const numeric = profile.columns.filter(column => column.numericCount > 0).map(column => `${column.name}: n=${column.numericCount}, min=${column.min}, max=${column.max}, mean=${column.mean}`).join("; ");
    return `profile_csv evidence for ${profile.fileName}: ${profile.rowCount} data rows; columns: ${profile.headers.join(", ")}.${numeric ? ` Numeric summaries: ${numeric}.` : ""}`;
  }).join("\n");
}
