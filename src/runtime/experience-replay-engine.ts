import { MemoryStore } from "../memory/memory-store.js";
import type {
  ExperienceReplayClusterReport,
  ExperienceReplayReport,
  Importance,
  MemoryFormationPlan,
  MemoryKind,
  MemoryRecord,
  NewMemoryNode,
} from "../types.js";

export interface ExperienceReplayEngineOptions {
  scanLimit: number;
  minClusterSize: number;
  maxClustersPerRun: number;
  maxNewMemoriesPerRun: number;
  intervalMs: number;
  cooldownMs: number;
  archiveLowValueEpisodes: boolean;
  archiveEpisodeBelowScore: number;
  downgradeEpisodeBelowScore: number;
  lowValueEpisodeMinAgeMs: number;
  preserveTags: string[];
}

interface ReplaySource {
  memory: MemoryRecord;
  score: number;
  signals: ReplaySignal[];
}

interface ReplaySignal {
  kind: StableReplayKind;
  key: string;
  tags: string[];
  summary: string;
}

interface ReplayCluster {
  key: string;
  kind: StableReplayKind;
  memories: MemoryRecord[];
  tags: string[];
  summary: string;
  score: number;
}

type StableReplayKind = Extract<MemoryKind, "semantic" | "procedure" | "reflection" | "preference">;

const defaultOptions: ExperienceReplayEngineOptions = {
  scanLimit: 240,
  minClusterSize: 2,
  maxClustersPerRun: 6,
  maxNewMemoriesPerRun: 8,
  intervalMs: 10 * 60_000,
  cooldownMs: 5 * 60_000,
  archiveLowValueEpisodes: true,
  archiveEpisodeBelowScore: 0.24,
  downgradeEpisodeBelowScore: 0.36,
  lowValueEpisodeMinAgeMs: 2 * 60 * 60_000,
  preserveTags: ["pinned", "identity", "self-model", "preference", "goal", "user"],
};

const genericTags = new Set([
  "action",
  "active",
  "autonomous",
  "consolidated",
  "diary",
  "episode",
  "execution",
  "internal",
  "memory",
  "reflection",
  "runtime",
]);

export class ExperienceReplayEngine {
  private timer?: ReturnType<typeof setInterval>;
  private lastRunAt = 0;

  constructor(
    private readonly memory: MemoryStore,
    private readonly options: Partial<ExperienceReplayEngineOptions> = {},
  ) {}

  runIfDue(now = new Date()): ExperienceReplayReport | undefined {
    const options = this.resolvedOptions();
    if (now.getTime() - this.lastRunAt < options.cooldownMs) {
      return undefined;
    }

    return this.runOnce(now);
  }

  runOnce(now = new Date()): ExperienceReplayReport {
    const options = this.resolvedOptions();
    this.lastRunAt = now.getTime();

    const active = this.memory.listActive(options.scanLimit);
    const sources = active
      .map((memory) => toReplaySource(memory))
      .filter((source): source is ReplaySource => source !== undefined);
    const existingStable = active.filter((memory) => isStableKind(memory.kind));
    const clusters = selectReplayClusters(sources, options);
    const report: ExperienceReplayReport = {
      scanned: active.length,
      candidateSources: sources.length,
      clusters: [],
      createdMemoryIds: [],
      reinforcedEdges: 0,
      downgradedEpisodeIds: [],
      archivedEpisodeIds: [],
      skippedReasons: [],
      ranAt: now.toISOString(),
    };

    for (const cluster of clusters) {
      if (report.createdMemoryIds.length >= options.maxNewMemoriesPerRun) {
        report.skippedReasons.push("Reached maxNewMemoriesPerRun before all replay clusters were materialized.");
        break;
      }

      const proposed = stableMemoryFromCluster(cluster);
      const duplicate = findDuplicateStableMemory(proposed, existingStable);
      if (duplicate) {
        for (const source of cluster.memories) {
          this.memory.addEdge({
            fromMemoryId: source.id,
            toMemoryId: duplicate.id,
            relation: "reinforces",
            strength: 0.48,
            confidence: Math.min(source.confidence, duplicate.confidence),
          });
          report.reinforcedEdges += 1;
        }
        report.clusters.push({
          key: cluster.key,
          sourceMemoryIds: cluster.memories.map((memory) => memory.id),
          createdMemoryIds: [],
          skippedReason: `Similar stable ${duplicate.kind} memory already exists.`,
        });
        continue;
      }

      const formation = buildFormationPlan(cluster, proposed);
      const applied = this.memory.applyFormation(formation);
      const createdIds = applied.nodes.map((node) => node.id);
      report.createdMemoryIds.push(...createdIds);
      existingStable.push(...applied.nodes.filter((node) => isStableKind(node.kind)));
      report.clusters.push({
        key: cluster.key,
        sourceMemoryIds: cluster.memories.map((memory) => memory.id),
        createdMemoryIds: createdIds,
      });
    }

    const lowValue = classifyLowValueEpisodes(sources, options, now);
    if (lowValue.downgradeIds.length > 0) {
      const correction = this.memory.applyCorrection({
        operation: "downgrade",
        targetMemoryIds: lowValue.downgradeIds,
        reason: "Experience replay lowered volatile, low-reuse episode memories after extracting stronger patterns.",
      });
      report.downgradedEpisodeIds = lowValue.downgradeIds.slice(0, correction.changed);
    }

    if (options.archiveLowValueEpisodes && lowValue.archiveIds.length > 0) {
      const archived = this.memory.archiveByIds(lowValue.archiveIds, now.toISOString());
      report.archivedEpisodeIds = lowValue.archiveIds.slice(0, archived);
    }

    return report;
  }

  start(onReport?: (report: ExperienceReplayReport) => void, onError?: (error: unknown) => void): void {
    if (this.timer) {
      return;
    }

    const options = this.resolvedOptions();
    this.timer = setInterval(() => {
      try {
        const report = this.runIfDue();
        if (report) {
          onReport?.(report);
        }
      } catch (error) {
        onError?.(error);
      }
    }, options.intervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = undefined;
  }

  private resolvedOptions(): ExperienceReplayEngineOptions {
    return {
      ...defaultOptions,
      ...this.options,
      preserveTags: [...defaultOptions.preserveTags, ...(this.options.preserveTags ?? [])],
    };
  }
}

function toReplaySource(memory: MemoryRecord): ReplaySource | undefined {
  const signals = replaySignalsFor(memory);
  if (signals.length === 0) {
    return undefined;
  }

  return {
    memory,
    score: sourceReplayScore(memory, signals),
    signals,
  };
}

function replaySignalsFor(memory: MemoryRecord): ReplaySignal[] {
  const text = memory.text.toLowerCase();
  const tags = memory.tags.map((tag) => tag.toLowerCase());
  const isEpisode = memory.kind === "episode";
  const isAction = tags.includes("action") || text.startsWith("action executed:");
  const isAutonomous = tags.includes("autonomous") || text.includes("autonomous");
  if (!isEpisode && !isAction && !isAutonomous) {
    return [];
  }

  const topic = topicKey(memory);
  const signals: ReplaySignal[] = [];
  if (isAction) {
    signals.push({
      kind: "procedure",
      key: `procedure:${topic}`,
      tags: compactTags(["experience-replay", "procedure", "action", ...memory.tags]),
      summary: summarizeTopic(memory),
    });
    signals.push({
      kind: "semantic",
      key: `semantic:${topic}`,
      tags: compactTags(["experience-replay", "semantic", "action", ...memory.tags]),
      summary: summarizeTopic(memory),
    });
  }

  if (isAutonomous) {
    signals.push({
      kind: "reflection",
      key: `reflection:${topic}`,
      tags: compactTags(["experience-replay", "reflection", "autonomous", ...memory.tags]),
      summary: summarizeTopic(memory),
    });
  }

  if (looksLikePreferenceSignal(memory)) {
    signals.push({
      kind: "preference",
      key: `preference:${topic}`,
      tags: compactTags(["experience-replay", "preference", ...memory.tags]),
      summary: summarizeTopic(memory),
    });
  }

  if (signals.length === 0 && isEpisode) {
    signals.push({
      kind: "semantic",
      key: `semantic:${topic}`,
      tags: compactTags(["experience-replay", "semantic", ...memory.tags]),
      summary: summarizeTopic(memory),
    });
  }

  return signals;
}

function selectReplayClusters(
  sources: ReplaySource[],
  options: ExperienceReplayEngineOptions,
): ReplayCluster[] {
  const groups = new Map<string, ReplayCluster>();

  for (const source of sources) {
    for (const signal of source.signals) {
      const existing = groups.get(signal.key);
      if (existing) {
        existing.memories.push(source.memory);
        existing.score += source.score;
        existing.tags = compactTags([...existing.tags, ...signal.tags]);
        continue;
      }

      groups.set(signal.key, {
        key: signal.key,
        kind: signal.kind,
        memories: [source.memory],
        tags: signal.tags,
        summary: signal.summary,
        score: source.score,
      });
    }
  }

  const used = new Set<string>();
  return [...groups.values()]
    .map((cluster) => ({
      ...cluster,
      memories: dedupeById(cluster.memories).sort((left, right) => memoryStrength(right) - memoryStrength(left)),
    }))
    .filter((cluster) => cluster.memories.length >= options.minClusterSize)
    .sort((left, right) => right.score - left.score)
    .flatMap((cluster) => {
      const selected = cluster.memories.filter((memory) => !used.has(memory.id)).slice(0, 6);
      if (selected.length < options.minClusterSize) {
        return [];
      }

      for (const memory of selected) {
        used.add(memory.id);
      }

      return [
        {
          ...cluster,
          memories: selected,
          score: selected.reduce((sum, memory) => sum + memoryStrength(memory), 0),
        },
      ];
    })
    .slice(0, options.maxClustersPerRun);
}

function stableMemoryFromCluster(cluster: ReplayCluster): NewMemoryNode {
  const strongest = cluster.memories[0];
  const summary = summarizeCluster(cluster);
  const confidence = clamp01(
    0.54 +
      Math.min(cluster.memories.length, 5) * 0.06 +
      average(cluster.memories.map((memory) => memory.confidence)) * 0.22,
  );

  return {
    localId: "stable",
    kind: cluster.kind,
    text: renderStableText(cluster.kind, summary),
    importance: normalizeImportance(Math.max(2, Math.min(4, Math.round(strongest.importance + cluster.memories.length / 3)))),
    confidence,
    tags: compactTags(["experience-replay", "stable", cluster.kind, ...cluster.tags]),
  };
}

function buildFormationPlan(cluster: ReplayCluster, node: NewMemoryNode): MemoryFormationPlan {
  return {
    nodes: [node],
    edges: cluster.memories.map((source) => ({
      fromMemoryId: source.id,
      toLocalId: node.localId,
      relation: "derived_from",
      strength: cluster.kind === "procedure" ? 0.74 : 0.66,
      confidence: Math.min(source.confidence, node.confidence ?? 1),
    })),
    rationale: "Experience replay distilled repeated active episode/action/autonomous memories into a durable stable memory.",
  };
}

function findDuplicateStableMemory(node: NewMemoryNode, stableMemories: MemoryRecord[]): MemoryRecord | undefined {
  const normalized = normalizeText(node.text);
  return stableMemories.find((memory) => memory.kind === node.kind && similarity(normalized, normalizeText(memory.text)) >= 0.88);
}

function classifyLowValueEpisodes(
  sources: ReplaySource[],
  options: ExperienceReplayEngineOptions,
  now: Date,
): { downgradeIds: string[]; archiveIds: string[] } {
  const downgradeIds: string[] = [];
  const archiveIds: string[] = [];

  for (const source of sources) {
    const memory = source.memory;
    if (memory.kind !== "episode" || memory.pinned || hasPreservedTag(memory, options.preserveTags)) {
      continue;
    }

    const score = episodeValueScore(memory);
    if (score < options.archiveEpisodeBelowScore && ageMs(memory.createdAt, now) >= options.lowValueEpisodeMinAgeMs) {
      archiveIds.push(memory.id);
      continue;
    }

    if (score < options.downgradeEpisodeBelowScore) {
      downgradeIds.push(memory.id);
    }
  }

  return {
    downgradeIds: [...new Set(downgradeIds)].slice(0, 24),
    archiveIds: [...new Set(archiveIds)].slice(0, 24),
  };
}

function renderStableText(kind: StableReplayKind, summary: string): string {
  if (kind === "procedure") {
    return `Procedure from experience replay: when this thread recurs, use the repeatable step around ${summary}.`;
  }

  if (kind === "reflection") {
    return `Reflection from experience replay: autonomous cycles repeatedly return to ${summary}, so keep it available as continuity context.`;
  }

  if (kind === "preference") {
    return `Preference from experience replay: repeated memories indicate a durable preference signal around ${summary}.`;
  }

  return `Semantic pattern from experience replay: recent active memories repeatedly point to ${summary}.`;
}

function summarizeCluster(cluster: ReplayCluster): string {
  const tag = cluster.tags.find((candidate) => !genericTags.has(candidate.toLowerCase()) && candidate.length >= 4);
  if (tag) {
    return `"${tag}"`;
  }

  return cluster.summary;
}

function summarizeTopic(memory: MemoryRecord): string {
  const action = actionLabel(memory.text);
  if (action) {
    return `"${action}" actions`;
  }

  const tag = memory.tags.find((candidate) => !genericTags.has(candidate.toLowerCase()) && candidate.length >= 4);
  if (tag) {
    return `"${tag}"`;
  }

  const words = contentWords(memory.text).slice(0, 4);
  return words.length > 0 ? words.join(" ") : `"${memory.kind}" memories`;
}

function topicKey(memory: MemoryRecord): string {
  const action = actionLabel(memory.text);
  if (action) {
    return slug(action);
  }

  const tag = memory.tags.find((candidate) => !genericTags.has(candidate.toLowerCase()) && candidate.length >= 4);
  if (tag) {
    return slug(tag);
  }

  const words = contentWords(memory.text).slice(0, 3);
  return words.length > 0 ? words.join("-") : memory.kind;
}

function actionLabel(text: string): string | undefined {
  const match = text.match(/^Action executed:\s*([^.]*)\./i);
  return match?.[1]?.trim();
}

function looksLikePreferenceSignal(memory: MemoryRecord): boolean {
  const text = memory.text.toLowerCase();
  const tags = memory.tags.map((tag) => tag.toLowerCase());
  return (
    memory.kind === "preference" ||
    tags.some((tag) => tag.includes("preference") || tag.includes("desire") || tag.includes("habit")) ||
    ["prefer", "preference", "likes", "wants", "emerging preference"].some((term) => text.includes(term))
  );
}

function sourceReplayScore(memory: MemoryRecord, signals: ReplaySignal[]): number {
  const recency = Math.max(0, 1 - ageMs(memory.createdAt, new Date()) / (7 * 24 * 60 * 60_000));
  return memoryStrength(memory) + signals.length * 0.16 + recency * 0.18;
}

function memoryStrength(memory: MemoryRecord): number {
  return (
    memory.importance * 0.22 +
    memory.confidence * 0.36 +
    Math.min(memory.accessCount / 8, 1) * 0.16 +
    (memory.pinned ? 0.28 : 0)
  );
}

function episodeValueScore(memory: MemoryRecord): number {
  const isSayAction = memory.tags.includes("say") || memory.text.toLowerCase().includes("action executed: say");
  const isWaitAction = memory.tags.includes("wait") || memory.text.toLowerCase().includes("action executed: wait");
  const actionPenalty = isSayAction || isWaitAction ? 0.14 : 0;
  return clamp01(memoryStrength(memory) - actionPenalty);
}

function hasPreservedTag(memory: MemoryRecord, preserveTags: string[]): boolean {
  const normalized = new Set(preserveTags.map((tag) => tag.toLowerCase()));
  return memory.tags.some((tag) => normalized.has(tag.toLowerCase()));
}

function isStableKind(kind: MemoryKind): kind is StableReplayKind {
  return kind === "semantic" || kind === "procedure" || kind === "reflection" || kind === "preference";
}

function compactTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
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

function contentWords(text: string): string[] {
  return normalizeText(text)
    .split(/[^a-z0-9\u3400-\u9fff]+/i)
    .filter((word) => word.length >= 4 && !isStopWord(word))
    .slice(0, 8);
}

function isStopWord(word: string): boolean {
  return [
    "about",
    "action",
    "after",
    "around",
    "autonomous",
    "cycle",
    "executed",
    "from",
    "internal",
    "memory",
    "output",
    "that",
    "this",
    "with",
  ].includes(word);
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "general";
}

function similarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }

  const leftWords = new Set(contentWords(left));
  const rightWords = new Set(contentWords(right));
  if (leftWords.size === 0 || rightWords.size === 0) {
    return 0;
  }

  const intersection = [...leftWords].filter((word) => rightWords.has(word)).length;
  return intersection / Math.max(leftWords.size, rightWords.size);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeImportance(value: number): Importance {
  if (value <= 1) return 1;
  if (value === 2) return 2;
  if (value === 3) return 3;
  if (value === 4) return 4;
  return 5;
}

function ageMs(iso: string, now: Date): number {
  return Math.max(0, now.getTime() - new Date(iso).getTime());
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
