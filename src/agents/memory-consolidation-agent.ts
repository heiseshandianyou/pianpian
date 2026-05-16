import type { LlmProvider } from "../llm/types.js";
import type { MemoryKind, MemoryRecord, NewMemory } from "../types.js";

export interface ConsolidationProposal {
  memory: NewMemory;
  rationale: string;
}

export class MemoryConsolidationAgent {
  constructor(private readonly llm?: LlmProvider) {}

  async propose(cluster: MemoryRecord[]): Promise<ConsolidationProposal | undefined> {
    if (cluster.length < 2) {
      return undefined;
    }

    if (this.llm) {
      const llmProposal = await this.tryLlmProposal(cluster);
      if (llmProposal) {
        return llmProposal;
      }
    }

    return this.ruleBasedProposal(cluster);
  }

  private async tryLlmProposal(cluster: MemoryRecord[]): Promise<ConsolidationProposal | undefined> {
    try {
      const response = await this.llm?.generate(
        [
          {
            role: "system",
            content: [
              "You are MemoryConsolidationAgent.",
              "Given related memories, create one durable consolidated memory.",
              "Return only valid JSON.",
              "Prefer semantic, goal, preference, procedure, or relationship.",
              "Do not invent facts not supported by the memories.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              memories: cluster.map((memory) => ({
                id: memory.id,
                kind: memory.kind,
                text: memory.text,
                importance: memory.importance,
                confidence: memory.confidence,
                tags: memory.tags,
              })),
              outputSchema: {
                kind: "semantic|goal|preference|procedure|relationship",
                text: "concise durable memory",
                importance: "1|2|3|4|5",
                confidence: "number 0..1",
                tags: ["string"],
                rationale: "string",
              },
            }),
          },
        ],
        {
          responseFormat: "json",
          temperature: 0.1,
          maxTokens: 900,
        },
      );

      if (!response) {
        return undefined;
      }

      const parsed = JSON.parse(response) as Partial<NewMemory> & { rationale?: unknown };
      if (typeof parsed.text !== "string" || typeof parsed.kind !== "string") {
        return undefined;
      }

      return {
        memory: {
          kind: normalizeKind(parsed.kind),
          text: parsed.text,
          importance: normalizeImportance(Number(parsed.importance ?? 4)),
          confidence: normalizeConfidence(Number(parsed.confidence ?? 0.75)),
          tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag) => typeof tag === "string") : ["consolidated"],
        },
        rationale:
          typeof parsed.rationale === "string"
            ? parsed.rationale
            : "LLM consolidated related memories into one durable memory.",
      };
    } catch {
      return undefined;
    }
  }

  private ruleBasedProposal(cluster: MemoryRecord[]): ConsolidationProposal {
    const strongest = [...cluster].sort((left, right) => right.importance - left.importance)[0];
    const tags = [...new Set(cluster.flatMap((memory) => memory.tags))].slice(0, 8);
    const kind = strongest.kind === "episode" || strongest.kind === "reflection" ? "semantic" : strongest.kind;

    return {
      memory: {
        kind,
        text: `Consolidated pattern: ${strongest.text}`,
        importance: strongest.importance,
        confidence: Math.min(...cluster.map((memory) => memory.confidence)),
        tags: ["consolidated", ...tags],
      },
      rationale: "Rule-based fallback consolidated a related cluster around the strongest memory.",
    };
  }
}

function normalizeKind(kind: string): MemoryKind {
  if (
    kind === "goal" ||
    kind === "preference" ||
    kind === "procedure" ||
    kind === "relationship" ||
    kind === "semantic"
  ) {
    return kind;
  }
  return "semantic";
}

function normalizeImportance(value: number): 1 | 2 | 3 | 4 | 5 {
  if (value <= 1) return 1;
  if (value === 2) return 2;
  if (value === 3) return 3;
  if (value === 4) return 4;
  return 5;
}

function normalizeConfidence(value: number): number {
  if (Number.isNaN(value)) {
    return 0.75;
  }
  return Math.max(0, Math.min(1, value));
}
