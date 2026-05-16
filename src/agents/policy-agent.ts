import { ToolRegistry } from "../tools/tool-registry.js";
import type { Agent, AgentAction, AgentContext, AgentProposal, PolicyDecision } from "../types.js";

export class PolicyAgent implements Agent {
  readonly id = "policy" as const;
  readonly role = "Classifies action risk and enforces confirmation gates.";

  constructor(private readonly tools = new ToolRegistry()) {}

  async run(_context: AgentContext): Promise<AgentProposal> {
    return {
      agentId: this.id,
      intent: "policy-ready",
      confidence: 0.9,
      content: "Policy gate is active for action risk classification.",
    };
  }

  review(action: AgentAction): PolicyDecision {
    if (action.type === "say" || action.type === "wait" || action.type === "remember") {
      return {
        action,
        risk: "safe",
        status: "allow",
        reason: "Internal or conversational action with no external side effect.",
      };
    }

    if (action.type === "ask-user") {
      return {
        action,
        risk: "low",
        status: "allow",
        reason: "Asking the user is a low-risk clarification action.",
      };
    }

    if (action.type === "tool") {
      const toolName = typeof action.metadata?.toolName === "string" ? action.metadata.toolName : undefined;
      const risk = toolName ? this.tools.riskOf(toolName) : undefined;
      const confirmed = action.metadata?.confirmed === true;

      if (risk === "safe") {
        return {
          action,
          risk: "low",
          status: "allow",
          reason: `Read-only safe tool '${toolName}' is allowed.`,
        };
      }

      if (confirmed && (risk === "medium" || risk === "high")) {
        return {
          action,
          risk,
          status: "allow",
          reason: `Tool '${toolName}' was explicitly confirmed and may run.`,
        };
      }

      return {
        action,
        risk: risk === "high" ? "high" : "medium",
        status: "confirm",
        reason: toolName
          ? `Tool '${toolName}' is not classified as safe and requires confirmation.`
          : "Tool actions without a registered toolName require confirmation.",
      };
    }

    if (action.type === "file-write") {
      return {
        action,
        risk: "medium",
        status: "confirm",
        reason: "Writing files changes user workspace state and requires confirmation.",
      };
    }

    if (action.type === "external-message" || action.type === "delete-data") {
      return {
        action,
        risk: "high",
        status: "confirm",
        reason: "High-risk external or destructive action requires explicit user confirmation.",
      };
    }

    return {
      action,
      risk: "blocked",
      status: "block",
      reason: "Unknown action type is blocked by default.",
    };
  }
}
