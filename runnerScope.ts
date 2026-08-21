export const DEFAULT_RUNNER_SKILLS = ["web-research", "document-intelligence", "code-workspace", "data-analysis", "visual-creation", "workflow-automation"] as const;
export const DEFAULT_SENSITIVE_ACTIONS = ["file_mutation", "external_sharing", "command_execution", "browser_control"] as const;
export const DEFAULT_BROWSER_TOOLS = ["open_tab", "navigate", "screenshot", "read_page_text", "close_tab"] as const;

function readScope(value: string | undefined, fallback: readonly string[]) {
  try {
    const parsed = value ? JSON.parse(value) : null;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [...fallback];
  } catch { return [...fallback]; }
}

export function resolveRunnerScopePreservation(existing: { allowedSkillSlugsJson?: string; allowedSensitiveActionsJson?: string; allowedBrowserToolsJson?: string; navigationAllowlistJson?: string; requiresApprovalForBrowserWrites?: boolean } | undefined, patch: { allowedSkillSlugs?: string[]; allowedSensitiveActions?: string[]; allowedBrowserTools?: string[]; navigationAllowlist?: string[]; requiresApprovalForBrowserWrites?: boolean }) {
  return {
    allowedSkillSlugs: patch.allowedSkillSlugs ?? readScope(existing?.allowedSkillSlugsJson, DEFAULT_RUNNER_SKILLS),
    allowedSensitiveActions: patch.allowedSensitiveActions ?? readScope(existing?.allowedSensitiveActionsJson, DEFAULT_SENSITIVE_ACTIONS),
    allowedBrowserTools: patch.allowedBrowserTools ?? readScope(existing?.allowedBrowserToolsJson, DEFAULT_BROWSER_TOOLS),
    navigationAllowlist: patch.navigationAllowlist ?? readScope(existing?.navigationAllowlistJson, []),
    requiresApprovalForBrowserWrites: patch.requiresApprovalForBrowserWrites ?? existing?.requiresApprovalForBrowserWrites ?? true,
  };
}
