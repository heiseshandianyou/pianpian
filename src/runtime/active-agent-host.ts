import { DriveSystem } from "./drive-system.js";
import type { AutonomousRuntime, RuntimeCycleResult } from "./autonomous-runtime.js";
import type {
  AutonomyDrive,
  ForgettingPolicy,
  ForgettingReport,
  MaintenanceReport,
} from "../types.js";
import { MemoryConsolidationEngine } from "../memory/memory-consolidation-engine.js";
import { MemoryStore } from "../memory/memory-store.js";

export interface ActiveAgentHostOptions {
  heartbeatMs: number;
  consolidationEveryCycles: number;
  relatedConsolidationEveryCycles: number;
  forgettingEveryCycles: number;
  forgettingPolicy: ForgettingPolicy;
}

export interface HeartbeatResult {
  drive: AutonomyDrive;
  cycle: RuntimeCycleResult;
  maintenance: MaintenanceReport;
  consolidation?: MaintenanceReport["consolidation"];
  forgetting?: ForgettingReport;
}

const defaultOptions: ActiveAgentHostOptions = {
  heartbeatMs: 60_000,
  consolidationEveryCycles: 6,
  relatedConsolidationEveryCycles: 24,
  forgettingEveryCycles: 12,
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
  private readonly drives = new DriveSystem();
  private readonly consolidation: MemoryConsolidationEngine;
  private readonly options: ActiveAgentHostOptions;

  constructor(
    private readonly runtime: AutonomousRuntime,
    private readonly memory: MemoryStore,
    options: Partial<ActiveAgentHostOptions> = {},
  ) {
    this.consolidation = new MemoryConsolidationEngine(memory);
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
      void this.heartbeat().then(onHeartbeat);
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
    this.idleCycles += 1;
    this.totalHeartbeats += 1;

    const memories = this.memory.list(40).filter((memory) => memory.status === "active");
    const drive = this.drives.chooseNext(memories, this.idleCycles);
    const cycle = await this.runtime.step(
      `Internal heartbeat: ${drive.name}. ${drive.prompt}`,
      "internal",
    );

    const consolidation =
      this.shouldRunEvery(this.options.consolidationEveryCycles) || drive.id === "consolidate-memory"
        ? this.consolidation.consolidateExactDuplicates()
        : undefined;
    const relatedConsolidation = this.shouldRunEvery(this.options.relatedConsolidationEveryCycles)
      ? await this.consolidation.consolidateRelatedMemories()
      : undefined;
    const forgetting =
      this.shouldRunEvery(this.options.forgettingEveryCycles)
        ? this.memory.applyForgetting(this.options.forgettingPolicy)
        : undefined;
    const maintenance: MaintenanceReport = {
      consolidation: mergeConsolidationReports(consolidation, relatedConsolidation),
      forgetting,
    };

    return {
      drive,
      cycle,
      maintenance,
      consolidation: maintenance.consolidation,
      forgetting,
    };
  }

  markUserActivity(): void {
    this.idleCycles = 0;
  }

  private shouldRunEvery(cycles: number): boolean {
    return cycles > 0 && this.totalHeartbeats % cycles === 0;
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
