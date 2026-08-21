import { describe, expect, it } from "vitest";
import { LOCAL_BROWSER_TOOL_ALLOWLIST, LOCAL_FILE_TOOL_ALLOWLIST, getLocalActionPolicy } from "./localPolicy";

describe("Palm Local Runner action policy", () => {
  it("exposes only the default read-oriented file tools", () => {
    expect(LOCAL_FILE_TOOL_ALLOWLIST).toEqual(["inventory_files", "extract_text_metadata", "profile_csv", "write_result_record"]);
    expect(getLocalActionPolicy("Inventory my project files")).toMatchObject({ requiresApproval: false, allowedTools: LOCAL_FILE_TOOL_ALLOWLIST, inputBoundary: "PALM_INPUT_DIR", outputBoundary: "PALM_RUNNER_DIR" });
  });

  it.each(["Delete old files", "Rename the report", "Email the spreadsheet", "Run a shell command"]) ("requires approval for %s", prompt => {
    expect(getLocalActionPolicy(prompt)).toMatchObject({ requiresApproval: true, approvalReason: expect.stringContaining("local file mutation") });
  });

  it("gives browser runners a read-only tool surface and a device navigation boundary", () => {
    expect(getLocalActionPolicy("Read the documentation", "browser")).toMatchObject({ requiresApproval: false, allowedBrowserTools: LOCAL_BROWSER_TOOL_ALLOWLIST, navigationBoundary: "device_allowlist" });
  });
});
