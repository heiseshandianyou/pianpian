import { MemoryStore } from "./memory-store.js";
import { MemoryConsolidationAgent } from "../agents/memory-consolidation-agent.js";
import type { LlmProvider } from "../llm/types.js";
import type {
  ConsolidationClusterReport,
  ConsolidationReport,
  MemoryRecord,
} from "../types.js";

export interface MemoryConsolidationOptions {
  minClusterSize: number;
  scanLimit: number;
  relatedClusterMinSize: number;
  relatedClusterLimit: number;
}

const defaultOptions: MemoryConsolidationOptions = {
  minClusterSize: 2,
  scanLimit: 1_000,
  relatedClusterMinSize: 3,
  relatedClusterLimit: 4,
};

export class MemoryConsolidationEngine {
  constructor(
    private readonly memory: MemoryStore,
    private readonly options: Partial<MemoryConsolidationOptions> = {},
    private readonly llm?: LlmProvider,
  ) {}

  consolidateExactDuplicates(): ConsolidationReport {
    const options = { ...defaultOptions, ...this.options };
    const active = this.memory.listActive(options.scanLimit);
    const clusters = groupByDuplicateKey(active).filter(
      (cluster) => cluster.memories.length >= options.minClusterSize,
    );
    const reports: ConsolidationClusterReport[] = [];
    let archived = 0;

    for (const cluster of clusters) {
      const kept = chooseKeeper(cluster.memories);
      const duplicates = cluster.memories.filter((memory) => memory.id !== kept.id);
      const duplicateIds = duplicates.map((memory) => memory.id);

      for (const duplicate of duplicates) {
        this.memory.addEdge({
          fromMemoryId: duplicate.id,
          toMemoryId: kept.id,
          relation: "reinforces",
          strength: 0.75,
          confidence: Math.min(duplicate.confidence, kept.confidence),
        });
        this.memory.addEdge({
          fromMemoryId: kept.id,
          toMemoryId: duplicate.id,
          relation: "supersedes",
          strength: 0.9,
          confidence: Math.min(duplicate.confidence, kept.confidence),
        });
      }

      archived += this.memory.archiveByIds(duplicateIds);
      reports.push({
        key: cluster.key,
        keptMemoryId: kept.id,
        archivedMemoryIds: duplicateIds,
        reason: "Exact normalized duplicate cluster; kept the strongest memory and archived redundant nodes.",
      });
    }

    return {
      scanned: active.length,
      duplicateClusters: reports.length,
      llmClusters: 0,
      archived,
      clusters: reports,
    };
  }

  async consolidateRelatedMemories(): Promise<ConsolidationReport> {
    const options = { ...defaultOptions, ...this.options };
    const active = this.memory
      .listActive(options.scanLimit)
      .filter((memory) => !memory.pinned && memory.kind !== "self_model");
    const clusters = findRelatedClusters(active, options.relatedClusterMinSize).slice(
      0,
      options.relatedClusterLimit,
    );
    const agent = new MemoryConsolidationAgent(this.llm);
    const reports: ConsolidationClusterReport[] = [];
    let archived = 0;

    for (const cluster of clusters) {
      const proposal = await agent.propose(cluster.memories);
      if (!proposal) {
        continue;
      }

      const consolidated = this.memory.add({
        ...proposal.memory,
        tags: ["consolidated", ...(proposal.memory.tags ?? [])],
      });

      for (const source of cluster.memories) {
        this.memory.addEdge({
          fromMemoryId: source.id,
          toMemoryId: consolidated.id,
          relation: "reinforces",
          strength: 0.7,
          confidence: Math.min(source.confidence, consolidated.confidence),
        });
        this.memory.addEdge({
          fromMemoryId: consolidated.id,
          toMemoryId: source.id,
          relation: "supersedes",
          strength: 0.85,
          confidence: Math.min(source.confidence, consolidated.confidence),
        });
      }

      const archivedIds = cluster.memories.map((memory) => memory.id);
      archived += this.memory.archiveByIds(archivedIds);
      reports.push({
        key: cluster.key,
        keptMemoryId: consolidated.id,
        consolidatedMemoryId: consolidated.id,
        archivedMemoryIds: archivedIds,
        reason: proposal.rationale,
      });
    }

    return {
      scanned: active.length,
      duplicateClusters: 0,
      llmClusters: reports.length,
      archived,
      clusters: reports,
    };
  }
}

interface DuplicateCluster {
  key: string;
  memories: MemoryRecord[];
}

function groupByDuplicateKey(memories: MemoryRecord[]): DuplicateCluster[] {
  const groups = new Map<string, MemoryRecord[]>();

  for (const memory of memories) {
    const key = `${memory.kind}:${normalizeText(memory.text)}`;
    const group = groups.get(key) ?? [];
    group.push(memory);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([key, group]) => ({
    key,
    memories: group,
  }));
}

function chooseKeeper(memories: MemoryRecord[]): MemoryRecord {
  return [...memories].sort((left, right) => memoryStrength(right) - memoryStrength(left))[0];
}

function memoryStrength(memory: MemoryRecord): number {
  return (
    memory.importance * 0.35 +
    memory.confidence * 2 +
    Math.min(memory.accessCount, 10) * 0.1 +
    (memory.pinned ? 2 : 0)
  );
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

interface RelatedCluster {
  key: string;
  memories: MemoryRecord[];
}

function findRelatedClusters(memories: MemoryRecord[], minSize: number): RelatedCluster[] {
  const byTag = new Map<string, MemoryRecord[]>();

  for (const memory of memories) {
    const keys = candidateKeys(memory);
    for (const key of keys) {
      const group = byTag.get(key) ?? [];
      group.push(memory);
      byTag.set(key, group);
    }
  }

  const used = new Set<string>();
  const clusters: RelatedCluster[] = [];
  for (const [key, group] of byTag.entries()) {
    const unique = dedupeById(group).filter((memory) => !used.has(memory.id));
    if (unique.length < minSize) {
      continue;
    }

    const sorted = unique.sort((left, right) => memoryStrength(right) - memoryStrength(left));
    const selected = sorted.slice(0, Math.min(6, sorted.length));
    for (const memory of selected) {
      used.add(memory.id);
    }
    clusters.push({
      key,
      memories: selected,
    });
  }

  return clusters;
}

function candidateKeys(memory: MemoryRecord): string[] {
  const tags = memory.tags.filter((tag) => tag.length > 2).map((tag) => `tag:${tag.toLowerCase()}`);
  const words = normalizeText(memory.text)
    .split(/\W+/)
    .filter((word) => word.length >= 6)
    .slice(0, 4)
    .map((word) => `word:${word}`);
  return [...new Set([...tags, ...words])];
}

function dedupeById(memories: MemoryRecord[]): MemoryRecord[] {
  const seen = new Set<string>();
  const result: MemoryRecord[] = [];
  for (const memory of memories) {
    if (seen.has(memory.id)) {
      continue;
    }
    seen.add(memory.id);
    result.push(memory);
  }
  return result;
}
