import type {
  Agent,
  AgentContext,
  AgentProposal,
  MemoryCorrectionOperation,
  MemoryRecord,
  NewMemory,
} from "../types.js";

export class MemoryCorrectionAgent implements Agent {
  readonly id = "memory-corrector" as const;
  readonly role = "Interprets user feedback that corrects, pins, archives, or reweights memories.";

  async run(context: AgentContext): Promise<AgentProposal> {
    const operation = inferOperation(context.perception.text);
    if (!operation) {
      return {
        agentId: this.id,
        intent: "no-memory-correction",
        confidence: 0.55,
        content: "No explicit memory correction request detected.",
      };
    }

    const targets = selectTargets(context.perception.text, context.memories, operation);
    if (targets.length === 0) {
      return {
        agentId: this.id,
        intent: "memory-correction-needs-target",
        confidence: 0.62,
        content: "Memory correction was requested, but no suitable active memory target was recalled.",
        actions: [
          {
            type: "ask-user",
            content:
              "我理解你想修正记忆，但当前没有明确召回到要修改的那条。你可以带上关键词，比如 memory.stats、project.status，或直接说明要改哪条。",
          },
        ],
      };
    }

    const note = correctionNote(context.perception.text, operation);
    return {
      agentId: this.id,
      intent: "apply-memory-correction",
      confidence: 0.86,
      content: `Apply ${operation} to ${targets.length} recalled memory target(s).`,
      memoryCorrection: {
        operation,
        targetMemoryIds: targets.map((memory) => memory.id),
        reason: context.perception.text,
        note,
      },
    };
  }
}

function inferOperation(text: string): MemoryCorrectionOperation | undefined {
  const normalized = text.toLowerCase();
  if (
    mentionsAny(normalized, [
      "不要再记",
      "别记",
      "删除这条记忆",
      "归档",
      "不对",
      "错了",
      "错误",
      "wrong",
      "incorrect",
      "forget this",
      "archive this",
    ])
  ) {
    return "archive";
  }

  if (mentionsAny(normalized, ["设为重要", "固定这条", "pin this", "keep this", "不要忘", "永久记住"])) {
    return "pin";
  }

  if (mentionsAny(normalized, ["取消固定", "unpin"])) {
    return "unpin";
  }

  if (mentionsAny(normalized, ["降权", "不重要", "less important", "downgrade"])) {
    return "downgrade";
  }

  if (mentionsAny(normalized, ["确认这条", "这条是对的", "reinforce", "是对的"])) {
    return "reinforce";
  }

  return undefined;
}

function selectTargets(
  input: string,
  memories: MemoryRecord[],
  operation: MemoryCorrectionOperation,
): MemoryRecord[] {
  const normalized = input.toLowerCase();
  const candidates = memories.filter((memory) => {
    if (memory.kind === "self_model" && operation === "archive") {
      return false;
    }
    return memory.status === "active";
  });

  const scored = candidates
    .map((memory) => ({
      memory,
      score: targetScore(normalized, memory),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length > 0) {
    const topScore = scored[0]?.score ?? 0;
    return scored
      .filter((item) => item.score >= Math.max(2, topScore - 1))
      .map((item) => item.memory)
      .slice(0, 3);
  }

  return candidates.filter((memory) => memory.kind !== "reflection").slice(0, 1);
}

function targetScore(input: string, memory: MemoryRecord): number {
  const text = memory.text.toLowerCase();
  let score = 0;

  for (const token of importantTokens(input)) {
    if (text.includes(token)) {
      score += token.length >= 8 ? 3 : 1;
    }
  }

  for (const tag of memory.tags) {
    if (input.includes(tag.toLowerCase())) {
      score += 3;
    }
  }

  if (memory.kind === "semantic") {
    score += 1;
  }
  if (memory.kind === "episode" && text.includes("action executed")) {
    score += 1;
  }

  return score;
}

function correctionNote(text: string, operation: MemoryCorrectionOperation): NewMemory {
  if (operation === "archive") {
    const correction = extractCorrection(text);
    return {
      kind: correction ? "semantic" : "episode",
      text: correction ? `User correction: ${correction}` : `User requested memory archival/correction: ${text}`,
      importance: correction ? 4 : 2,
      confidence: 0.95,
      tags: ["memory-correction", operation],
    };
  }

  return {
    kind: "episode",
    text: `User requested memory ${operation}: ${text}`,
    importance: 2,
    confidence: 0.95,
    tags: ["memory-correction", operation],
  };
}

function extractCorrection(text: string): string | undefined {
  const patterns = [/应该是(.+)$/u, /正确的是(.+)$/u, /correct(?: value| fact)? is (.+)$/iu];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

function importantTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_.:\u3400-\u9fff\\-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !stopTokens.has(token));
}

function mentionsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

const stopTokens = new Set([
  "this",
  "that",
  "memory",
  "记忆",
  "这个",
  "这条",
  "刚才",
  "关于",
  "please",
  "不要",
]);
