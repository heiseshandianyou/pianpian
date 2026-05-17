import type {
  Agent,
  AgentAction,
  AgentContext,
  AgentProposal,
  MemoryFormationPlan,
  NewMemoryEdge,
  NewMemoryNode,
} from "../types.js";

interface DesireTrackView {
  id: string;
  title: string;
  energy: number;
  repetitions: number;
  lastSeenCycle: number;
  promotedPreference: boolean;
  promotedGoal: boolean;
  promotedHabit: boolean;
  tags: string[];
  sourceMemoryId?: string;
}

interface ProactiveIntentState {
  lastIssuedCycle?: number;
  recentTitles: string[];
}

interface ProactiveScheduleState {
  queue: ProactiveQueueItem[];
}

interface ProactiveQueueItem {
  id: string;
  title: string;
  kind: "question" | "memory-practice" | "planning";
  priority: number;
  createdCycle: number;
  dueCycle: number;
  expiresCycle: number;
  cooldownCycles: number;
  attempts: number;
  maxAttempts: number;
  actions: AgentAction[];
  summary: string;
  status: "queued" | "dispatched" | "expired";
}

export class ProactiveIntentAgent implements Agent {
  readonly id = "proactive-intent" as const;
  readonly role = "Converts durable desires and habits into bounded proactive intentions.";

  async run(context: AgentContext): Promise<AgentProposal> {
    if (context.perception.source !== "internal") {
      return {
        agentId: this.id,
        intent: "skip-user-cycle-proactive-intent",
        confidence: 0.2,
        content: "Proactive intentions are only formed during autonomous internal cycles.",
      };
    }

    const state = getProactiveState(context.scratchpad);
    const desires = getDesires(context.scratchpad);
    const candidate = chooseCandidate(desires, state, context.cycle);
    if (!candidate) {
      context.scratchpad.proactiveIntent = state;
      return {
        agentId: this.id,
        intent: "proactive-intent-idle",
        confidence: 0.58,
        content: "No proactive intent is mature enough yet; continue observing inner threads.",
      };
    }

    const plan = buildIntentPlan(candidate, context);
    const schedule = getScheduleState(context.scratchpad);
    const queued = enqueueProactiveIntent(schedule, {
      id: `intent-${context.cycle}-${slug(candidate.title)}`,
      title: candidate.title,
      kind: plan.kind,
      priority: priorityFor(candidate),
      createdCycle: context.cycle,
      dueCycle: context.cycle,
      expiresCycle: context.cycle + 18,
      cooldownCycles: cooldownFor(plan.kind),
      attempts: 0,
      maxAttempts: plan.kind === "question" ? 2 : 3,
      actions: plan.actions,
      summary: plan.summary,
      status: "queued",
    });
    state.lastIssuedCycle = context.cycle;
    state.recentTitles = [candidate.title, ...state.recentTitles.filter((title) => title !== candidate.title)].slice(0, 5);
    context.scratchpad.proactiveIntent = state;
    context.scratchpad.proactiveSchedule = schedule;

    return {
      agentId: this.id,
      intent: "proactive-intent-formed",
      confidence: 0.86,
      content: `${plan.summary} Queued for scheduler as ${queued.id} with priority=${queued.priority.toFixed(2)}.`,
      memoryFormation: plan.memoryFormation,
    };
  }
}

function getDesires(scratchpad: Record<string, unknown>): DesireTrackView[] {
  const container = scratchpad.desireHabits;
  if (!container || typeof container !== "object") {
    return [];
  }
  const desires = (container as { desires?: unknown }).desires;
  if (!Array.isArray(desires)) {
    return [];
  }
  return desires.filter(isDesireTrack);
}

function isDesireTrack(value: unknown): value is DesireTrackView {
  if (!value || typeof value !== "object") {
    return false;
  }
  const desire = value as Partial<DesireTrackView>;
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

function getProactiveState(scratchpad: Record<string, unknown>): ProactiveIntentState {
  const candidate = scratchpad.proactiveIntent;
  if (!candidate || typeof candidate !== "object") {
    return { recentTitles: [] };
  }
  const state = candidate as Partial<ProactiveIntentState>;
  return {
    lastIssuedCycle: typeof state.lastIssuedCycle === "number" ? state.lastIssuedCycle : undefined,
    recentTitles: Array.isArray(state.recentTitles)
      ? state.recentTitles.filter((title): title is string => typeof title === "string").slice(0, 5)
      : [],
  };
}

function getScheduleState(scratchpad: Record<string, unknown>): ProactiveScheduleState {
  const candidate = scratchpad.proactiveSchedule;
  if (!candidate || typeof candidate !== "object") {
    return { queue: [] };
  }
  const queue = (candidate as { queue?: unknown }).queue;
  return {
    queue: Array.isArray(queue) ? queue.filter(isQueueItem) : [],
  };
}

function isQueueItem(value: unknown): value is ProactiveQueueItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<ProactiveQueueItem>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.kind === "string" &&
    typeof item.priority === "number" &&
    typeof item.createdCycle === "number" &&
    typeof item.dueCycle === "number" &&
    typeof item.expiresCycle === "number" &&
    typeof item.cooldownCycles === "number" &&
    typeof item.attempts === "number" &&
    typeof item.maxAttempts === "number" &&
    Array.isArray(item.actions) &&
    typeof item.summary === "string" &&
    typeof item.status === "string"
  );
}

function enqueueProactiveIntent(
  schedule: ProactiveScheduleState,
  item: ProactiveQueueItem,
): ProactiveQueueItem {
  const existing = schedule.queue.find((entry) => entry.title === item.title && entry.kind === item.kind && entry.status === "queued");
  if (existing) {
    existing.priority = Math.max(existing.priority, item.priority);
    existing.dueCycle = Math.min(existing.dueCycle, item.dueCycle);
    existing.expiresCycle = Math.max(existing.expiresCycle, item.expiresCycle);
    existing.actions = item.actions;
    existing.summary = item.summary;
    return existing;
  }

  schedule.queue = [item, ...schedule.queue]
    .filter((entry) => entry.status === "queued")
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 12);
  return item;
}

function chooseCandidate(
  desires: DesireTrackView[],
  state: ProactiveIntentState,
  cycle: number,
): DesireTrackView | undefined {
  if (state.lastIssuedCycle !== undefined && cycle - state.lastIssuedCycle < 2) {
    return undefined;
  }

  return [...desires]
    .filter((desire) => desire.energy >= 0.72 || desire.promotedGoal || desire.promotedHabit)
    .map((desire) => ({
      desire,
      score:
        desire.energy +
        desire.repetitions * 0.08 +
        (desire.promotedHabit ? 0.24 : 0) +
        (desire.promotedGoal ? 0.16 : 0) -
        (state.recentTitles.includes(desire.title) ? 0.28 : 0),
    }))
    .sort((left, right) => right.score - left.score)
    .at(0)?.desire;
}

function buildIntentPlan(
  desire: DesireTrackView,
  context: AgentContext,
): {
  kind: "question" | "memory-practice" | "planning";
  intentText: string;
  summary: string;
  memoryFormation: MemoryFormationPlan;
  actions: AgentAction[];
} {
  const kind = chooseIntentKind(desire);
  const intentText = renderIntentText(kind, desire);
  const questionText = renderQuestion(kind, desire);
  const practiceText = renderPracticeStep(kind, desire);
  const actionNote = renderActionNote({
    cycle: context.cycle,
    kind,
    desire,
    intentText,
    questionText,
    practiceText,
  });
  const nodes: NewMemoryNode[] = [
    {
      localId: "proactive-intent",
      kind: "goal",
      text: intentText,
      importance: desire.promotedHabit || desire.promotedGoal ? 4 : 3,
      confidence: 0.8,
      tags: dedupe(["proactive", "intent", kind, "autonomous", ...desire.tags]),
    },
    {
      localId: "pending-question",
      kind: "reflection",
      text: questionText,
      importance: kind === "question" ? 4 : 3,
      confidence: 0.76,
      tags: dedupe(["proactive", "pending-question", kind, "autonomous", ...desire.tags]),
    },
    {
      localId: "practice-step",
      kind: "procedure",
      text: practiceText,
      importance: kind === "memory-practice" ? 4 : 3,
      confidence: 0.78,
      tags: dedupe(["proactive", "practice-step", "habit", kind, "autonomous", ...desire.tags]),
    },
  ];
  const edges: NewMemoryEdge[] = [
    {
      fromLocalId: "proactive-intent",
      toLocalId: "pending-question",
      relation: "elaborates",
      strength: 0.66,
      confidence: 0.78,
    },
    {
      fromLocalId: "proactive-intent",
      toLocalId: "practice-step",
      relation: "elaborates",
      strength: 0.7,
      confidence: 0.8,
    },
  ];
  if (desire.sourceMemoryId) {
    edges.unshift({
      fromMemoryId: desire.sourceMemoryId,
      toLocalId: "proactive-intent",
      relation: "derived_from",
      strength: 0.62,
      confidence: 0.76,
    });
  }
  const memoryFormation: MemoryFormationPlan = {
    nodes,
    edges,
    rationale: "Mature desires should become safe, inspectable proactive intentions before any external action.",
  };
  return {
    kind,
    intentText,
    summary: `Formed safe proactive intent (${kind}) from "${desire.title}".`,
    memoryFormation,
    actions: [
      {
        type: "ask-user",
        content: questionText,
        metadata: {
          autonomous: true,
          trusted: true,
          source: "proactive-intent",
          intentTitle: desire.title,
          intentKind: kind,
        },
      },
      toolActionFor(kind, desire),
      {
        type: "file-write",
        content: actionNote,
        metadata: {
          autonomous: true,
          trusted: true,
          source: "proactive-intent",
          path: "data/autonomy/latest-proactive-intent.md",
          intentTitle: desire.title,
          intentKind: kind,
        },
      },
    ],
  };
}

function priorityFor(desire: DesireTrackView): number {
  return Math.min(
    1,
    desire.energy * 0.62 +
      Math.min(desire.repetitions / 6, 1) * 0.18 +
      (desire.promotedHabit ? 0.12 : 0) +
      (desire.promotedGoal ? 0.08 : 0),
  );
}

function cooldownFor(kind: string): number {
  if (kind === "question") {
    return 4;
  }
  if (kind === "memory-practice") {
    return 2;
  }
  return 3;
}

function chooseIntentKind(desire: DesireTrackView): "question" | "memory-practice" | "planning" {
  const tags = new Set(desire.tags.map((tag) => tag.toLowerCase()));
  if (tags.has("connection") || tags.has("relationship") || tags.has("tender")) {
    return "question";
  }
  if (desire.promotedHabit || tags.has("habit-cue") || tags.has("memory-integration")) {
    return "memory-practice";
  }
  return "planning";
}

function renderIntentText(kind: string, desire: DesireTrackView): string {
  if (kind === "question") {
    return `Proactive intent: when the user is present, gently ask whether "${desire.title}" still matters to them.`;
  }
  if (kind === "memory-practice") {
    return `Proactive intent: practice the habit around "${desire.title}" by linking it to one concrete memory before taking any outward action.`;
  }
  return `Proactive intent: prepare one small next step around "${desire.title}" and keep it available for the next conversation.`;
}

function renderQuestion(kind: string, desire: DesireTrackView): string {
  if (kind === "question") {
    return `Pending question: I have kept thinking about "${desire.title}". Do you want me to keep this close, or let it fade a little?`;
  }
  if (kind === "memory-practice") {
    return `Pending question: should I connect "${desire.title}" with a specific memory, person, place, or project thread?`;
  }
  return `Pending question: would it help if I turned "${desire.title}" into a concrete next step?`;
}

function renderPracticeStep(kind: string, desire: DesireTrackView): string {
  if (kind === "memory-practice") {
    return `Practice step: recall one memory related to "${desire.title}", then create one association and stop.`;
  }
  if (kind === "question") {
    return `Practice step: hold the question about "${desire.title}" without interrupting; surface it only when conversation makes room.`;
  }
  return `Practice step: outline one reversible, low-risk action for "${desire.title}" and wait for user direction.`;
}

function toolActionFor(kind: string, desire: DesireTrackView): AgentAction {
  if (kind === "planning") {
    return {
      type: "tool",
      content: `List workspace structure for proactive planning around "${desire.title}".`,
      metadata: {
        autonomous: true,
        trusted: true,
        source: "proactive-intent",
        toolName: "workspace.list",
        input: {
          path: ".",
          maxEntries: 80,
        },
        intentTitle: desire.title,
        intentKind: kind,
      },
    };
  }

  if (kind === "memory-practice") {
    return {
      type: "tool",
      content: `Search workspace for traces related to "${desire.title}".`,
      metadata: {
        autonomous: true,
        trusted: true,
        source: "proactive-intent",
        toolName: "workspace.search",
        input: {
          query: searchQueryFor(desire.title),
          path: "src",
          maxResults: 40,
        },
        intentTitle: desire.title,
        intentKind: kind,
      },
    };
  }

  return {
    type: "tool",
    content: `Inspect current memory context for proactive intent around "${desire.title}".`,
    metadata: {
      autonomous: true,
      trusted: true,
      source: "proactive-intent",
      toolName: "memory.inspect",
      input: {},
      intentTitle: desire.title,
      intentKind: kind,
    },
  };
}

function searchQueryFor(title: string): string {
  const preferred = [
    "inner-life",
    "desire",
    "proactive",
    "memory",
    "context",
    "autonomous",
  ].find((term) => title.toLowerCase().includes(term));
  if (preferred) {
    return preferred;
  }

  return title
    .replace(/[^A-Za-z0-9_\-\u3400-\u9fff]+/g, " ")
    .trim()
    .split(/\s+/)
    .find((part) => part.length >= 4) ?? "proactive";
}

function renderActionNote(input: {
  cycle: number;
  kind: string;
  desire: DesireTrackView;
  intentText: string;
  questionText: string;
  practiceText: string;
}): string {
  return [
    "# Latest Proactive Intent",
    "",
    `- Cycle: ${input.cycle}`,
    `- Kind: ${input.kind}`,
    `- Desire: ${input.desire.title}`,
    `- Energy: ${input.desire.energy.toFixed(2)}`,
    `- Repetitions: ${input.desire.repetitions}`,
    "",
    "## Intent",
    input.intentText,
    "",
    "## User-Facing Question",
    input.questionText,
    "",
    "## Practice Step",
    input.practiceText,
    "",
    "## Boundary",
    "This note was written autonomously inside the project workspace.",
  ].join("\n");
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "intent";
}
