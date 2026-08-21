import { describe, expect, it } from "vitest";
import { formatCsvProfileEvidence, profileCsvText } from "./csvProfile";

describe("Palm allowlisted CSV profiler", () => {
  it("extracts factual headers, row count, and numeric summaries without inventing values", () => {
    const profile = profileCsvText("margin-ledger.csv", "customer,revenue,cost\nNorth,1200,725\nSouth,800,500\n");
    expect(profile).toMatchObject({ tool: "profile_csv", fileName: "margin-ledger.csv", rowCount: 2, headers: ["customer", "revenue", "cost"] });
    expect(profile.columns.find(column => column.name === "revenue")).toMatchObject({ numericCount: 2, min: 800, max: 1200, mean: 1000 });
    expect(formatCsvProfileEvidence([profile])).toContain("2 data rows");
    expect(formatCsvProfileEvidence([profile])).toContain("revenue: n=2, min=800, max=1200, mean=1000");
  });
});
