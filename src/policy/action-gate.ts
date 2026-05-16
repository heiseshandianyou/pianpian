import { PolicyAgent } from "../agents/policy-agent.js";
import type { AgentAction, PolicyDecision } from "../types.js";

export class ActionGate {
  constructor(private readonly policy = new PolicyAgent()) {}

  review(actions: AgentAction[]): PolicyDecision[] {
    return actions.map((action) => this.policy.review(action));
  }

  filterAllowed(decisions: PolicyDecision[]): AgentAction[] {
    return decisions
      .filter((decision) => decision.status === "allow")
      .map((decision) => decision.action);
  }

  toUserVisibleActions(decisions: PolicyDecision[]): AgentAction[] {
    const allowed = this.filterAllowed(decisions);
    const gated = decisions.filter((decision) => decision.status !== "allow");

    if (gated.length === 0) {
      return allowed;
    }

    return [
      ...allowed,
      ...gated.map((decision) => ({
        type: "ask-user" as const,
        content: `Confirmation required before ${decision.action.type}: ${decision.reason}`,
        metadata: {
          originalAction: decision.action,
          risk: decision.risk,
          status: decision.status,
        },
      })),
    ];
  }
}
