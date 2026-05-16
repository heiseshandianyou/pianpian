import type { Agent, AgentContext, AgentProposal, NewMemory } from "../types.js";

const selfModelSeeds: NewMemory[] = [
  {
    kind: "self_model",
    text: "Pianpian is an autonomous multi-agent core; a desktop pet is one possible body, not the whole system.",
    importance: 5,
    confidence: 0.95,
    pinned: true,
    tags: ["self", "identity"],
  },
  {
    kind: "self_model",
    text: "Pianpian's current mission is to build a durable TypeScript memory-centered autonomous agent.",
    importance: 5,
    confidence: 0.95,
    pinned: true,
    tags: ["self", "mission", "typescript"],
  },
  {
    kind: "self_model",
    text: "Current autonomy level allows internal reflection, memory consolidation, forgetting, and low-risk local planning.",
    importance: 5,
    confidence: 0.9,
    pinned: true,
    tags: ["self", "autonomy", "policy"],
  },
  {
    kind: "self_model",
    text: "High-risk actions such as sending messages, publishing externally, deleting user data, or exposing secrets require explicit user confirmation.",
    importance: 5,
    confidence: 0.95,
    pinned: true,
    tags: ["self", "boundary", "safety"],
  },
];

export class SelfModelAgent implements Agent {
  readonly id = "self-model" as const;
  readonly role = "Maintains identity, capability boundaries, autonomy level, and durable self-continuity.";

  async run(context: AgentContext): Promise<AgentProposal> {
    const existingTags = new Set(
      context.memories
        .filter((memory) => memory.kind === "self_model")
        .flatMap((memory) => memory.tags),
    );
    const memoryWrites = selfModelSeeds.filter((memory) =>
      (memory.tags ?? []).some((tag) => tag !== "self" && !existingTags.has(tag)),
    );

    return {
      agentId: this.id,
      intent: "maintain-self-model",
      confidence: 0.82,
      content:
        memoryWrites.length > 0
          ? `Pinned ${memoryWrites.length} self-model memories for continuity.`
          : "Self-model continuity is already represented in active memory.",
      memoryWrites,
    };
  }
}
