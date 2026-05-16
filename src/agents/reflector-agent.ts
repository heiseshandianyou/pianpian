import type { Agent, AgentContext, AgentProposal } from "../types.js";

export class ReflectorAgent implements Agent {
  readonly id = "reflector" as const;
  readonly role = "Converts completed cycles into compact reflections.";

  async run(context: AgentContext): Promise<AgentProposal> {
    return {
      agentId: this.id,
      intent: "reflect",
      confidence: 0.7,
      content: "The system should prefer simple persistent loops before adding richer UI behavior.",
      memoryWrites: [
        {
          kind: "reflection",
          text: `Cycle ${context.cycle}: prioritize autonomous memory/runtime architecture before desktop presentation.`,
          importance: 3,
          tags: ["reflection", "runtime"],
        },
      ],
    };
  }
}
