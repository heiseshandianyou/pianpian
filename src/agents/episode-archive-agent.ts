import type { LlmProvider } from "../llm/types.js";
import { MEMORY_VAULT_FILE_SPEC } from "../memory/memory-vault-file-spec.js";
import type {
  Agent,
  AgentContext,
  AgentProposal,
  MemoryFormationPlan,
  MemoryRecord,
  MemoryRelation,
  NewMemoryEdge,
  NewMemoryNode,
  NewVaultDocument,
} from "../types.js";

interface ArchiveAgentResponse {
  memoryFormation?: Partial<MemoryFormationPlan>;
  archiveSourceMemoryIds?: string[];
  confidence?: number;
  summary?: string;
}

export class EpisodeArchiveAgent implements Agent {
  readonly id = "episode-archivist" as const;
  readonly role = "Turns related episode memories into durable Markdown dossier documents.";

  constructor(private readonly llm?: LlmProvider) {}

  async run(context: AgentContext): Promise<AgentProposal> {
    const episodes = context.memories
      .filter((memory) => memory.status === "active" && memory.kind === "episode")
      .slice(0, 12);

    if (!this.llm || episodes.length === 0) {
      return skipProposal(this.id, this.llm ? "No active episodes were available for dossier archiving." : "No LLM is configured for agent-authored dossier archiving.");
    }

    const response = await this.askArchiveAgent(context, episodes);
    if (!response?.memoryFormation) {
      return skipProposal(this.id, "The archive agent chose not to create a dossier yet.");
    }

    const memoryFormation = normalizeArchiveFormation(response.memoryFormation);
    if (!memoryFormation) {
      return skipProposal(this.id, "The archive agent did not return a usable MemoryFormationPlan.");
    }

    const sourceIds = new Set(episodes.map((memory) => memory.id));
    const archiveSourceMemoryIds = (response.archiveSourceMemoryIds ?? []).filter((id) => sourceIds.has(id));

    return {
      agentId: this.id,
      intent: "archive-episodes-to-agent-authored-dossier",
      confidence: clamp01(response.confidence ?? 0.66),
      content:
        response.summary ??
        `Agent-authored dossier plan created from ${archiveSourceMemoryIds.length || episodes.length} source episode(s).`,
      memoryFormation,
      memoryCorrection:
        archiveSourceMemoryIds.length > 0
          ? {
              operation: "archive",
              targetMemoryIds: archiveSourceMemoryIds,
              reason: "EpisodeArchiveAgent consolidated these source episodes into an agent-authored Markdown dossier.",
            }
          : undefined,
    };
  }

  private async askArchiveAgent(
    context: AgentContext,
    episodes: MemoryRecord[],
  ): Promise<ArchiveAgentResponse | undefined> {
    try {
      const response = await this.llm?.generate(
        [
          {
            role: "system",
            content: [
              "You are EpisodeArchiveAgent.",
              "Your job is not to classify with hardcoded categories. Your job is to decide whether active episodes have matured into a durable Markdown dossier.",
              "If they have not matured, return JSON with no memoryFormation.",
              "If they have matured, create a MemoryFormationPlan with durable nodes, vaultWrites, and graph edges from source episode IDs.",
              "Choose the dossier path, title, body sections, tags, and memory kind from meaning.",
              "Archive only source episode IDs that are fully absorbed as evidence by the dossier.",
              "Return only valid JSON.",
              "",
              MEMORY_VAULT_FILE_SPEC,
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              currentPerception: context.perception,
              sourceEpisodes: episodes.map((memory) => ({
                id: memory.id,
                text: memory.text,
                importance: memory.importance,
                confidence: memory.confidence,
                tags: memory.tags,
                sourcePath: memory.sourcePath,
              })),
              outputSchema: {
                memoryFormation: {
                  nodes: [
                    {
                      localId: "string",
                      kind: "semantic|goal|preference|reflection|self_model|procedure|relationship",
                      text: "distilled stable memory text",
                      importance: "1|2|3|4|5",
                      confidence: "number 0..1",
                      pinned: "boolean optional",
                      tags: ["semantic recall cues"],
                    },
                  ],
                  edges: [
                    {
                      fromMemoryId: "source episode id optional",
                      toLocalId: "durable node localId optional",
                      relation: "derived_from|supports|elaborates|reinforces|same_entity|temporal_neighbor|contradicts",
                      strength: "number 0..1",
                      confidence: "number 0..1",
                    },
                  ],
                  vaultWrites: [
                    {
                      localId: "string",
                      title: "string",
                      path: "relative markdown path",
                      anchor: "string optional",
                      body: "markdown body following the file spec",
                      memoryLocalIds: ["local ids covered by this file"],
                      tags: ["semantic recall cues"],
                      importance: "1|2|3|4|5 optional",
                      kind: "memory kind optional",
                    },
                  ],
                  rationale: "string",
                },
                archiveSourceMemoryIds: ["source episode IDs absorbed by the dossier"],
                confidence: "number 0..1",
                summary: "short string",
              },
            }),
          },
        ],
        {
          responseFormat: "json",
          temperature: 0.25,
          maxTokens: 1800,
          timeoutMs: 15_000,
        },
      );

      if (!response) {
        return undefined;
      }

      return JSON.parse(response) as ArchiveAgentResponse;
    } catch {
      return undefined;
    }
  }
}

function skipProposal(agentId: "episode-archivist", content: string): AgentProposal {
  return {
    agentId,
    intent: "episode-archive-skip",
    confidence: 0.2,
    content,
  };
}

function normalizeArchiveFormation(plan: Partial<MemoryFormationPlan>): MemoryFormationPlan | undefined {
  const nodes = Array.isArray(plan.nodes) ? plan.nodes.filter(isUsableNode).map(normalizeNode) : [];
  if (nodes.length === 0) {
    return undefined;
  }

  const localIds = new Set(nodes.map((node) => node.localId));
  const edges = Array.isArray(plan.edges)
    ? plan.edges
        .filter((edge) => isUsableEdge(edge, localIds))
        .map((edge) => ({
          fromLocalId: typeof edge.fromLocalId === "string" ? edge.fromLocalId : undefined,
          toLocalId: typeof edge.toLocalId === "string" ? edge.toLocalId : undefined,
          fromMemoryId: typeof edge.fromMemoryId === "string" ? edge.fromMemoryId : undefined,
          toMemoryId: typeof edge.toMemoryId === "string" ? edge.toMemoryId : undefined,
          relation: edge.relation as MemoryRelation,
          strength: clamp01(Number(edge.strength ?? 0.7)),
          confidence: clamp01(Number(edge.confidence ?? 0.8)),
        }))
    : [];

  return {
    nodes,
    edges,
    vaultWrites: normalizeVaultWrites(plan.vaultWrites, localIds),
    rationale: typeof plan.rationale === "string" ? plan.rationale : "Agent-authored episode archive plan.",
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
    confidence: clamp01(Number(node.confidence ?? 0.8)),
    pinned: node.pinned ?? false,
    tags: Array.isArray(node.tags) ? node.tags.filter((tag) => typeof tag === "string") : [],
  };
}

function isUsableEdge(edge: unknown, localIds: Set<string>): edge is NewMemoryEdge {
  if (!edge || typeof edge !== "object") {
    return false;
  }
  const candidate = edge as Partial<NewMemoryEdge>;
  const fromOk = Boolean(candidate.fromMemoryId) || Boolean(candidate.fromLocalId && localIds.has(candidate.fromLocalId));
  const toOk = Boolean(candidate.toMemoryId) || Boolean(candidate.toLocalId && localIds.has(candidate.toLocalId));
  return fromOk && toOk && isRelation(candidate.relation);
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
      typeof candidate.path !== "string" ||
      typeof candidate.body !== "string" ||
      memoryLocalIds.length === 0
    ) {
      return [];
    }

    return [
      {
        localId: candidate.localId,
        title: candidate.title,
        path: candidate.path,
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

function isRelation(value: unknown): value is MemoryRelation {
  return (
    value === "supports" ||
    value === "contradicts" ||
    value === "elaborates" ||
    value === "same_goal" ||
    value === "same_entity" ||
    value === "temporal_neighbor" ||
    value === "derived_from" ||
    value === "reinforces" ||
    value === "supersedes"
  );
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, value));
}

function clampImportance(value: number): 1 | 2 | 3 | 4 | 5 {
  if (value <= 1) return 1;
  if (value === 2) return 2;
  if (value === 3) return 3;
  if (value === 4) return 4;
  return 5;
}
