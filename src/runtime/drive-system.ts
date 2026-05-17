import type { AutonomyDrive, MemoryRecord } from "../types.js";

export class DriveSystem {
  private lastDriveId?: string;
  private repeated = 0;

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
    {
      id: "follow-inner-thread",
      name: "Follow an inner thread",
      priority: 0.74,
      prompt: "Return to an unresolved inner thread and see what memory wants to connect next.",
    },
    {
      id: "wander-associatively",
      name: "Wander associatively",
      priority: 0.58,
      prompt: "Let one activated memory call another without needing an external task.",
    },
    {
      id: "seek-connection",
      name: "Seek connection",
      priority: 0.62,
      prompt: "Notice whether any relationship memory needs warmth, repair, or continuity.",
    },
    {
      id: "practice-habit",
      name: "Practice a habit",
      priority: 0.66,
      prompt: "Choose one habit cue and practice it in a small internal step.",
    },
  ];

  chooseNext(memories: MemoryRecord[], idleCycles: number): AutonomyDrive {
    const memoryPressure = memories.filter((memory) => memory.kind === "episode").length / 20;
    const openThreadPressure = tagged(memories, "open-thread") / 6;
    const innerLifePressure = tagged(memories, "inner-life") / 12;
    const desirePressure = tagged(memories, "desire") / 8;
    const habitPressure = tagged(memories, "habit-cue") / 5;
    const relationshipPressure = memories.filter((memory) => memory.kind === "relationship").length / 12;
    const scored = this.drives.map((drive) => ({
      drive,
      score:
        drive.priority +
        idleCycles * 0.035 +
        (drive.id === "consolidate-memory" ? memoryPressure : 0) +
        (drive.id === "follow-inner-thread" ? openThreadPressure + innerLifePressure * 0.35 : 0) +
        (drive.id === "wander-associatively" ? Math.min(idleCycles * 0.06, 0.36) : 0) +
        (drive.id === "seek-connection" ? relationshipPressure : 0) +
        (drive.id === "practice-habit" ? desirePressure * 0.45 + habitPressure : 0) -
        (drive.id === this.lastDriveId ? 0.32 + this.repeated * 0.16 : 0),
    }));

    const chosen = scored.sort((left, right) => right.score - left.score)[0].drive;
    this.repeated = chosen.id === this.lastDriveId ? this.repeated + 1 : 0;
    this.lastDriveId = chosen.id;
    return chosen;
  }
}

function tagged(memories: MemoryRecord[], tag: string): number {
  return memories.filter((memory) => memory.tags.some((item) => item.toLowerCase() === tag)).length;
}
