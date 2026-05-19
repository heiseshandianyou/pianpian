import { EntityExtractionAgent } from "./entity-extraction-agent.js";
import type { LlmProvider } from "../llm/types.js";
import { MEMORY_VAULT_FILE_SPEC } from "../memory/memory-vault-file-spec.js";
import { relationshipMemoryNodes } from "../memory/relationship-memory-schema.js";
import type {
  Agent,
  AgentContext,
  AgentProposal,
  MemoryFormationPlan,
  NewMemoryNode,
  NewVaultDocument,
} from "../types.js";

export class MemoryFormationAgent implements Agent {
  readonly id = "memory-curator" as const;
  readonly role = "Forms memory nodes and relational edges from experience.";
  private readonly entityExtraction = new EntityExtractionAgent();

  constructor(private readonly llm?: LlmProvider) {}

  async run(context: AgentContext): Promise<AgentProposal> {
    const llmResult = this.llm ? await this.tryLlmFormation(context) : undefined;
    const memoryFormation = withEntities(
      withVaultWrites(withRelationshipSchema(llmResult?.plan ?? this.ruleBasedFormation(context), context), context),
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
              "Preserve the user's language for memory text; do not translate Chinese experiences into English unless the user used English.",
              "Always include one episode node with localId 'episode'.",
              "Episode is an intermediate evidence artifact. When you create or update durable dossier memory for the same experience, include archiveLocalIds: ['episode'] so the raw episode stops competing with long-term recall.",
              "Create durable semantic, goal, preference, reflection, or procedure nodes only when justified.",
              "Do not create a durable node if a retrieved memory already states the same fact; prefer reinforcing or linking to the existing memory.",
              "When a durable memory belongs in a dossier, include a Markdown vaultWrites entry following the Memory Vault File Spec below. You decide the dossier type, path, title, sections, tags, and relations from meaning, not from a hardcoded category list.",
              "Connect derived nodes to the episode with derived_from edges.",
              "Allowed kinds: episode, semantic, goal, preference, reflection, self_model, procedure, relationship.",
              "Allowed relations: supports, contradicts, elaborates, same_goal, same_entity, temporal_neighbor, derived_from, reinforces.",
              "",
              MEMORY_VAULT_FILE_SPEC,
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
                vaultWrites: [
                  {
                    localId: "string",
                    title: "string",
                    path: "relative markdown path optional",
                    anchor: "string optional",
                    body: "markdown body",
                    memoryLocalIds: ["string"],
                    tags: ["string"],
                    importance: "1|2|3|4|5 optional",
                    kind: "episode|semantic|goal|preference|reflection|self_model|procedure|relationship optional",
                  },
                ],
                archiveLocalIds: ["episode optional when durable dossier absorbs the source episode as evidence"],
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
    nodes.push(...relationshipMemoryNodes(text));

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

    if (mentions(text, ["memory", "long-term", "context", "markdown", "filesystem", "vault"])) {
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
    capture(text, /我的名字(?:是|叫)\s*([^，。？！；;,\s]+)/u) ??
    capture(text, /我叫\s*([^，。？！；;,\s]+)/u) ??
    capture(text, /我是\s*(.+?)(?:记住|，|。|、|,|\s|$)/u);
  const assistantName =
    capture(text, /你的名字(?:是|叫)\s*([^，。？！；;,\s]+)/u) ??
    capture(text, /你叫\s*([^，。？！；;,\s]+)/u) ??
    capture(text, /你是\s*(.+?)(?:，|。|、|,|\s|$)/u);
  const birthName = capture(text, /(?:她|你)?(?:的)?原名(?:是|叫)?\s*([^，。？！；;,\s]+)/u);
  const stageName = capture(text, /艺名(?:是|叫)?\s*([^，。？！；;,\s]+)/u);
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
      pinned: true,
      tags: ["core", "identity", "relationship", "name"],
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

  return value.replace(/[，。？！；;,.!?].*$/u, "").trim();
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

function withRelationshipSchema(plan: MemoryFormationPlan, context: AgentContext): MemoryFormationPlan {
  const schemaNodes = relationshipMemoryNodes(context.perception.text);
  if (schemaNodes.length === 0) {
    return plan;
  }

  const existingLocalIds = new Set(plan.nodes.map((node) => node.localId));
  const newNodes = schemaNodes.filter((node) => !existingLocalIds.has(node.localId));
  if (newNodes.length === 0) {
    return plan;
  }

  const hasEpisode = plan.nodes.some((node) => node.localId === "episode");
  return {
    ...plan,
    nodes: [...plan.nodes, ...newNodes],
    edges: [
      ...plan.edges,
      ...(hasEpisode
        ? newNodes.map((node) => ({
            fromLocalId: "episode",
            toLocalId: node.localId,
            relation: "derived_from" as const,
            strength: node.importance / 5,
            confidence: node.confidence,
          }))
        : []),
    ],
    rationale: `${plan.rationale} Relationship schema attached durable family/origin memory nodes when relevant.`,
  };
}

function withVaultWrites(plan: MemoryFormationPlan, context: AgentContext): MemoryFormationPlan {
  const existing = plan.vaultWrites ?? [];
  const covered = new Set(existing.flatMap((write) => write.memoryLocalIds));
  const durableNodes = plan.nodes.filter((node) => shouldMirrorToVault(node, context) && !covered.has(node.localId));
  if (durableNodes.length === 0) {
    return plan;
  }

  return {
    ...plan,
    vaultWrites: [
      ...existing,
      ...durableNodes.map((node) => vaultWriteForNode(node, context)),
    ],
    rationale: `${plan.rationale} Durable high-value memories were scheduled for Markdown Vault mirroring.`,
  };
}

function shouldMirrorToVault(node: NewMemoryNode, context: AgentContext): boolean {
  if (node.kind === "episode" && context.perception.source !== "internal") {
    return false;
  }

  return (
    node.pinned === true ||
    node.importance >= 4 ||
    ["self_model", "relationship", "preference", "goal", "reflection", "procedure"].includes(node.kind) ||
    (node.tags ?? []).some((tag) => ["identity", "relationship", "origin", "family", "preference", "goal", "style"].includes(tag))
  );
}

function vaultWriteForNode(node: NewMemoryNode, context: AgentContext): NewVaultDocument {
  const title = titleForNode(node);
  const anchor = `memory-${node.localId}`;
  return {
    localId: `vault-${node.localId}`,
    title,
    path: `${vaultDirectoryForNode(node)}/${slug(title)}.md`,
    anchor,
    body: [
      `# ${title}`,
      "",
      `<a id="${anchor}"></a>`,
      "",
      node.text,
      "",
      "## Meaning",
      "",
      `Kind: ${node.kind}. Importance: ${node.importance}. Confidence: ${(node.confidence ?? 1).toFixed(2)}.`,
      "",
      "## Source",
      "",
      `Formed from ${context.perception.source} perception at ${context.perception.createdAt}.`,
    ].join("\n"),
    memoryLocalIds: [node.localId],
    tags: node.tags,
    importance: node.importance,
    kind: node.kind,
  };
}

function titleForNode(node: NewMemoryNode): string {
  const tag = (node.tags ?? []).find((item) => item !== "experience") ?? node.kind;
  const preview = node.text.replace(/\s+/g, " ").slice(0, 52).replace(/[.?:;!?，。？！；]+$/u, "");
  return `${capitalize(node.kind)} - ${capitalize(tag)}${preview ? ` - ${preview}` : ""}`;
}

function vaultDirectoryForNode(node: NewMemoryNode): string {
  if (node.kind === "self_model") return "core";
  if (node.kind === "relationship") return "relationships";
  if (node.kind === "preference") return "preferences";
  if (node.kind === "goal") return "goals";
  if (node.kind === "reflection") return "reflections";
  if (node.kind === "procedure") return "procedures";
  return "memories";
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 88) || "memory";
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
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
    vaultWrites: normalizeVaultWrites(plan.vaultWrites, localIds),
    archiveLocalIds: normalizeArchiveLocalIds(plan.archiveLocalIds, localIds),
    rationale: typeof plan.rationale === "string" ? plan.rationale : "LLM-generated memory formation plan.",
  };
}

function normalizeArchiveLocalIds(value: unknown, localIds: Set<string>): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const ids = value.filter((item): item is string => typeof item === "string" && localIds.has(item));
  return ids.length > 0 ? [...new Set(ids)] : undefined;
}

function normalizeVaultWrites(value: unknown, localIds: Set<string>): NewVaultDocument[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const writes = value.flatMap((item): NewVaultDocument[] => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const candidate = item as Partial<NewVaultDocument>;
    const memoryLocalIds = Array.isArray(candidate.memoryLocalIds)
      ? candidate.memoryLocalIds.filter((id): id is string => typeof id === "string" && localIds.has(id))
      : [];
    if (
      typeof candidate.localId !== "string" ||
      typeof candidate.title !== "string" ||
      typeof candidate.body !== "string" ||
      memoryLocalIds.length === 0
    ) {
      return [];
    }

    return [
      {
        localId: candidate.localId,
        title: candidate.title,
        path: typeof candidate.path === "string" ? candidate.path : undefined,
        anchor: typeof candidate.anchor === "string" ? candidate.anchor : undefined,
        body: candidate.body,
        memoryLocalIds,
        tags: Array.isArray(candidate.tags) ? candidate.tags.filter((tag): tag is string => typeof tag === "string") : [],
        importance: clampImportance(Number(candidate.importance ?? 3)),
        kind: candidate.kind,
      },
    ];
  });

  return writes.length > 0 ? writes : undefined;
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
