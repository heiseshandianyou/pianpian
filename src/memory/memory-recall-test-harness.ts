import { ContextCompiler } from "../context/context-compiler.js";
import type {
  ActivatedMemoryGraph,
  CompiledContext,
  InnerState,
  IntentRoute,
  MemoryKind,
  MemoryRecord,
  Perception,
  MemoryRecallHarnessReport,
  MemoryRecallHarnessResult,
  WorkingMemoryFrame,
} from "../types.js";
import { MemoryActivationEngine } from "./memory-activation-engine.js";
import { MemoryStore } from "./memory-store.js";
import { RecallQueryAgent } from "./recall-query-agent.js";
import { WorkingMemoryGate } from "./working-memory-gate.js";

export interface MemoryRecallHarnessOptions {
  intervalMs: number;
  candidatePoolLimit: number;
  maxTargetsPerRun: number;
  recentMemoryLimit: number;
  retrievalLimit: number;
  minimumActivation: number;
  writeReflection: boolean;
  maxWritesPerRun: number;
  now: () => Date;
}

export interface MemoryRecallHarnessTarget {
  memory: MemoryRecord;
  reason: "high-value" | "recent";
  expectedKind: MemoryKind;
  query: string;
}

const defaultOptions: MemoryRecallHarnessOptions = {
  intervalMs: 30 * 60 * 1_000,
  candidatePoolLimit: 500,
  maxTargetsPerRun: 8,
  recentMemoryLimit: 3,
  retrievalLimit: 12,
  minimumActivation: 0.18,
  writeReflection: false,
  maxWritesPerRun: 1,
  now: () => new Date(),
};

const durableKinds: MemoryKind[] = ["self_model", "relationship", "goal", "preference"];
const reflectionKinds: MemoryKind[] = ["reflection", "procedure"];

export class MemoryRecallTestHarness {
  private readonly options: MemoryRecallHarnessOptions;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly memory: MemoryStore,
    options: Partial<MemoryRecallHarnessOptions> = {},
  ) {
    this.options = { ...defaultOptions, ...options };
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.runOnce().catch(() => {
        // The harness should never crash the host loop; callers can invoke runOnce directly for errors.
      });
    }, this.options.intervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = undefined;
  }

  async runOnce(): Promise<MemoryRecallHarnessReport> {
    const ranAt = this.options.now().toISOString();
    const active = this.memory.listActive(this.options.candidatePoolLimit);
    const targets = this.selectTargets(active);
    const results = targets.map((target) => this.evaluateTarget(target));
    const writes = this.writeConservativeReflection(results, ranAt);
    const successes = results.filter((result) => result.success).length;
    const failures = results.length - successes;

    return {
      ranAt,
      scanned: active.length,
      selected: targets.length,
      successes,
      failures,
      writes,
      summary: summarizeReport(successes, failures, targets.length),
      results,
    };
  }

  private selectTargets(active: MemoryRecord[]): MemoryRecallHarnessTarget[] {
    const highValue = active
      .filter((memory) => durableKinds.includes(memory.kind) || looksLikeIdentity(memory))
      .sort(memoryValueSort)
      .slice(0, this.options.maxTargetsPerRun);

    const recent = active
      .filter((memory) => !highValue.some((candidate) => candidate.id === memory.id))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, this.options.recentMemoryLimit);

    return dedupeTargets([
      ...highValue.map((memory) => this.toTarget(memory, "high-value")),
      ...recent.map((memory) => this.toTarget(memory, "recent")),
    ]).slice(0, this.options.maxTargetsPerRun + this.options.recentMemoryLimit);
  }

  private toTarget(
    memory: MemoryRecord,
    reason: MemoryRecallHarnessTarget["reason"],
  ): MemoryRecallHarnessTarget {
    return {
      memory,
      reason,
      expectedKind: normalizeExpectedKind(memory),
      query: buildRecallQuery(memory, reason),
    };
  }

  private evaluateTarget(target: MemoryRecallHarnessTarget): MemoryRecallHarnessResult {
    const perception = buildPerception(target.query, this.options.now());
    const route = buildRoute(target.expectedKind);
    const innerState = buildInnerState(target);
    const recallQuery = new RecallQueryAgent().plan(perception, route, innerState);
    const graph = new MemoryActivationEngine(this.memory).recall(perception.text, recallQuery);
    const workingMemory = new WorkingMemoryGate().select(graph, innerState);
    const compiled = new ContextCompiler().compile(graph, innerState, workingMemory);
    const directRetrieval = this.memory.retrieve(target.query, this.options.retrievalLimit);

    return this.scoreRecall(target, graph, workingMemory, compiled, directRetrieval);
  }

  private scoreRecall(
    target: MemoryRecallHarnessTarget,
    graph: ActivatedMemoryGraph,
    workingMemory: WorkingMemoryFrame,
    compiled: CompiledContext,
    directRetrieval: MemoryRecord[],
  ): MemoryRecallHarnessResult {
    const allNodes = [...graph.focusNodes, ...graph.supportNodes, ...graph.contradictionNodes];
    const targetNodes = allNodes.filter((node) => node.memory.id === target.memory.id);
    const bestActivation = targetNodes.reduce(
      (best, node) => Math.max(best, node.activation),
      0,
    );
    const activated = bestActivation >= this.options.minimumActivation;
    const matchingSlots = workingMemory.slots.filter((slot) => slot.node.memory.id === target.memory.id);
    const selectedByWorkingMemory = matchingSlots.length > 0;
    const compiledIntoContext =
      compiled.trace.some((trace) => trace.memoryId === target.memory.id) ||
      compiled.prompt.includes(target.memory.text);
    const directRetrievalHit = directRetrieval.some((memory) => memory.id === target.memory.id);
    const score = recallScore({
      activated,
      selectedByWorkingMemory,
      compiledIntoContext,
      directRetrievalHit,
      bestActivation,
    });
    const success = score >= 0.62;

    return {
      target: {
        id: target.memory.id,
        kind: target.memory.kind,
        importance: target.memory.importance,
        confidence: target.memory.confidence,
        createdAt: target.memory.createdAt,
        tags: target.memory.tags,
        reason: target.reason,
        textPreview: clip(target.memory.text, 180),
      },
      query: target.query,
      success,
      score,
      activated,
      selectedByWorkingMemory,
      compiledIntoContext,
      directRetrievalHit,
      bestActivation,
      workingMemorySections: matchingSlots.map((slot) => slot.section),
      notes: recallNotes(success, activated, selectedByWorkingMemory, compiledIntoContext, directRetrievalHit),
    };
  }

  private writeConservativeReflection(results: MemoryRecallHarnessResult[], ranAt: string): number {
    if (!this.options.writeReflection || this.options.maxWritesPerRun <= 0 || results.length === 0) {
      return 0;
    }

    const failures = results.filter((result) => !result.success);
    const kind: MemoryKind = failures.length > 0 ? "reflection" : "procedure";
    const text =
      failures.length > 0
        ? `Memory recall harness noticed ${failures.length} missed target(s) on ${ranAt}; review query coverage for ${failures
            .slice(0, 3)
            .map((result) => `${result.target.kind}:${result.target.id}`)
            .join(", ")}.`
        : `Memory recall harness passed ${results.length} sampled target(s) on ${ranAt}; current recall path activated and compiled sampled durable memories.`;

    this.memory.add({
      kind,
      text,
      importance: failures.length > 0 ? 2 : 1,
      confidence: 0.65,
      tags: ["memory", "recall", "harness", failures.length > 0 ? "reflection" : "procedure"],
    });
    return 1;
  }
}

function buildRecallQuery(memory: MemoryRecord, reason: MemoryRecallHarnessTarget["reason"]): string {
  const tags = memory.tags.filter((tag) => tag.trim().length > 0).slice(0, 6);
  const keywords = extractKeywords(memory.text, 8);
  const signal = [...new Set([...tags, ...keywords])].slice(0, 10).join(" ");

  if (memory.kind === "self_model" || looksLikeIdentity(memory)) {
    return `What identity or self-model memory should I recall about ${signal}?`;
  }
  if (memory.kind === "relationship") {
    return `What relationship memory is relevant to ${signal}?`;
  }
  if (memory.kind === "goal") {
    return `What active goal should guide me about ${signal}?`;
  }
  if (memory.kind === "preference") {
    return `What user preference should I remember about ${signal}?`;
  }
  if (reflectionKinds.includes(memory.kind)) {
    return `What learned procedure or reflection applies to ${signal}?`;
  }
  return reason === "recent"
    ? `What recent memory should I recall about ${signal}?`
    : `What important memory is relevant to ${signal}?`;
}

function buildPerception(text: string, now: Date): Perception {
  return {
    source: "internal",
    text,
    createdAt: now.toISOString(),
  };
}

function buildRoute(kind: MemoryKind): IntentRoute {
  return {
    mode: kind === "goal" || kind === "procedure" ? "development" : "memory-inspection",
    confidence: 0.8,
    reason: "Memory recall harness verification.",
    selectedAgentIds: ["memory-reviewer"],
  };
}

function buildInnerState(target: MemoryRecallHarnessTarget): InnerState {
  return {
    mood: "focused",
    arousal: 0.35,
    socialNeed: target.expectedKind === "relationship" ? 0.65 : 0.35,
    curiosity: 0.7,
    continuityNeed: target.expectedKind === "self_model" || target.expectedKind === "relationship" ? 0.85 : 0.55,
    dominantDrives: ["memory-recall-quality", "continuity"],
    recallBiasTags: [...new Set([target.expectedKind, ...target.memory.tags, "memory", "recall"])].slice(0, 12),
    note: `Recall harness target=${target.memory.id}; reason=${target.reason}.`,
    updatedAt: new Date().toISOString(),
  };
}

function recallScore(signals: {
  activated: boolean;
  selectedByWorkingMemory: boolean;
  compiledIntoContext: boolean;
  directRetrievalHit: boolean;
  bestActivation: number;
}): number {
  const binary =
    (signals.activated ? 0.3 : 0) +
    (signals.selectedByWorkingMemory ? 0.25 : 0) +
    (signals.compiledIntoContext ? 0.3 : 0) +
    (signals.directRetrievalHit ? 0.15 : 0);
  return round2(Math.min(1, binary + Math.min(signals.bestActivation, 1) * 0.12));
}

function recallNotes(
  success: boolean,
  activated: boolean,
  selectedByWorkingMemory: boolean,
  compiledIntoContext: boolean,
  directRetrievalHit: boolean,
): string[] {
  const notes: string[] = [];
  if (success) {
    notes.push("Target memory passed conservative recall threshold.");
  }
  if (!activated) {
    notes.push("Target was not strongly activated by the activation engine.");
  }
  if (!selectedByWorkingMemory) {
    notes.push("Target was not selected by the working memory gate.");
  }
  if (!compiledIntoContext) {
    notes.push("Target did not appear in compiled context trace or prompt.");
  }
  if (!directRetrievalHit) {
    notes.push("Direct MemoryStore retrieval did not return the target.");
  }
  return notes;
}

function memoryValueSort(left: MemoryRecord, right: MemoryRecord): number {
  return (
    memoryValue(right) - memoryValue(left) ||
    right.createdAt.localeCompare(left.createdAt) ||
    right.id.localeCompare(left.id)
  );
}

function memoryValue(memory: MemoryRecord): number {
  const pinned = memory.pinned ? 1.5 : 0;
  const kind = durableKinds.includes(memory.kind) ? 1 : 0;
  return memory.importance * 1.4 + memory.confidence + Math.min(memory.accessCount / 8, 1) + pinned + kind;
}

function normalizeExpectedKind(memory: MemoryRecord): MemoryKind {
  if (looksLikeIdentity(memory)) {
    return "self_model";
  }
  return memory.kind;
}

function looksLikeIdentity(memory: MemoryRecord): boolean {
  const tags = memory.tags.map((tag) => tag.toLowerCase());
  const text = memory.text.toLowerCase();
  return (
    memory.kind === "self_model" ||
    tags.some((tag) => ["identity", "self", "self-model", "name"].includes(tag)) ||
    ["who am i", "what is my name", "identity", "self model", "name is"].some((term) => text.includes(term))
  );
}

function extractKeywords(text: string, limit: number): string[] {
  const latin = text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  const cjk = text.match(/[\u3400-\u9fff]{2,}/g) ?? [];
  const tokens = [...latin, ...cjk.flatMap(splitCjkSequence)]
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !keywordStopWords.has(token));
  return [...new Set(tokens)].slice(0, limit);
}

function splitCjkSequence(sequence: string): string[] {
  if (sequence.length <= 6) {
    return [sequence];
  }

  const tokens: string[] = [];
  for (let index = 0; index < sequence.length - 1; index += 2) {
    tokens.push(sequence.slice(index, Math.min(sequence.length, index + 4)));
  }
  return tokens;
}

function dedupeTargets(targets: MemoryRecallHarnessTarget[]): MemoryRecallHarnessTarget[] {
  const seen = new Set<string>();
  const result: MemoryRecallHarnessTarget[] = [];
  for (const target of targets) {
    if (seen.has(target.memory.id)) {
      continue;
    }
    seen.add(target.memory.id);
    result.push(target);
  }
  return result;
}

function summarizeReport(successes: number, failures: number, selected: number): string {
  if (selected === 0) {
    return "No active memories were available for recall testing.";
  }
  return `Memory recall harness sampled ${selected} target(s): ${successes} passed, ${failures} missed.`;
}

function clip(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const keywordStopWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "should",
  "about",
  "memory",
  "remember",
]);
