export const PALM_SKILLS = [
  {
    slug: "web-research",
    name: "Web research",
    description: "Synthesizes public sources into concise, cited findings.",
    category: "Research",
    icon: "Globe2",
  },
  {
    slug: "document-intelligence",
    name: "Document intelligence",
    description: "Extracts, summarizes, and compares supplied documents.",
    category: "Analyze",
    icon: "FileSearch",
  },
  {
    slug: "code-workspace",
    name: "Code workspace",
    description: "Plans implementation work and produces structured code outputs.",
    category: "Build",
    icon: "Code2",
  },
  {
    slug: "data-analysis",
    name: "Data analysis",
    description: "Explores structured data and produces clear analytical summaries.",
    category: "Analyze",
    icon: "ChartNoAxesCombined",
  },
  {
    slug: "visual-creation",
    name: "Visual creation",
    description: "Prepares image-generation briefs and visual concepts.",
    category: "Create",
    icon: "Sparkles",
  },
  {
    slug: "workflow-automation",
    name: "Workflow automation",
    description: "Designs multi-step operational flows with review points.",
    category: "Automate",
    icon: "Workflow",
  },
] as const;

export type PalmSkill = (typeof PALM_SKILLS)[number];

export type InitialStep = {
  stepOrder: number;
  kind: "plan" | "tool" | "decision" | "result";
  status: "pending" | "running" | "completed" | "error";
  label: string;
  detail: string;
  toolName?: string;
};

export function deriveTaskTitle(prompt: string): string {
  const singleLine = prompt.replace(/\s+/g, " ").trim();
  if (!singleLine) return "Untitled workflow";
  return singleLine.length > 72 ? `${singleLine.slice(0, 69).trimEnd()}…` : singleLine;
}

export function createInitialWorkflowSteps(): InitialStep[] {
  return [
    {
      stepOrder: 1,
      kind: "plan",
      status: "pending",
      label: "Frame the objective",
      detail: "Waiting for Palm to accept the delegated objective.",
    },
    {
      stepOrder: 2,
      kind: "decision",
      status: "pending",
      label: "Select capabilities",
      detail: "Eligible skills are checked against the task and user preferences.",
    },
    {
      stepOrder: 3,
      kind: "tool",
      status: "pending",
      label: "Execute the work",
      detail: "The action engine composes a focused result from the approved task context.",
      toolName: "Palm action runtime",
    },
    {
      stepOrder: 4,
      kind: "result",
      status: "pending",
      label: "Prepare deliverable",
      detail: "The response and available task artifacts are prepared for review.",
    },
  ];
}

export function mergeSkillPreferences(
  preferences: Array<{ skillSlug: string; enabled: boolean }>
) {
  const preferenceMap = new Map(preferences.map(item => [item.skillSlug, item.enabled]));
  return PALM_SKILLS.map(skill => ({
    ...skill,
    enabled: preferenceMap.get(skill.slug) ?? true,
  }));
}
