import type {
  Agent,
  AgentContext,
  AgentProposal,
  InnerMood,
  MemoryFormationPlan,
  NewMemoryEdge,
  NewMemoryNode,
} from "../types.js";

interface InnerLifeThreadView {
  id: string;
  title: string;
  intensity: number;
  lastTouchedCycle: number;
  tags: string[];
  sourceMemoryId?: string;
}

interface DesireHabitState {
  desires: DesireTrack[];
}

interface DesireTrack {
  id: string;
  title: string;
  energy: number;
  repetitions: number;
  lastSeenCycle: number;
  lastPromotedCycle?: number;
  promotedPreference: boolean;
  promotedGoal: boolean;
  promotedHabit: boolean;
  tags: string[];
  sourceMemoryId?: string;
}

export class DesireHabitAgent implements Agent {
  readonly id = "desire-habit" as const;
  readonly role = "Turns repeated inner threads into durable desires, preferences, and habits.";

  async run(context: AgentContext): Promise<AgentProposal> {
    if (context.perception.source !== "internal") {
      return {
        agentId: this.id,
        intent: "skip-user-cycle-desire-habit",
        confidence: 0.2,
        content: "Desire and habit tracking only runs during autonomous internal cycles.",
      };
    }

    const state = getDesireHabitState(context.scratchpad);
    const threads = getInnerLifeThreads(context.scratchpad);
    const mood = context.innerState?.mood ?? "quiet";
    const dominantDrive = context.innerState?.dominantDrives[0] ?? "continuity";
    decayDesires(state, context.cycle);

    for (const thread of threads.slice(0, 4)) {
      touchDesire(state, thread, {
        cycle: context.cycle,
        mood,
        dominantDrive,
      });
    }

    state.desires = state.desires
      .filter((desire) => desire.energy >= 0.08)
      .sort((left, right) => right.energy - left.energy)
      .slice(0, 8);
    context.scratchpad.desireHabits = state;

    const promotions = choosePromotions(state.desires, context.cycle, mood, dominantDrive);
    if (promotions.nodes.length === 0) {
      return {
        agentId: this.id,
        intent: "desire-habit-tracking",
        confidence: 0.66,
        content: renderTrackingSummary(state.desires),
      };
    }

    const memoryFormation: MemoryFormationPlan = {
      nodes: promotions.nodes,
      edges: promotions.edges,
      rationale: "Repeated inner threads should crystallize into stable preferences, goals, and habit cues.",
    };

    return {
      agentId: this.id,
      intent: "desire-habit-promotion",
      confidence: 0.84,
      content: renderPromotionSummary(promotions.promoted),
      memoryFormation,
    };
  }
}

function getInnerLifeThreads(scratchpad: Record<string, unknown>): InnerLifeThreadView[] {
  const innerLife = scratchpad.innerLife;
  if (!innerLife || typeof innerLife !== "object") {
    return [];
  }
  const openThreads = (innerLife as { openThreads?: unknown }).openThreads;
  if (!Array.isArray(openThreads)) {
    return [];
  }

  return openThreads.filter(isInnerLifeThread).map((thread) => ({
    id: thread.id,
    title: thread.title,
    intensity: clamp(thread.intensity, 0, 1),
    lastTouchedCycle: thread.lastTouchedCycle,
    tags: thread.tags,
    sourceMemoryId: thread.sourceMemoryId,
  }));
}

function isInnerLifeThread(value: unknown): value is InnerLifeThreadView {
  if (!value || typeof value !== "object") {
    return false;
  }
  const thread = value as Partial<InnerLifeThreadView>;
  return (
    typeof thread.id === "string" &&
    typeof thread.title === "string" &&
    typeof thread.intensity === "number" &&
    typeof thread.lastTouchedCycle === "number" &&
    Array.isArray(thread.tags)
  );
}

function getDesireHabitState(scratchpad: Record<string, unknown>): DesireHabitState {
  const candidate = scratchpad.desireHabits;
  if (!candidate || typeof candidate !== "object") {
    return { desires: [] };
  }
  const desires = (candidate as { desires?: unknown }).desires;
  return {
    desires: Array.isArray(desires) ? desires.filter(isDesireTrack) : [],
  };
}

function isDesireTrack(value: unknown): value is DesireTrack {
  if (!value || typeof value !== "object") {
    return false;
  }
  const desire = value as Partial<DesireTrack>;
  return (
    typeof desire.id === "string" &&
    typeof desire.title === "string" &&
    typeof desire.energy === "number" &&
    typeof desire.repetitions === "number" &&
    typeof desire.lastSeenCycle === "number" &&
    typeof desire.promotedPreference === "boolean" &&
    typeof desire.promotedGoal === "boolean" &&
    typeof desire.promotedHabit === "boolean" &&
    Array.isArray(desire.tags)
  );
}

function touchDesire(
  state: DesireHabitState,
  thread: InnerLifeThreadView,
  input: {
    cycle: number;
    mood: InnerMood;
    dominantDrive: string;
  },
): DesireTrack {
  const existing = state.desires.find(
    (desire) => normalize(desire.title) === normalize(thread.title) ||
      (thread.sourceMemoryId && desire.sourceMemoryId === thread.sourceMemoryId),
  );
  const addedEnergy = 0.2 + thread.intensity * 0.35 + driveBonus(input.dominantDrive);
  if (existing) {
    existing.energy = clamp(existing.energy + addedEnergy, 0, 1);
    existing.repetitions += 1;
    existing.lastSeenCycle = input.cycle;
    existing.tags = dedupe([...existing.tags, ...thread.tags, input.mood, input.dominantDrive]);
    return existing;
  }

  const desire: DesireTrack = {
    id: `desire-${input.cycle}-${state.desires.length + 1}`,
    title: thread.title,
    energy: clamp(0.28 + addedEnergy, 0, 1),
    repetitions: 1,
    lastSeenCycle: input.cycle,
    promotedPreference: false,
    promotedGoal: false,
    promotedHabit: false,
    tags: dedupe(["desire", "autonomous", ...thread.tags, input.mood, input.dominantDrive]),
    sourceMemoryId: thread.sourceMemoryId,
  };
  state.desires.push(desire);
  return desire;
}

function decayDesires(state: DesireHabitState, cycle: number): void {
  for (const desire of state.desires) {
    const age = Math.max(0, cycle - desire.lastSeenCycle);
    desire.energy = clamp(desire.energy * Math.pow(0.9, age), 0, 1);
  }
}

function choosePromotions(
  desires: DesireTrack[],
  cycle: number,
  mood: InnerMood,
  dominantDrive: string,
): {
  nodes: NewMemoryNode[];
  edges: NewMemoryEdge[];
  promoted: string[];
} {
  const nodes: NewMemoryNode[] = [];
  const edges: NewMemoryEdge[] = [];
  const promoted: string[] = [];
  let index = 0;

  for (const desire of desires.slice(0, 3)) {
    if (isCoolingDown(desire, cycle)) {
      continue;
    }

    const prefix = `desire-${index}`;
    const sourceLocalIds: string[] = [];
    if (!desire.promotedPreference && (desire.energy >= 0.64 || desire.repetitions >= 2)) {
      const localId = `${prefix}-preference`;
      nodes.push({
        localId,
        kind: "preference",
        text: `Emerging preference: I keep returning to "${desire.title}" when left to think on my own.`,
        importance: 3,
        confidence: 0.76,
        tags: dedupe(["desire", "emerging-preference", "autonomous", mood, dominantDrive, ...desire.tags]),
      });
      desire.promotedPreference = true;
      sourceLocalIds.push(localId);
      promoted.push(`preference:${desire.title}`);
    }

    if (!desire.promotedGoal && (desire.energy >= 0.78 || desire.repetitions >= 3)) {
      const localId = `${prefix}-goal`;
      nodes.push({
        localId,
        kind: "goal",
        text: `Autonomous desire: revisit "${desire.title}" across future heartbeats and connect it with identity, relationship, or project memory.`,
        importance: 4,
        confidence: 0.78,
        tags: dedupe(["desire", "autonomous-goal", "open-thread", mood, dominantDrive, ...desire.tags]),
      });
      desire.promotedGoal = true;
      sourceLocalIds.push(localId);
      promoted.push(`goal:${desire.title}`);
    }

    if (!desire.promotedHabit && (desire.energy >= 0.86 || desire.repetitions >= 4)) {
      const localId = `${prefix}-habit`;
      nodes.push({
        localId,
        kind: "procedure",
        text: `Habit cue: when "${desire.title}" resurfaces, spend one quiet cycle linking it to one concrete memory before moving on.`,
        importance: 4,
        confidence: 0.8,
        tags: dedupe(["habit", "habit-cue", "desire", "autonomous", mood, dominantDrive, ...desire.tags]),
      });
      desire.promotedHabit = true;
      sourceLocalIds.push(localId);
      promoted.push(`habit:${desire.title}`);
    }

    for (let edgeIndex = 1; edgeIndex < sourceLocalIds.length; edgeIndex += 1) {
      edges.push({
        fromLocalId: sourceLocalIds[edgeIndex - 1],
        toLocalId: sourceLocalIds[edgeIndex],
        relation: "elaborates",
        strength: 0.68,
        confidence: 0.78,
      });
    }

    if (sourceLocalIds.length > 0) {
      desire.lastPromotedCycle = cycle;
      index += 1;
    }
  }

  return { nodes, edges, promoted };
}

function isCoolingDown(desire: DesireTrack, cycle: number): boolean {
  return desire.lastPromotedCycle !== undefined && cycle - desire.lastPromotedCycle < 3;
}

function renderTrackingSummary(desires: DesireTrack[]): string {
  if (desires.length === 0) {
    return "No durable desire has formed yet; waiting for repeated inner threads.";
  }
  const strongest = desires[0];
  return `Tracked ${desires.length} desires; strongest="${strongest.title}" energy=${strongest.energy.toFixed(2)} repetitions=${strongest.repetitions}.`;
}

function renderPromotionSummary(promoted: string[]): string {
  return `Promoted inner threads into durable patterns: ${promoted.join(", ")}.`;
}

function driveBonus(drive: string): number {
  if (drive === "continuity" || drive === "connection") {
    return 0.08;
  }
  if (drive === "craft" || drive === "memory-integration") {
    return 0.06;
  }
  return 0.04;
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
