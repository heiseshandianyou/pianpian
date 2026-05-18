import type { ActionExecutionResult, AgentAction } from "../types.js";

export function planToolRecovery(result: ActionExecutionResult): AgentAction | undefined {
  if (result.action.type !== "tool" || result.status !== "failed") {
    return undefined;
  }

  if (result.action.metadata?.recoveryAttempt === true) {
    return undefined;
  }

  const toolName = typeof result.action.metadata?.toolName === "string" ? result.action.metadata.toolName : undefined;
  if (!toolName || !isRetryableTool(toolName, result.action)) {
    return undefined;
  }

  if (!isRetryableFailure(result)) {
    return undefined;
  }

  return {
    ...result.action,
    content: `Retry after tool execution failure: ${result.action.content}`,
    metadata: {
      ...result.action.metadata,
      recoveryAttempt: true,
      recoveryReason: firstLine(result.error ?? result.output),
      source: "tool-recovery-planner",
    },
  };
}

function isRetryableTool(toolName: string, action: AgentAction): boolean {
  if (["memory.stats", "project.status", "memory.inspect", "workspace.list", "workspace.read", "workspace.search"].includes(toolName)) {
    return true;
  }

  if (toolName === "workspace.command" || toolName === "codex.run") {
    return action.metadata?.confirmed === true || (action.metadata?.autonomous === true && action.metadata?.trusted === true);
  }

  return false;
}

function isRetryableFailure(result: ActionExecutionResult): boolean {
  const signal = `${result.output}\n${result.error ?? ""}`.toLowerCase();
  return [
    "eperm",
    "enoent",
    "einval",
    "spawn",
    "timeout",
    "temporarily unavailable",
  ].some((term) => signal.includes(term));
}

function firstLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown tool failure";
}
