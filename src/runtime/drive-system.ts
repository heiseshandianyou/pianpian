import type { AutonomyDrive, MemoryRecord } from "../types.js";

export class DriveSystem {
  private readonly drives: AutonomyDrive[] = [
    {
      id: "maintain-self",
      name: "Maintain continuity",
      priority: 0.9,
      prompt: "Review recent memories and preserve continuity of identity, goals, and relationship.",
    },
    {
      id: "consolidate-memory",
      name: "Consolidate memory",
      priority: 0.8,
      prompt: "Look for memories that should be summarized, reinforced, or allowed to fade.",
    },
    {
      id: "advance-project",
      name: "Advance project",
      priority: 0.7,
      prompt: "Find a small useful next step for the autonomous TypeScript multi-agent project.",
    },
  ];

  chooseNext(memories: MemoryRecord[], idleCycles: number): AutonomyDrive {
    const memoryPressure = memories.filter((memory) => memory.kind === "episode").length / 20;
    const scored = this.drives.map((drive) => ({
      drive,
      score:
        drive.priority +
        idleCycles * 0.05 +
        (drive.id === "consolidate-memory" ? memoryPressure : 0),
    }));

    return scored.sort((left, right) => right.score - left.score)[0].drive;
  }
}
