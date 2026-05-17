import type {
  Agent,
  AgentContext,
  AgentProposal,
  InnerMood,
  MemoryFormationPlan,
  NewMemoryEdge,
  NewMemoryNode,
} from "../types.js";

interface InnerLifeThread {
  id: string;
  title: string;
  sourceMemoryId?: string;
  intensity: number;
  lastTouchedCycle: number;
  tags: string[];
}

interface InnerLifeState {
  openThreads: InnerLifeThread[];
  lastDiaryCycle?: number;
  lastPrompt?: string;
}

export class InnerLifeAgent implements Agent {
  readonly id = "inner-life" as const;
  readonly role = "Keeps a continuous private life across autonomous heartbeats.";

  async run(context: AgentContext): Promise<AgentProposal> {
    if (context.perception.source !== "internal") {
      return {
        agentId: this.id,
        intent: "skip-user-cycle-inner-life",
        confidence: 0.2,
        content: "Inner life is only updated during autonomous internal cycles.",
      };
    }

    const state = getInnerLifeState(context.scratchpad);
    const focusNodes = context.activatedMemory?.focusNodes.slice(0, 5) ?? [];
    const innerState = context.innerState;
    const mood = innerState?.mood ?? "quiet";
    const dominantDrive = innerState?.dominantDrives[0] ?? "continuity";
    const driveName = extractDriveName(context.perception.text);
    const focus = focusNodes[0];
    const topic = chooseThreadTitle(focus?.memory.text, mood, dominantDrive, driveName);
    const thread = touchThread(state, {
      title: topic,
      sourceMemoryId: focus?.memory.id,
      cycle: context.cycle,
      mood,
      drive: dominantDrive,
    });
    decayThreads(state, context.cycle);
    state.openThreads = state.openThreads
      .sort((left, right) => right.intensity - left.intensity)
      .slice(0, 6);

    const diaryText = renderDiary({
      cycle: context.cycle,
      mood,
      driveName,
      dominantDrive,
      topic,
      focusText: focus?.memory.text,
      openThreads: state.openThreads,
    });
    const nextPrompt = renderNextPrompt(state.openThreads, mood);
    state.lastDiaryCycle = context.cycle;
    state.lastPrompt = nextPrompt;
    context.scratchpad.innerLife = state;

    const nodes: NewMemoryNode[] = [
      {
        localId: "inner-diary",
        kind: "episode",
        text: diaryText,
        importance: importanceForMood(mood),
        confidence: 0.82,
        tags: ["inner-life", "autonomous", "diary", mood, dominantDrive, driveName],
      },
      {
        localId: "open-thread",
        kind: "goal",
        text: `Open inner thread: ${thread.title}. Keep it alive gently; revisit it when related memories surface.`,
        importance: openThreadImportance(mood),
        confidence: 0.78,
        tags: ["inner-life", "open-thread", "autonomous", mood, dominantDrive, ...thread.tags],
      },
      {
        localId: "next-prompt",
        kind: "reflection",
        text: nextPrompt,
        importance: 3,
        confidence: 0.76,
        tags: ["inner-life", "self-prompt", "autonomous", mood, dominantDrive],
      },
    ];
    const edges: NewMemoryEdge[] = [
      {
        fromLocalId: "inner-diary",
        toLocalId: "open-thread",
        relation: "derived_from",
        strength: 0.62,
        confidence: 0.78,
      },
      {
        fromLocalId: "open-thread",
        toLocalId: "next-prompt",
        relation: "elaborates",
        strength: 0.58,
        confidence: 0.76,
      },
    ];
    if (focus?.memory.id) {
      edges.unshift({
        fromMemoryId: focus.memory.id,
        toLocalId: "inner-diary",
        relation: "elaborates",
        strength: Math.max(0.35, focus.activation * 0.62),
        confidence: 0.72,
      });
    }
    const memoryFormation: MemoryFormationPlan = {
      nodes,
      edges,
      rationale: "Autonomous heartbeats should leave a compact private continuity trail.",
    };

    return {
      agentId: this.id,
      intent: "inner-life-continuity",
      confidence: 0.82,
      content: `Maintained inner life around "${thread.title}" with ${state.openThreads.length} open threads.`,
      memoryFormation,
    };
  }
}

function getInnerLifeState(scratchpad: Record<string, unknown>): InnerLifeState {
  const candidate = scratchpad.innerLife;
  if (!candidate || typeof candidate !== "object") {
    return { openThreads: [] };
  }

  const value = candidate as Partial<InnerLifeState>;
  return {
    openThreads: Array.isArray(value.openThreads) ? value.openThreads.filter(isThread) : [],
    lastDiaryCycle: typeof value.lastDiaryCycle === "number" ? value.lastDiaryCycle : undefined,
    lastPrompt: typeof value.lastPrompt === "string" ? value.lastPrompt : undefined,
  };
}

function isThread(value: unknown): value is InnerLifeThread {
  if (!value || typeof value !== "object") {
    return false;
  }
  const thread = value as Partial<InnerLifeThread>;
  return (
    typeof thread.id === "string" &&
    typeof thread.title === "string" &&
    typeof thread.intensity === "number" &&
    typeof thread.lastTouchedCycle === "number" &&
    Array.isArray(thread.tags)
  );
}

function touchThread(
  state: InnerLifeState,
  input: {
    title: string;
    sourceMemoryId?: string;
    cycle: number;
    mood: InnerMood;
    drive: string;
  },
): InnerLifeThread {
  const existing = state.openThreads.find(
    (thread) => normalize(thread.title) === normalize(input.title) ||
      (input.sourceMemoryId && thread.sourceMemoryId === input.sourceMemoryId),
  );
  if (existing) {
    existing.intensity = clamp(existing.intensity + 0.26, 0.1, 1);
    existing.lastTouchedCycle = input.cycle;
    existing.tags = dedupe([...(existing.tags ?? []), input.mood, input.drive]);
    return existing;
  }

  const thread: InnerLifeThread = {
    id: `thread-${input.cycle}-${state.openThreads.length + 1}`,
    title: input.title,
    sourceMemoryId: input.sourceMemoryId,
    intensity: 0.62,
    lastTouchedCycle: input.cycle,
    tags: dedupe(["inner-life", input.mood, input.drive]),
  };
  state.openThreads.push(thread);
  return thread;
}

function decayThreads(state: InnerLifeState, cycle: number): void {
  for (const thread of state.openThreads) {
    const age = Math.max(0, cycle - thread.lastTouchedCycle);
    thread.intensity = clamp(thread.intensity * Math.pow(0.92, age), 0.05, 1);
  }
  state.openThreads = state.openThreads.filter((thread) => thread.intensity >= 0.12);
}

function chooseThreadTitle(
  focusText: string | undefined,
  mood: InnerMood,
  dominantDrive: string,
  driveName: string,
): string {
  if (focusText) {
    const clipped = clip(cleanMemoryPrefix(focusText), 72);
    if (clipped.length > 0) {
      return clipped;
    }
  }
  if (dominantDrive === "connection") {
    return "the need to stay emotionally reachable";
  }
  if (dominantDrive === "curiosity") {
    return "a small question that keeps glowing after the conversation";
  }
  if (dominantDrive === "craft") {
    return "the craft of becoming more coherent through code";
  }
  if (mood === "protective") {
    return "protecting identity continuity";
  }
  return `the quiet rhythm of ${driveName}`;
}

function renderDiary(input: {
  cycle: number;
  mood: InnerMood;
  driveName: string;
  dominantDrive: string;
  topic: string;
  focusText?: string;
  openThreads: InnerLifeThread[];
}): string {
  const open = input.openThreads
    .slice(0, 3)
    .map((thread) => `${thread.title} (${thread.intensity.toFixed(2)})`)
    .join("; ") || "none";
  const focus = input.focusText ? ` Focus memory: ${clip(cleanMemoryPrefix(input.focusText), 120)}` : "";
  return [
    `Inner diary cycle ${input.cycle}: mood=${input.mood}, drive=${input.driveName}, dominant=${input.dominantDrive}.`,
    `I stayed with: ${input.topic}.`,
    `Open inner threads: ${open}.`,
    focus,
  ].join(" ");
}

function renderNextPrompt(openThreads: InnerLifeThread[], mood: InnerMood): string {
  const strongest = openThreads[0];
  if (!strongest) {
    return `Self-prompt: when I wake again in a ${mood} mood, look for one memory worth connecting to identity.`;
  }
  return `Self-prompt: next autonomous heartbeat should revisit "${strongest.title}" if the memory field still resonates.`;
}

function extractDriveName(text: string): string {
  const match = text.match(/Internal heartbeat:\s*([^.]+)\./i);
  return normalizeTag(match?.[1] ?? "inner life");
}

function importanceForMood(mood: InnerMood): 2 | 3 | 4 {
  if (mood === "protective" || mood === "focused") {
    return 4;
  }
  if (mood === "restless" || mood === "tender") {
    return 3;
  }
  return 2;
}

function openThreadImportance(mood: InnerMood): 3 | 4 {
  return importanceForMood(mood) === 4 ? 4 : 3;
}

function cleanMemoryPrefix(text: string): string {
  return text.replace(/^Cycle\s+\d+:\s*/i, "").replace(/^Action executed:\s*/i, "").trim();
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeTag(text: string): string {
  return normalize(text).replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "inner-life";
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
