import { MemoryStore } from "./memory-store.js";
import type {
  ActivatedEntityNode,
  ActivatedMemoryGraph,
  ActivatedMemoryNode,
  ActivationTrace,
  EntityRecord,
  MemoryEdgeRecord,
  MemoryRecord,
  MemoryRelation,
  RecallQuery,
} from "../types.js";

export class MemoryActivationEngine {
  constructor(private readonly memory: MemoryStore) {}

  recall(input: string, overrides: Partial<RecallQuery> = {}): ActivatedMemoryGraph {
    const query: RecallQuery = {
      rawInput: input,
      taskIntent: overrides.taskIntent ?? inferTaskIntent(input),
      seedLimit: overrides.seedLimit ?? 8,
      entityLimit: overrides.entityLimit ?? 6,
      entitySeedLimit: overrides.entitySeedLimit ?? 12,
      maxDepth: overrides.maxDepth ?? 2,
      maxNodes: overrides.maxNodes ?? 16,
    };

    const textSeeds = this.memory.retrieve(query.rawInput, query.seedLimit);
    const identitySeeds = isIdentityQuery(query.rawInput)
      ? this.memory
          .listActive(300)
          .filter(isIdentityMemory)
          .slice(0, 8)
      : [];
    const pinnedSeeds = this.memory.listPinnedActive(8);
    const matchedEntities = this.memory.findEntitiesMentionedInText(query.rawInput, query.entityLimit);
    const entitySeeds = this.memory.listActiveMemoriesForEntityIds(
      matchedEntities.map((entity) => entity.id),
      query.entitySeedLimit,
    );
    const entityLinks = this.memory.listMemoryEntityLinksForEntityIds(
      matchedEntities.map((entity) => entity.id),
    );
    const linkedMemoryIdsByEntity = groupLinkedMemoryIdsByEntity(entityLinks);
    const activation = new Map<string, ActivatedMemoryNode>();
    const trace: ActivationTrace[] = [];

    for (const seed of textSeeds) {
      const amount = seedActivation(seed);
      addActivation(activation, seed, amount, 0, "seed retrieval");
      trace.push({
        toMemoryId: seed.id,
        amount,
        reason: "Seed memory matched the current recall query.",
      });
    }

    for (const seed of identitySeeds) {
      const amount = Math.max(0.9, seedActivation(seed));
      addActivation(activation, seed, amount, 0, "identity continuity memory");
      trace.push({
        toMemoryId: seed.id,
        amount,
        reason: "Identity memory was included for a self/user identity question.",
      });
    }

    for (const seed of entitySeeds) {
      const amount = seedActivation(seed) * 0.92;
      addActivation(activation, seed, amount, 0, "entity-linked seed retrieval");
      trace.push({
        toMemoryId: seed.id,
        amount,
        reason: "Seed memory was linked to an entity mentioned in the current input.",
      });
    }

    for (const seed of pinnedSeeds) {
      const amount = seedActivation(seed);
      addActivation(activation, seed, amount, 0, "pinned continuity memory");
      trace.push({
        toMemoryId: seed.id,
        amount,
        reason: "Pinned memory was included for self-continuity.",
      });
    }

    let frontier = [...new Set([...textSeeds, ...identitySeeds, ...entitySeeds, ...pinnedSeeds].map((seed) => seed.id))];
    for (let depth = 1; depth <= query.maxDepth; depth += 1) {
      if (frontier.length === 0) {
        break;
      }

      const edges = this.memory.listEdgesForMemoryIds(frontier);
      const nextFrontier = new Set<string>();
      const targetIds = new Set<string>();
      const propagated: Array<{
        edge: MemoryEdgeRecord;
        targetId: string;
        amount: number;
      }> = [];

      for (const edge of edges) {
        const fromActive = activation.get(edge.fromMemoryId);
        const toActive = activation.get(edge.toMemoryId);
        const propagationPairs = [
          { source: fromActive, targetId: edge.toMemoryId, direction: "forward" },
          { source: toActive, targetId: edge.fromMemoryId, direction: "backward" },
        ] as const;

        for (const pair of propagationPairs) {
          if (!pair.source || pair.source.depth >= depth) {
            continue;
          }

          const amount =
            pair.source.activation *
            edge.strength *
            edge.confidence *
            relationWeight(edge.relation, pair.direction) *
            depthDecay(depth);

          if (amount < 0.04) {
            continue;
          }

          targetIds.add(pair.targetId);
          propagated.push({
            edge,
            targetId: pair.targetId,
            amount,
          });
        }
      }

      const memoriesById = new Map(this.memory.getByIds([...targetIds]).map((memory) => [memory.id, memory]));
      for (const item of propagated) {
        const target = memoriesById.get(item.targetId);
        if (!target) {
          continue;
        }

        addActivation(
          activation,
          target,
          item.amount,
          depth,
          `activated through ${item.edge.relation}`,
        );
        nextFrontier.add(target.id);
        trace.push({
          fromMemoryId:
            item.edge.fromMemoryId === target.id ? item.edge.toMemoryId : item.edge.fromMemoryId,
          toMemoryId: target.id,
          relation: item.edge.relation,
          amount: item.amount,
          reason: `Activation propagated through ${item.edge.relation}.`,
        });
      }

      frontier = [...nextFrontier];
    }

    const ranked = [...activation.values()]
      .sort((left, right) => right.activation - left.activation)
      .slice(0, query.maxNodes);

    return {
      query,
      entityNodes: buildEntityNodes(matchedEntities, linkedMemoryIdsByEntity, activation),
      focusNodes: ranked.slice(0, Math.min(6, ranked.length)),
      supportNodes: ranked.slice(6),
      contradictionNodes: ranked.filter((node) =>
        node.reasons.some((reason) => reason.includes("contradicts")),
      ),
      activationTrace: trace.sort((left, right) => right.amount - left.amount).slice(0, 50),
    };
  }
}

function addActivation(
  activation: Map<string, ActivatedMemoryNode>,
  memory: MemoryRecord,
  amount: number,
  depth: number,
  reason: string,
): void {
  const existing = activation.get(memory.id);
  if (!existing) {
    activation.set(memory.id, {
      memory,
      activation: amount,
      depth,
      reasons: [reason],
    });
    return;
  }

  existing.activation = Math.min(1, existing.activation + amount);
  existing.depth = Math.min(existing.depth, depth);
  existing.reasons.push(reason);
}

function seedActivation(memory: MemoryRecord): number {
  const importance = memory.importance / 5;
  const confidence = memory.confidence;
  const reuse = Math.min(memory.accessCount / 10, 1);
  const pinnedBoost = memory.pinned ? 0.12 : 0;
  return clamp01(0.45 * importance + 0.35 * confidence + 0.2 * reuse + pinnedBoost);
}

function buildEntityNodes(
  entities: EntityRecord[],
  linkedMemoryIdsByEntity: Map<string, string[]>,
  activation: Map<string, ActivatedMemoryNode>,
): ActivatedEntityNode[] {
  return entities
    .map((entity) => {
      const linkedMemoryIds = linkedMemoryIdsByEntity.get(entity.id) ?? [];
      const activeLinkedMemories = linkedMemoryIds
        .map((memoryId) => activation.get(memoryId)?.activation ?? 0)
        .filter((amount) => amount > 0);
      const strongestMemoryActivation =
        activeLinkedMemories.length > 0 ? Math.max(...activeLinkedMemories) : 0;

      return {
        entity,
        linkedMemoryIds,
        activation: clamp01(0.45 * entity.confidence + 0.55 * strongestMemoryActivation),
        reasons: ["Entity name or alias matched the current input."],
      };
    })
    .sort((left, right) => right.activation - left.activation);
}

function groupLinkedMemoryIdsByEntity(
  links: Array<{ entityId: string; memoryId: string }>,
): Map<string, string[]> {
  const grouped = new Map<string, Set<string>>();
  for (const link of links) {
    const existing = grouped.get(link.entityId) ?? new Set<string>();
    existing.add(link.memoryId);
    grouped.set(link.entityId, existing);
  }

  return new Map([...grouped.entries()].map(([entityId, memoryIds]) => [entityId, [...memoryIds]]));
}

function relationWeight(relation: MemoryRelation, direction: "forward" | "backward"): number {
  const base: Record<MemoryRelation, number> = {
    derived_from: direction === "forward" ? 0.85 : 0.55,
    supports: 0.8,
    contradicts: 0.75,
    elaborates: 0.7,
    same_goal: 0.9,
    same_entity: 0.82,
    temporal_neighbor: 0.55,
    reinforces: 0.78,
    supersedes: direction === "forward" ? 0.2 : 0.05,
  };
  return base[relation];
}

function depthDecay(depth: number): number {
  return Math.pow(0.72, depth);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function inferTaskIntent(input: string): string {
  const normalized = input.trim();
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 117)}...`;
}

function isIdentityQuery(input: string): boolean {
  const normalized = input.toLowerCase();
  return [
    "我是谁",
    "你是谁",
    "我叫什么",
    "你叫什么",
    "我的名字",
    "你的名字",
    "who am i",
    "who are you",
    "what is my name",
    "what is your name",
  ].some((term) => normalized.includes(term));
}

function isIdentityMemory(memory: MemoryRecord): boolean {
  const text = memory.text.toLowerCase();
  if (memory.tags.some((tag) => ["identity", "name"].includes(tag))) {
    return true;
  }

  return [
    "卢静涵",
    "静涵",
    "林悔儿",
    "林翩翩",
    "the user's name is",
    "pianpian's chosen name is",
    "我是卢静涵",
    "我叫林悔儿",
    "我叫林翩翩",
    "你是林翩翩",
    "悔儿是我的本名",
    "翩翩是我的艺名",
    "我的名字是",
    "你的名字叫",
  ].some((term) => text.includes(term.toLowerCase()));
}
