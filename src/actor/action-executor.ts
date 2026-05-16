import { nowIso } from "../utils/id.js";
import { ToolRegistry } from "../tools/tool-registry.js";
import type { AgentAction, ActionExecutionResult, PolicyDecision, ToolContext } from "../types.js";

export class ActionExecutor {
  constructor(private readonly tools = new ToolRegistry()) {}

  async executeAllowed(
    decisions: PolicyDecision[],
    context: ToolContext = {},
  ): Promise<ActionExecutionResult[]> {
    const results: ActionExecutionResult[] = [];

    for (const decision of decisions) {
      if (decision.status !== "allow") {
        results.push({
          action: decision.action,
          status: "skipped",
          output: `Skipped ${decision.action.type}: ${decision.reason}`,
          createdAt: nowIso(),
        });
        continue;
      }

      results.push(await this.execute(decision.action, context));
    }

    return results;
  }

  private async execute(action: AgentAction, context: ToolContext): Promise<ActionExecutionResult> {
    try {
      if (action.type === "say") {
        return executed(action, action.content);
      }

      if (action.type === "remember") {
        return executed(action, `Remember request accepted: ${action.content}`);
      }

      if (action.type === "wait") {
        return executed(action, `Waited: ${action.content}`);
      }

      if (action.type === "ask-user") {
        return executed(action, action.content);
      }

      if (action.type === "tool") {
        const toolName = typeof action.metadata?.toolName === "string" ? action.metadata.toolName : undefined;
        const tool = toolName ? this.tools.get(toolName) : undefined;
        if (!toolName || !tool) {
          return {
            action,
            status: "skipped",
            output: `No registered tool found for ${toolName ?? "unknown"}.`,
            createdAt: nowIso(),
          };
        }

        const input =
          action.metadata?.input && typeof action.metadata.input === "object"
            ? (action.metadata.input as Record<string, unknown>)
            : undefined;
        const result = await tool.execute(input, context);
        return executed(action, result.output, {
          toolName: result.toolName,
          toolMetadata: result.metadata,
        });
      }

      return {
        action,
        status: "skipped",
        output: `No executor registered for ${action.type}.`,
        createdAt: nowIso(),
      };
    } catch (error) {
      return {
        action,
        status: "failed",
        output: `Failed to execute ${action.type}.`,
        error: formatExecutionError(error),
        createdAt: nowIso(),
      };
    }
  }
}

function formatExecutionError(error: unknown): string {
  if (!error || typeof error !== "object") {
    return String(error);
  }

  const candidate = error as {
    message?: string;
    stdout?: string;
    stderr?: string;
  };

  return [candidate.message, candidate.stdout, candidate.stderr]
    .filter((part): part is string => Boolean(part))
    .join("\n")
    .slice(0, 4000);
}

function executed(
  action: AgentAction,
  output: string,
  metadata?: Record<string, unknown>,
): ActionExecutionResult {
  return {
    action,
    status: "executed",
    output,
    createdAt: nowIso(),
    metadata,
  };
}
