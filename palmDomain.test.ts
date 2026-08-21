import { describe, expect, it } from "vitest";
import { createInitialWorkflowSteps, deriveTaskTitle, mergeSkillPreferences } from "./palmDomain";

describe("Palm action workflow domain", () => {
  it("creates a clear ordered workflow with one active starting step", () => {
    const steps = createInitialWorkflowSteps();

    expect(steps.map(step => step.stepOrder)).toEqual([1, 2, 3, 4]);
    expect(steps.every(step => step.status === "pending")).toBe(true);
    expect(steps[0]?.kind).toBe("plan");
  });

  it("applies a user's saved skill preference while defaulting other skills to enabled", () => {
    const skills = mergeSkillPreferences([{ skillSlug: "code-workspace", enabled: false }]);

    expect(skills.find(skill => skill.slug === "code-workspace")?.enabled).toBe(false);
    expect(skills.find(skill => skill.slug === "web-research")?.enabled).toBe(true);
  });

  it("derives a compact task title without losing the prompt intent", () => {
    expect(deriveTaskTitle("  Build a polished research brief for the product launch  "))
      .toBe("Build a polished research brief for the product launch");
  });
});
