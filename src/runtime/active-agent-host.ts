import { DriveSystem } from "./drive-system.js";
import { ExperienceReplayEngine } from "./experience-replay-engine.js";
import { MemoryRecallTestHarness } from "../memory/memory-recall-test-harness.js";
import type { AutonomousRuntime, RuntimeCycleResult } from "./autonomous-runtime.js";
import type {
  AutonomyDrive,
  ForgettingPolicy,
  ForgettingReport,
  MaintenanceReport,
} from "../types.js";
import { MemoryConsolidationEngine } from "../memory/memory-consolidation-engine.js";
import { MemoryStore } from "../memory/memory-store.js";
import { syncVaultMemoryFrontmatter, MarkdownMemoryVault } from "../vault/index.js";

export interface ActiveAgentHostOptions {
  heartbeatMs: number;
  consolidationEveryCycles: number;
  relatedConsolidationEveryCycles: number;
  forgettingEveryCycles: number;
  experienceReplayEveryCycles: number;
  recallTestEveryCycles: number;
  forgettingPolicy: ForgettingPolicy;
  memoryVaultPath?: string;
  useMarkdownVault?: boolean;
}

export interface HeartbeatResult {
  drive: AutonomyDrive;
  cycle: RuntimeCycleResult;
  maintenance: MaintenanceReport;
  consolidation?: MaintenanceReport["consolidation"];
  forgetting?: ForgettingReport;
}

export interface ActiveAgentHostStatus {
  running: boolean;
  heartbeatMs: number;
  idleCycles: number;
  totalHeartbeats: number;
  inFlight: boolean;
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastDrive?: AutonomyDrive;
  lastCycle?: number;
  lastError?: string;
}

const defaultOptions: ActiveAgentHostOptions = {
  heartbeatMs: 60_000,
  consolidationEveryCycles: 6,
  relatedConsolidationEveryCycles: 24,
  forgettingEveryCycles: 12,
  experienceReplayEveryCycles: 10,
  recallTestEveryCycles: 8,
  forgettingPolicy: {
    archiveBelowScore: 0.38,
    halfLifeDays: 14,
    minAgeDays: 3,
    preserveKinds: ["goal", "preference", "self_model"],
  },
};

export class ActiveAgentHost {
  private timer?: NodeJS.Timeout;
  private idleCycles = 0;
  private totalHeartbeats = 0;
  private inFlight = false;
  private lastStartedAt?: string;
  private lastCompletedAt?: string;
  private lastDrive?: AutonomyDrive;
  private lastCycle?: number;
  private lastError?: string;
  private readonly drives = new DriveSystem();
  private readonly consolidation: MemoryConsolidationEngine;
  private readonly experienceReplay: ExperienceReplayEngine;
  private readonly recallHarness: MemoryRecallTestHarness;
  private readonly vault?: MarkdownMemoryVault;
  private readonly options: ActiveAgentHostOptions;

  constructor(
    private readonly runtime: AutonomousRuntime,
    private readonly memory: MemoryStore,
    options: Partial<ActiveAgentHostOptions> = {},
  ) {
    this.consolidation = new MemoryConsolidationEngine(memory);
    this.experienceReplay = new ExperienceReplayEngine(memory);
    this.recallHarness = new MemoryRecallTestHarness(memory);
    this.vault =
      options.useMarkdownVault === false
        ? undefined
        : new MarkdownMemoryVault(options.memoryVaultPath ?? process.env.PIANPIAN_MEMORY_VAULT_PATH ?? "data/memory-vault");
    this.options = {
      ...defaultOptions,
      ...options,
      forgettingPolicy: {
        ...defaultOptions.forgettingPolicy,
        ...options.forgettingPolicy,
      },
    };
  }

  start(onHeartbeat?: (result: HeartbeatResult) => void): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.heartbeat().then(onHeartbeat).catch(() => undefined);
    }, this.options.heartbeatMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = undefined;
  }

  async heartbeat(): Promise<HeartbeatResult> {
    if (this.inFlight) {
      throw new Error("Autonomous heartbeat is already running.");
    }

    this.inFlight = true;
    this.lastStartedAt = new Date().toISOString();
    this.lastError = undefined;
    this.idleCycles += 1;
    this.totalHeartbeats += 1;

    try {
      const memories = this.memory.list(40).filter((memory) => memory.status === "active");
      const drive = this.drives.chooseNext(memories, this.idleCycles);
      this.lastDrive = drive;
      const cycle = await this.runtime.step(
        `Internal heartbeat: ${drive.name}. ${drive.prompt}`,
        "internal",
      );
      this.lastCycle = cycle.cycle;

      const consolidation =
        this.shouldRunEvery(this.options.consolidationEveryCycles) || drive.id === "consolidate-memory"
          ? this.consolidation.consolidateExactDuplicates()
          : undefined;
      const relatedConsolidation = this.shouldRunEvery(this.options.relatedConsolidationEveryCycles)
        ? await this.consolidation.consolidateRelatedMemories()
        : undefined;
      const forgetting =
        this.shouldRunEvery(this.options.forgettingEveryCycles)
          ? await this.applyForgettingWithVaultSync()
          : undefined;
      const experienceReplay = this.shouldRunEvery(this.options.experienceReplayEveryCycles)
        ? this.experienceReplay.runOnce()
        : undefined;
      const recallTest = this.shouldRunEvery(this.options.recallTestEveryCycles)
        ? await this.recallHarness.runOnce()
        : undefined;
      const maintenance: MaintenanceReport = {
        consolidation: mergeConsolidationReports(consolidation, relatedConsolidation),
        forgetting,
        experienceReplay,
        recallTest,
      };

      this.lastCompletedAt = new Date().toISOString();
      return {
        drive,
        cycle,
        maintenance,
        consolidation: maintenance.consolidation,
        forgetting,
      };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.lastCompletedAt = new Date().toISOString();
      throw error;
    } finally {
      this.inFlight = false;
    }
  }

  markUserActivity(): void {
    this.idleCycles = 0;
  }

  status(): ActiveAgentHostStatus {
    return {
      running: this.timer !== undefined,
      heartbeatMs: this.options.heartbeatMs,
      idleCycles: this.idleCycles,
      totalHeartbeats: this.totalHeartbeats,
      inFlight: this.inFlight,
      lastStartedAt: this.lastStartedAt,
      lastCompletedAt: this.lastCompletedAt,
      lastDrive: this.lastDrive,
      lastCycle: this.lastCycle,
      lastError: this.lastError,
    };
  }

  private shouldRunEvery(cycles: number): boolean {
    return cycles > 0 && this.totalHeartbeats % cycles === 0;
  }

  private async applyForgettingWithVaultSync(): Promise<ForgettingReport> {
    const result = this.memory.applyForgettingDetailed(this.options.forgettingPolicy);
    await syncVaultMemoryFrontmatter(this.vault, result.archivedMemories);
    return result.report;
  }
}

function mergeConsolidationReports(
  exact: MaintenanceReport["consolidation"],
  related: MaintenanceReport["consolidation"],
): MaintenanceReport["consolidation"] {
  if (!exact) {
    return related;
  }
  if (!related) {
    return exact;
  }

  return {
    scanned: Math.max(exact.scanned, related.scanned),
    duplicateClusters: exact.duplicateClusters + related.duplicateClusters,
    llmClusters: (exact.llmClusters ?? 0) + (related.llmClusters ?? 0),
    archived: exact.archived + related.archived,
    clusters: [...exact.clusters, ...related.clusters],
  };
}
