import type {
  Agent,
  AgentContext,
  AgentProposal,
  MemoryFormationPlan,
  MemoryRecord,
  NewMemoryEdge,
  NewMemoryNode,
  WorkingMemorySlot,
} from "../types.js";

interface ReviewSignal {
  memory: MemoryRecord;
  slot?: WorkingMemorySlot;
  score: number;
  reasons: string[];
}

const importantTags = new Set([
  "identity",
  "self-model",
  "relationship",
  "preference",
  "goal",
  "user",
  "promise",
  "codex",
]);

const noisyTags = new Set([
  "action",
  "execution",
  "say",
  "wait",
  "tool-result",
  "outcome",
]);

export class MemoryReviewAgent implements Agent {
  readonly id = "memory-reviewer" as const;
  readonly role = "Reviews the active memory field, reinforcing durable anchors and flagging weak or noisy memories.";

  async run(context: AgentContext): Promise<AgentProposal> {
    if (context.perception.source !== "internal") {
      return {
        agentId: this.id,
        intent: "skip-non-internal-memory-review",
        confidence: 0.28,
        content: "Memory review is reserved for internal maintenance cycles.",
      };
    }

    const signals = reviewSignals(context);
    const anchors = signals.filter((signal) => signal.score >= 0.62).slice(0, 5);
    const lowValue = signals
      .filter((signal) => shouldDowngrade(signal.memory, signal.score))
      .slice(0, 4);

    if (anchors.length === 0 && lowValue.length === 0) {
      return {
        agentId: this.id,
        intent: "memory-review-noop",
        confidence: 0.58,
        content: "The active memory field did not contain strong consolidation or cleanup signals.",
      };
    }

    const memoryFormation = anchors.length > 0 ? buildReviewFormation(context, anchors) : undefined;
    const memoryCorrection =
      lowValue.length > 0
        ? {
            operation: "downgrade" as const,
            targetMemoryIds: lowValue.map((signal) => signal.memory.id),
            reason: "Memory review found low-confidence, low-importance execution noise in the active context.",
            note: {
              kind: "reflection" as const,
              text: `Memory review downgraded ${lowValue.length} low-value active memories so durable context can surface more easily.`,
              importance: 2 as const,
              confidence: 0.74,
              tags: ["memory-review", "downgrade", "quality"],
            },
          }
        : undefined;

    return {
      agentId: this.id,
      intent: "review-active-memory-field",
      confidence: anchors.length > 0 ? 0.82 : 0.68,
      content: renderReviewSummary(anchors, lowValue),
      memoryFormation,
      memoryCorrection,
    };
  }
}

function reviewSignals(context: AgentContext): ReviewSignal[] {
  const byId = new Map<string, ReviewSignal>();
  for (const slot of context.workingMemory?.slots ?? []) {
    const signal = scoreMemory(slot.node.memory, slot);
    byId.set(signal.memory.id, signal);
  }

  for (const focus of context.activatedMemory?.focusNodes ?? []) {
    const existing = byId.get(focus.memory.id);
    if (existing) {
      existing.score = Math.max(existing.score, scoreFocusActivation(focus.activation));
      existing.reasons.push(`activation=${focus.activation.toFixed(2)}`);
      continue;
    }

    byId.set(focus.memory.id, {
      memory: focus.memory,
      score: scoreFocusActivation(focus.activation),
      reasons: [`activation=${focus.activation.toFixed(2)}`],
    });
  }

  return [...byId.values()].sort((left, right) => right.score - left.score);
}

function scoreMemory(memory: MemoryRecord, slot: WorkingMemorySlot): ReviewSignal {
  const reasons: string[] = [`section=${slot.section}`];
  let score = memory.importance / 5 * 0.32 + memory.confidence * 0.26 + slot.score * 0.26;

  if (memory.pinned) {
    score += 0.14;
    reasons.push("pinned");
  }

  if (memory.tags.some((tag) => importantTags.has(tag.toLowerCase()))) {
    score += 0.16;
    reasons.push("durable-tag");
  }

  if (slot.section === "identity" || slot.section === "relationship" || slot.section === "goals") {
    score += 0.12;
    reasons.push("core-section");
  }

  if (isLikelyNoise(memory)) {
    score -= 0.18;
    reasons.push("execution-noise");
  }

  return {
    memory,
    slot,
    score: clamp01(score),
    reasons,
  };
}

function scoreFocusActivation(activation: number): number {
  return clamp01(0.32 + activation * 0.58);
}

function shouldDowngrade(memory: MemoryRecord, score: number): boolean {
  if (memory.pinned || memory.importance >= 4) {
    return false;
  }

  if (memory.kind !== "episode" && memory.kind !== "reflection") {
    return false;
  }

  return score < 0.38 && memory.confidence < 0.78 && isLikelyNoise(memory);
}

function buildReviewFormation(context: AgentContext, anchors: ReviewSignal[]): MemoryFormationPlan {
  const anchorSummary = anchors
    .map((signal) => `${signal.memory.kind}:${clip(signal.memory.text, 92)}`)
    .join(" | ");
  const topicTerms = context.workingMemory?.topicTerms.slice(0, 5) ?? [];
  const node: NewMemoryNode = {
    localId: "memory-review",
    kind: "reflection",
    text: `Memory review: current continuity is anchored by ${anchorSummary}. Keep these memories easier to recall when ${topicTerms.join(", ") || "similar themes"} return.`,
    importance: anchors.some((signal) => signal.memory.importance >= 4 || signal.memory.pinned) ? 3 : 2,
    confidence: 0.8,
    tags: compactTags([
      "memory-review",
      "quality",
      "continuity",
      ...topicTerms,
      ...anchors.flatMap((signal) => signal.memory.tags.slice(0, 3)),
    ]),
  };
  const edges: NewMemoryEdge[] = anchors.map((signal) => ({
    fromMemoryId: signal.memory.id,
    toLocalId: node.localId,
    relation: "reinforces",
    strength: Math.max(0.42, signal.score * 0.72),
    confidence: Math.min(0.9, signal.memory.confidence + 0.05),
  }));

  return {
    nodes: [node],
    edges,
    rationale: "Review the currently active memory field and preserve durable continuity anchors.",
  };
}

function renderReviewSummary(anchors: ReviewSignal[], lowValue: ReviewSignal[]): string {
  const parts = [
    anchors.length > 0 ? `Reinforced ${anchors.length} continuity anchor(s).` : undefined,
    lowValue.length > 0 ? `Downgraded ${lowValue.length} noisy low-value memory item(s).` : undefined,
  ];
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

function isLikelyNoise(memory: MemoryRecord): boolean {
  const text = memory.text.toLowerCase();
  const tags = memory.tags.map((tag) => tag.toLowerCase());
  return (
    tags.some((tag) => noisyTags.has(tag)) ||
    text.startsWith("action executed: say") ||
    text.startsWith("action executed: wait") ||
    text.startsWith("tool result reflection:")
  );
}

function compactTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
}

function clip(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 3)}...`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
