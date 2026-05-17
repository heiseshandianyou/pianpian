import type { Agent, AgentContext, AgentProposal, MemoryFormationPlan, NewMemoryEdge, NewMemoryNode } from "../types.js";

export class AutonomousAssociationAgent implements Agent {
  readonly id = "associator" as const;
  readonly role = "Forms quiet self-directed associations from activated memories during internal cycles.";

  async run(context: AgentContext): Promise<AgentProposal> {
    if (context.perception.source !== "internal") {
      return {
        agentId: this.id,
        intent: "skip-user-cycle-association",
        confidence: 0.2,
        content: "Autonomous association is reserved for internal cycles.",
      };
    }

    const focusNodes = context.activatedMemory?.focusNodes.slice(0, 4) ?? [];
    const innerState = context.innerState;
    const focusSummary =
      focusNodes.length > 0
        ? focusNodes.map((node) => `${node.memory.kind}: ${clip(node.memory.text, 120)}`).join(" | ")
        : "no strong memory focus";
    const mood = innerState?.mood ?? "quiet";
    const drives = innerState?.dominantDrives.join(", ") || "continuity";
    const node: NewMemoryNode = {
      localId: "association",
      kind: "reflection",
      text: `In a ${mood} inner state, I associated ${focusSummary}. This suggests my current attention is pulled toward ${drives}.`,
      importance: mood === "protective" || mood === "focused" ? 4 : 3,
      confidence: 0.78,
      tags: [
        "autonomous",
        "association",
        "inner-state",
        mood,
        ...(innerState?.dominantDrives ?? ["continuity"]),
      ],
    };
    const edges: NewMemoryEdge[] = focusNodes.map((focus) => ({
      fromMemoryId: focus.memory.id,
      toLocalId: node.localId,
      relation: "elaborates",
      strength: Math.max(0.35, focus.activation * 0.72),
      confidence: 0.74,
    }));
    const memoryFormation: MemoryFormationPlan = {
      nodes: [node],
      edges,
      rationale: "During an internal heartbeat, form a compact association from the currently activated memory field.",
    };

    return {
      agentId: this.id,
      intent: "autonomous-association",
      confidence: 0.76,
      content: `Formed an autonomous association from ${focusNodes.length} activated memories.`,
      memoryFormation,
    };
  }
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}
