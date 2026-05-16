import type { Agent, AgentContext, AgentProposal } from "../types.js";

export class PlannerAgent implements Agent {
  readonly id = "planner" as const;
  readonly role = "Turns goals and context into the next concrete step.";

  async run(context: AgentContext): Promise<AgentProposal> {
    const compiled = context.compiledContext;
    const goalBasis =
      compiled?.goals && compiled.goals !== "None activated."
        ? compiled.goals
        : "Create a durable autonomous multi-agent core.";
    const focus =
      compiled?.focus && compiled.focus !== "None activated."
        ? compiled.focus
        : "Keep the runtime small, observable, and memory-centered.";

    return {
      agentId: this.id,
      intent: "propose-next-step",
      confidence: 0.8,
      content: `Next step should be based on active goals and focus memory. Goals: ${goalBasis}. Current focus: ${firstLine(focus)}`,
    };
  }
}

function firstLine(text: string): string {
  return text.split("\n").find(Boolean) ?? text;
}
