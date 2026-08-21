export const LOCAL_FILE_TOOL_ALLOWLIST = [
  "inventory_files",
  "extract_text_metadata",
  "profile_csv",
  "write_result_record",
] as const;

export type LocalFileTool = (typeof LOCAL_FILE_TOOL_ALLOWLIST)[number];

export const LOCAL_BROWSER_TOOL_ALLOWLIST = ["open_tab", "navigate", "screenshot", "read_page_text", "close_tab"] as const;
export const LOCAL_BROWSER_WRITE_TOOLS = ["click_element", "type_text", "submit_form"] as const;
export const LOCAL_BROWSER_ALL_TOOLS = [...LOCAL_BROWSER_TOOL_ALLOWLIST, ...LOCAL_BROWSER_WRITE_TOOLS] as const;
export type LocalBrowserTool = (typeof LOCAL_BROWSER_ALL_TOOLS)[number];

export const LOCAL_SENSITIVE_ACTION_CLASSES = ["file_mutation", "external_sharing", "command_execution", "browser_control"] as const;
export type LocalSensitiveActionClass = (typeof LOCAL_SENSITIVE_ACTION_CLASSES)[number];
export type LocalRunnerType = "file" | "browser";

const SENSITIVE_PATTERNS: Array<{ actionClass: LocalSensitiveActionClass; pattern: RegExp }> = [
  { actionClass: "file_mutation", pattern: /\b(delete|remove|erase|wipe|destroy|rename|move|relocate|overwrite|replace)\b/i },
  { actionClass: "external_sharing", pattern: /\b(upload|share|send|email|publish|post)\b/i },
  { actionClass: "command_execution", pattern: /\b(run|execute)\b.*\b(command|shell|script|terminal)\b/i },
];

export type LocalActionPolicy = {
  allowedTools: LocalFileTool[];
  allowedBrowserTools?: LocalBrowserTool[];
  requiresApproval: boolean;
  sensitiveActionClass?: LocalSensitiveActionClass;
  approvalReason?: string;
  inputBoundary: "PALM_INPUT_DIR";
  outputBoundary: "PALM_RUNNER_DIR";
  navigationBoundary?: "device_allowlist";
};

export function getLocalActionPolicy(prompt: string, runnerType: LocalRunnerType = "file"): LocalActionPolicy {
  if (runnerType === "browser") {
    return {
      allowedTools: [],
      allowedBrowserTools: [...LOCAL_BROWSER_TOOL_ALLOWLIST],
      requiresApproval: false,
      inputBoundary: "PALM_INPUT_DIR",
      outputBoundary: "PALM_RUNNER_DIR",
      navigationBoundary: "device_allowlist",
    };
  }
  const requestedSensitiveOperation = SENSITIVE_PATTERNS.find(({ pattern }) => pattern.test(prompt));
  return {
    allowedTools: [...LOCAL_FILE_TOOL_ALLOWLIST],
    requiresApproval: Boolean(requestedSensitiveOperation),
    ...(requestedSensitiveOperation ? { sensitiveActionClass: requestedSensitiveOperation.actionClass, approvalReason: "This task requests a local file mutation, external sharing action, or command execution." } : {}),
    inputBoundary: "PALM_INPUT_DIR",
    outputBoundary: "PALM_RUNNER_DIR",
  };
}
