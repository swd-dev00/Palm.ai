import { describe, expect, it } from "vitest";
import { resolveRunnerScopePreservation } from "../client/src/lib/runnerScope";

describe("Palm Local Runner scope preservation", () => {
  it("retains custom capability and action scopes when a tool-only edit is saved", () => {
    const existing = { allowedSkillSlugsJson: '["document-intelligence"]', allowedSensitiveActionsJson: '["file_mutation"]' };
    expect(resolveRunnerScopePreservation(existing, {})).toEqual({ allowedSkillSlugs: ["document-intelligence"], allowedSensitiveActions: ["file_mutation"], allowedBrowserTools: ["open_tab", "navigate", "screenshot", "read_page_text", "close_tab"], navigationAllowlist: [], requiresApprovalForBrowserWrites: true });
  });

  it("uses explicitly selected capability and action scopes when supplied", () => {
    const existing = { allowedSkillSlugsJson: '["document-intelligence"]', allowedSensitiveActionsJson: '["file_mutation"]' };
    expect(resolveRunnerScopePreservation(existing, { allowedSkillSlugs: ["data-analysis"], allowedSensitiveActions: [] })).toEqual({ allowedSkillSlugs: ["data-analysis"], allowedSensitiveActions: [], allowedBrowserTools: ["open_tab", "navigate", "screenshot", "read_page_text", "close_tab"], navigationAllowlist: [], requiresApprovalForBrowserWrites: true });
  });
});
