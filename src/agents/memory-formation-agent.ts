import { EntityExtractionAgent } from "./entity-extraction-agent.js";
import type { LlmProvider } from "../llm/types.js";
import type { Agent, AgentContext, AgentProposal, MemoryFormationPlan, NewMemoryNode } from "../types.js";

export class MemoryFormationAgent implements Agent {
  readonly id = "memory-curator" as const;
  readonly role = "Forms memory nodes and relational edges from experience.";
  private readonly entityExtraction = new EntityExtractionAgent();

  constructor(private readonly llm?: LlmProvider) {}

  async run(context: AgentContext): Promise<AgentProposal> {
    const llmResult = this.llm ? await this.tryLlmFormation(context) : undefined;
    const memoryFormation = withEntities(
      llmResult?.plan ?? this.ruleBasedFormation(context),
      this.entityExtraction,
    );

    return {
      agentId: this.id,
      intent: llmResult?.plan ? "form-memory-graph-with-llm" : "form-memory-graph",
      confidence: memoryFormation.nodes.length > 1 ? 0.86 : 0.55,
      content: llmResult?.error
        ? `Formed ${memoryFormation.nodes.length} memory nodes and ${memoryFormation.edges.length} relation edges. LLM fallback: ${llmResult.error}`
        : `Formed ${memoryFormation.nodes.length} memory nodes and ${memoryFormation.edges.length} relation edges.`,
      memoryFormation,
    };
  }

  private async tryLlmFormation(
    context: AgentContext,
  ): Promise<{ plan?: MemoryFormationPlan; error?: string }> {
    try {
      const response = await this.llm?.generate(
        [
          {
            role: "system",
            content: [
              "You are the MemoryFormationAgent for an autonomous multi-agent system.",
              "Convert the current perception into a memory graph formation plan.",
              "Return only valid JSON.",
              "Use concise English for memory text.",
              "Always include one episode node with localId 'episode'.",
              "Create durable semantic, goal, preference, reflection, or procedure nodes only when justified.",
              "Connect derived nodes to the episode with derived_from edges.",
              "Allowed kinds: episode, semantic, goal, preference, reflection, self_model, procedure, relationship.",
              "Allowed relations: supports, contradicts, elaborates, same_goal, same_entity, temporal_neighbor, derived_from, reinforces.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              perception: context.perception,
              retrievedMemories: context.memories.map((memory) => ({
                id: memory.id,
                kind: memory.kind,
                text: memory.text,
                importance: memory.importance,
                confidence: memory.confidence,
                tags: memory.tags,
              })),
              outputSchema: {
                nodes: [
                  {
                    localId: "string",
                    kind: "episode|semantic|goal|preference|reflection|self_model|procedure|relationship",
                    text: "string",
                    importance: "1|2|3|4|5",
                    confidence: "number 0..1",
                    tags: ["string"],
                  },
                ],
                edges: [
                  {
                    fromLocalId: "string optional",
                    toLocalId: "string optional",
                    fromMemoryId: "string optional",
                    toMemoryId: "string optional",
                    relation: "derived_from|supports|contradicts|elaborates|same_goal|same_entity|temporal_neighbor|reinforces",
                    strength: "number 0..1",
                    confidence: "number 0..1",
                  },
                ],
                rationale: "string",
              },
            }),
          },
        ],
        {
          responseFormat: "json",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 15_000,
        },
      );

      if (!response) {
        return { error: "empty response" };
      }

      return {
        plan: normalizeFormationPlan(JSON.parse(response) as Partial<MemoryFormationPlan>, context),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message.slice(0, 180) : "unknown error",
      };
    }
  }

  private ruleBasedFormation(context: AgentContext): MemoryFormationPlan {
    const text = context.perception.text;
    const nodes: NewMemoryNode[] = [
      {
        localId: "episode",
        kind: "episode",
        text,
        importance: context.perception.source === "internal" ? 2 : 3,
        confidence: 1,
        tags: [context.perception.source, "experience"],
      },
    ];
    nodes.push(...identityNodes(text));

    if (mentions(text, ["TypeScript", "typescript"])) {
      nodes.push({
        localId: "typescript-preference",
        kind: "preference",
        text: "The user prefers TypeScript for the autonomous agent project.",
        importance: 4,
        confidence: 0.9,
        tags: ["project", "language", "typescript"],
      });
    }

    if (mentions(text, ["memory", "long-term", "context", "database", "filesystem"])) {
      nodes.push({
        localId: "memory-goal",
        kind: "goal",
        text: "The project should use an explicit memory manager that forms, retrieves, activates, consolidates, and forgets memories.",
        importance: 5,
        confidence: 0.92,
        tags: ["memory", "architecture"],
      });
    }

    if (mentions(text, ["autonomous", "active", "heartbeat", "Internal heartbeat"])) {
      nodes.push({
        localId: "autonomy-goal",
        kind: "goal",
        text: "The agent should stay active through internal heartbeats even when the user gives no task.",
        importance: 5,
        confidence: 0.9,
        tags: ["autonomy", "heartbeat"],
      });
    }

    if (mentions(text, ["forgetting", "forget", "fade", "decay"])) {
      nodes.push({
        localId: "forgetting-principle",
        kind: "semantic",
        text: "Forgetting should weaken activation and archive low-retention memories before hard deletion.",
        importance: 4,
        confidence: 0.88,
        tags: ["memory", "forgetting"],
      });
    }

    if (mentions(text, ["network", "graph", "activation", "high-dimensional"])) {
      nodes.push({
        localId: "network-principle",
        kind: "semantic",
        text: "Memory should behave like a high-dimensional activation network, not like independent library categories.",
        importance: 5,
        confidence: 0.9,
        tags: ["memory", "graph", "activation"],
      });
    }

    return createDerivedFormationPlan(nodes);
  }
}

function identityNodes(text: string): NewMemoryNode[] {
  if (isQuestion(text)) {
    return [];
  }

  const userName =
    capture(text, /我的名字(?:是|叫)\s*([^，。,\s]+)/u) ??
    capture(text, /我是\s*(.+?)(?:记住|，|。|,|\s|$)/u);
  const assistantName =
    capture(text, /你(?:的)?名字(?:是|叫)\s*([^，。,\s]+)/u) ??
    capture(text, /你是\s*(.+?)(?:，|。|,|\s|$)/u);
  const birthName = capture(text, /(?:她|你)?(?:的)?原名(?:是|叫)?\s*([^，。,\s]+)/u);
  const stageName = capture(text, /艺名(?:是|叫)?\s*([^，。,\s]+)/u);
  const nodes: NewMemoryNode[] = [];

  if (userName && userName !== "谁") {
    nodes.push({
      localId: "user-name",
      kind: "semantic",
      text: `The user's name is ${userName}.`,
      importance: 5,
      confidence: 0.96,
      tags: ["identity", "user", "name"],
    });
  }

  if (assistantName && assistantName !== "谁") {
    nodes.push({
      localId: "assistant-name",
      kind: "self_model",
      text: `Pianpian's chosen name is ${assistantName}.`,
      importance: 5,
      confidence: 0.96,
      tags: ["identity", "self", "name"],
    });
  }

  if (birthName || stageName) {
    nodes.push({
      localId: "assistant-names",
      kind: "self_model",
      text: [
        birthName ? `${birthName} is my birth name.` : "",
        stageName ? `${stageName} is my stage name.` : "",
        birthName || stageName ? "Both names belong to me." : "",
      ]
        .filter(Boolean)
        .join(" "),
      importance: 5,
      confidence: 0.96,
      tags: ["identity", "self", "name"],
    });
  }

  if (userName && assistantName && userName !== "谁" && assistantName !== "谁") {
    nodes.push({
      localId: "identity-relationship",
      kind: "relationship",
      text: `The user ${userName} addresses Pianpian as ${assistantName}.`,
      importance: 5,
      confidence: 0.94,
      tags: ["identity", "relationship", "name"],
    });
  }

  return nodes;
}

function capture(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  const value = match?.[1]?.trim();
  if (!value) {
    return undefined;
  }

  return value.replace(/[，。,.!！?？].*$/u, "").trim();
}

function isQuestion(text: string): boolean {
  return /[?？]/u.test(text) || ["我是谁", "你是谁", "我叫什么", "你叫什么"].some((term) => text.includes(term));
}

function createDerivedFormationPlan(nodes: NewMemoryNode[]): MemoryFormationPlan {
  return {
    nodes,
    edges: nodes
      .filter((node) => node.localId !== "episode")
      .map((node) => ({
        fromLocalId: "episode",
        toLocalId: node.localId,
        relation: "derived_from",
        strength: node.importance / 5,
        confidence: node.confidence,
      })),
    rationale: "Transform the current experience into memory nodes and connect derived stable meanings to the source episode.",
  };
}

function withEntities(plan: MemoryFormationPlan, extractor: EntityExtractionAgent): MemoryFormationPlan {
  const extracted = extractor.extract(plan);
  return {
    ...plan,
    entities: mergeEntities(plan.entities ?? [], extracted.entities ?? []),
    memoryEntityLinks: [...(plan.memoryEntityLinks ?? []), ...(extracted.memoryEntityLinks ?? [])],
  };
}

function mergeEntities<T extends { localId: string }>(primary: T[], secondary: T[]): T[] {
  const merged = new Map<string, T>();
  for (const entity of [...primary, ...secondary]) {
    merged.set(entity.localId, entity);
  }
  return [...merged.values()];
}

function normalizeFormationPlan(plan: Partial<MemoryFormationPlan>, context: AgentContext): MemoryFormationPlan {
  const nodes = Array.isArray(plan.nodes) ? plan.nodes.filter(isUsableNode).map(normalizeNode) : [];
  if (!nodes.some((node) => node.localId === "episode")) {
    nodes.unshift({
      localId: "episode",
      kind: "episode",
      text: context.perception.text,
      importance: context.perception.source === "internal" ? 2 : 3,
      confidence: 1,
      tags: [context.perception.source, "experience"],
    });
  }

  const localIds = new Set(nodes.map((node) => node.localId));
  const edges = Array.isArray(plan.edges)
    ? plan.edges
        .filter((edge) => {
          const fromOk = Boolean(edge.fromMemoryId) || Boolean(edge.fromLocalId && localIds.has(edge.fromLocalId));
          const toOk = Boolean(edge.toMemoryId) || Boolean(edge.toLocalId && localIds.has(edge.toLocalId));
          return fromOk && toOk && typeof edge.relation === "string";
        })
        .map((edge) => ({
          ...edge,
          strength: clamp01(Number(edge.strength ?? 0.5)),
          confidence: clamp01(Number(edge.confidence ?? 0.7)),
        }))
    : createDerivedFormationPlan(nodes).edges;

  return {
    nodes,
    edges,
    rationale: typeof plan.rationale === "string" ? plan.rationale : "LLM-generated memory formation plan.",
  };
}

function isUsableNode(node: unknown): node is NewMemoryNode {
  if (!node || typeof node !== "object") {
    return false;
  }
  const candidate = node as Partial<NewMemoryNode>;
  return typeof candidate.localId === "string" && typeof candidate.text === "string" && typeof candidate.kind === "string";
}

function normalizeNode(node: NewMemoryNode): NewMemoryNode {
  return {
    localId: node.localId,
    kind: node.kind,
    text: node.text,
    importance: clampImportance(Number(node.importance)),
    confidence: clamp01(Number(node.confidence ?? 0.7)),
    pinned: node.pinned ?? false,
    tags: Array.isArray(node.tags) ? node.tags.filter((tag) => typeof tag === "string") : [],
  };
}

function mentions(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, value));
}

function clampImportance(value: number): 1 | 2 | 3 | 4 | 5 {
  if (value <= 1) {
    return 1;
  }
  if (value === 2) {
    return 2;
  }
  if (value === 3) {
    return 3;
  }
  if (value === 4) {
    return 4;
  }
  return 5;
}
