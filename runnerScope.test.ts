import { describe, expect, it } from "vitest";
import { resolveRunnerScopePreservation } from "./runnerScope";

describe("Palm Local Runner scope preservation", () => {
  it("retains custom capability and action scopes when a tool-only edit is saved", () => {
    const existing = {
      allowedSkillSlugsJson: '["document-intelligence"]',
      allowedSensitiveActionsJson: '["file_mutation"]',
    };
    expect(resolveRunnerScopePreservation(existing, {})).toEqual({
      allowedSkillSlugs: ["document-intelligence"],
      allowedSensitiveActions: ["file_mutation"],
    });
  });

  it("uses an explicitly supplied device capability or action selection instead of a preserved value", () => {
    const existing = { allowedSkillSlugsJson: '["document-intelligence"]', allowedSensitiveActionsJson: '["file_mutation"]' };
    expect(resolveRunnerScopePreservation(existing, { allowedSkillSlugs: ["data-analysis"], allowedSensitiveActions: [] })).toEqual({
      allowedSkillSlugs: ["data-analysis"],
      allowedSensitiveActions: [],
    });
  });
});
