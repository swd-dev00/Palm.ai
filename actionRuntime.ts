import { invokeLLM, type Message, type Tool } from "./_core/llm";
import {
  addAssistantMessage,
  getSkillCatalog,
  getTaskDetail,
  updateExecutionStep,
  updateTaskStatus,
} from "./db";
import { formatCsvProfileEvidence, profileCsvAttachment } from "./csvProfile";

export type PalmExecutionEvent = {
  type: "trace" | "complete" | "error";
  stepOrder?: number;
  status?: "pending" | "running" | "completed" | "error";
  detail?: string;
  content?: string;
};

function textFromModelContent(content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } } | { type: "file_url"; file_url: { url: string } }>) {
  if (typeof content === "string") return content;
  return content.filter(part => part.type === "text").map(part => part.text).join("\n");
}

const MAX_ATTACHMENT_TOOL_ITERATIONS = 3;

const attachmentTools: Tool[] = [{
  type: "function",
  function: {
    name: "profile_csv",
    description: "Profile one attached CSV using Palm's allowlisted read-only file tool. Returns factual headers, row count, and numeric summaries.",
    parameters: { type: "object", properties: { attachmentId: { type: "integer", description: "The numeric ID of the attached CSV to profile." } }, required: ["attachmentId"], additionalProperties: false },
  },
}];

async function dispatchAttachmentTool(input: { name: string; argumentsJson: string; attachments: Array<{ id: number; originalName: string; mimeType: string; fileSize: number; storageKey: string }> }) {
  if (input.name !== "profile_csv") return { ok: false, error: `Tool ${input.name} is not available in this attachment-scoped runtime.` };
  try {
    const args = JSON.parse(input.argumentsJson) as { attachmentId?: number };
    const attachment = input.attachments.find(item => item.id === args.attachmentId);
    if (!attachment) return { ok: false, error: "profile_csv requires the ID of an attached CSV file." };
    const profile = await profileCsvAttachment(attachment);
    if (!profile) return { ok: false, error: `${attachment.originalName} is not a CSV attachment.` };
    return { ok: true, tool: "profile_csv", profile, summary: formatCsvProfileEvidence([profile]) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Palm could not execute profile_csv." };
  }
}

export async function runPalmTask(input: { taskId: number; userId: number; onEvent?: (event: PalmExecutionEvent) => void }) {
  const detail = await getTaskDetail(input.userId, input.taskId);
  if (!detail) throw new Error("Task not found");

  const emit = (event: PalmExecutionEvent) => input.onEvent?.(event);
  const updateStep = async (stepOrder: number, status: "pending" | "running" | "completed" | "error", detailText: string) => {
    await updateExecutionStep(input.taskId, stepOrder, status, detailText);
    emit({ type: "trace", stepOrder, status, detail: detailText });
  };

  await updateTaskStatus(input.taskId, "running");
  await updateStep(1, "running", "Palm accepted this delegated objective in the current workspace session.");
  await updateStep(1, "completed", "The objective was recorded and prepared for capability selection.");
  await updateStep(2, "running", "Palm is loading the enabled capability preferences for this workspace.");
  const enabledSkills = (await getSkillCatalog(input.userId)).filter(skill => skill.enabled).map(skill => skill.name);
  await updateStep(2, "completed", enabledSkills.length ? `Loaded enabled capability preferences: ${enabledSkills.join(", ")}.` : "No optional capability preferences are enabled.");
  await updateStep(3, "running", "A Palm language model request is in progress.");

  try {
    const cloudAttachments = detail.attachments.filter((attachment): attachment is typeof attachment & { storageKey: string } => Boolean(attachment.storageKey));
    const attachmentContext = detail.attachments.length
      ? `\nAttached context: ${detail.attachments.map(file => `${file.originalName} (attachment ID ${file.id}${file.source === "local_reference" ? "; local-only" : ""})`).join(", ")}. Use profile_csv when factual CSV structure or numeric evidence would improve the response.`
      : "";
    const messages: Message[] = [
      { role: "system", content: `You are Palm, a purposeful action-engine assistant. Enabled workspace capabilities: ${enabledSkills.join(", ") || "none"}. Give a useful, concrete response to the delegated objective. Use profile_csv for attached CSV evidence when needed, then reason from its factual rows, headers, and numeric summaries rather than claiming the dataset is unavailable or inventing values. Be candid about limitations. Do not reveal private chain-of-thought; instead provide a brief, user-facing execution summary when helpful. Use Markdown with concise headings and actionable next steps.` },
      { role: "user", content: `${detail.task.prompt}${attachmentContext}` },
    ];
    let content = "";
    let executedToolCalls = 0;
    for (let iteration = 0; iteration < MAX_ATTACHMENT_TOOL_ITERATIONS; iteration += 1) {
      const response = await invokeLLM({ maxTokens: 1400, messages, tools: attachmentTools, toolChoice: "auto" });
      const assistant = response.choices[0]?.message;
      if (!assistant) throw new Error("Palm did not receive a model message.");
      content = textFromModelContent(assistant.content).trim();
      const toolCalls = assistant.tool_calls ?? [];
      if (!toolCalls.length) break;
      messages.push({ role: "assistant", content: assistant.content, tool_calls: toolCalls });
      for (const toolCall of toolCalls) {
        const result = await dispatchAttachmentTool({ name: toolCall.function.name, argumentsJson: toolCall.function.arguments, attachments: cloudAttachments });
        executedToolCalls += 1;
        await updateStep(3, "running", result.ok ? `Palm executed the allowlisted ${toolCall.function.name} tool for attached evidence.` : `Palm could not complete ${toolCall.function.name}: ${result.error}`);
        messages.push({ role: "tool", name: toolCall.function.name, tool_call_id: toolCall.id, content: JSON.stringify(result) });
      }
    }
    const finalContent = content || (executedToolCalls >= MAX_ATTACHMENT_TOOL_ITERATIONS ? "Palm reached the attachment tool iteration limit before receiving a final model response." : "Palm completed the workflow but did not receive a readable response.");
    await updateStep(3, "completed", executedToolCalls ? `Palm combined ${executedToolCalls} allowlisted attachment tool result${executedToolCalls === 1 ? "" : "s"} with the language model response.` : "The language model response was received by the Palm action runtime.");
    await updateStep(4, "completed", "The deliverable was persisted and is ready to review or download.");
    await addAssistantMessage(input.taskId, finalContent);
    await updateTaskStatus(input.taskId, "completed", { assistantResponse: finalContent });
    emit({ type: "complete", content: finalContent });
    return { content: finalContent };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Palm could not complete this task.";
    await updateStep(3, "error", "The language model request did not complete successfully.");
    await updateTaskStatus(input.taskId, "error", { errorMessage });
    emit({ type: "error", detail: errorMessage });
    throw new Error(errorMessage);
  }
}
