import type { Agent, AgentAction, AgentContext, AgentProposal, NewMemory } from "../types.js";

interface ProactiveScheduleState {
  queue: ProactiveQueueItem[];
  lastDispatchCycle?: number;
  lastUserNudgeCycle?: number;
  lastToolCycle?: number;
  lastWriteCycle?: number;
  dispatched: Array<{
    id: string;
    title: string;
    cycle: number;
    actionTypes: string[];
  }>;
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

export class ProactiveSchedulerAgent implements Agent {
  readonly id = "proactive-scheduler" as const;
  readonly role = "Schedules and dispatches proactive intentions with cooldowns and priorities.";

  async run(context: AgentContext): Promise<AgentProposal> {
    if (context.perception.source !== "internal") {
      return {
        agentId: this.id,
        intent: "skip-user-cycle-proactive-scheduler",
        confidence: 0.2,
        content: "Proactive scheduling only runs during autonomous internal cycles.",
      };
    }

    const state = getScheduleState(context.scratchpad);
    expireOldItems(state, context.cycle);
    const candidate = chooseDueItem(state, context.cycle);
    if (!candidate) {
      context.scratchpad.proactiveSchedule = state;
      return {
        agentId: this.id,
        intent: "proactive-scheduler-idle",
        confidence: 0.62,
        content: renderIdleSummary(state, context.cycle),
      };
    }

    const actions = selectActions(candidate, state, context.cycle);
    if (actions.length === 0) {
      candidate.dueCycle = context.cycle + 1;
      context.scratchpad.proactiveSchedule = state;
      return {
        agentId: this.id,
        intent: "proactive-scheduler-cooldown",
        confidence: 0.64,
        content: `Proactive intent "${candidate.title}" is ready, but all action channels are cooling down.`,
      };
    }

    candidate.attempts += 1;
    candidate.status = candidate.attempts >= candidate.maxAttempts ? "dispatched" : "queued";
    candidate.dueCycle = context.cycle + candidate.cooldownCycles;
    state.lastDispatchCycle = context.cycle;
    for (const action of actions) {
      if (action.type === "ask-user") {
        state.lastUserNudgeCycle = context.cycle;
      } else if (action.type === "tool") {
        state.lastToolCycle = context.cycle;
      } else if (action.type === "file-write") {
        state.lastWriteCycle = context.cycle;
      }
    }
    state.dispatched = [
      {
        id: candidate.id,
        title: candidate.title,
        cycle: context.cycle,
        actionTypes: actions.map((action) => action.type),
      },
      ...state.dispatched,
    ].slice(0, 12);
    state.queue = state.queue
      .filter((item) => item.status === "queued")
      .sort((left, right) => right.priority - left.priority);
    context.scratchpad.proactiveSchedule = state;

    const memoryWrites: NewMemory[] = [
      {
        kind: "episode",
        text: `Proactive scheduler dispatched "${candidate.title}" with actions: ${actions.map((action) => action.type).join(", ")}.`,
        importance: candidate.priority >= 0.82 ? 4 : 3,
        confidence: 0.82,
        tags: ["proactive", "scheduler", "dispatch", candidate.kind, ...actions.map((action) => action.type)],
      },
    ];

    return {
      agentId: this.id,
      intent: "proactive-scheduler-dispatch",
      confidence: 0.88,
      content: `Dispatched proactive intent "${candidate.title}" using ${actions.map((action) => action.type).join(", ")}.`,
      actions,
      memoryWrites,
    };
  }
}

function getScheduleState(scratchpad: Record<string, unknown>): ProactiveScheduleState {
  const candidate = scratchpad.proactiveSchedule;
  if (!candidate || typeof candidate !== "object") {
    return { queue: [], dispatched: [] };
  }
  const value = candidate as Partial<ProactiveScheduleState>;
  return {
    queue: Array.isArray(value.queue) ? value.queue.filter(isQueueItem) : [],
    lastDispatchCycle: typeof value.lastDispatchCycle === "number" ? value.lastDispatchCycle : undefined,
    lastUserNudgeCycle: typeof value.lastUserNudgeCycle === "number" ? value.lastUserNudgeCycle : undefined,
    lastToolCycle: typeof value.lastToolCycle === "number" ? value.lastToolCycle : undefined,
    lastWriteCycle: typeof value.lastWriteCycle === "number" ? value.lastWriteCycle : undefined,
    dispatched: Array.isArray(value.dispatched) ? value.dispatched.filter(isDispatchRecord) : [],
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
    item.status === "queued"
  );
}

function isDispatchRecord(value: unknown): value is ProactiveScheduleState["dispatched"][number] {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<ProactiveScheduleState["dispatched"][number]>;
  return typeof record.id === "string" && typeof record.title === "string" && typeof record.cycle === "number" && Array.isArray(record.actionTypes);
}

function expireOldItems(state: ProactiveScheduleState, cycle: number): void {
  state.queue = state.queue
    .map((item) => (item.expiresCycle < cycle ? { ...item, status: "expired" as const } : item))
    .filter((item) => item.status === "queued");
}

function chooseDueItem(state: ProactiveScheduleState, cycle: number): ProactiveQueueItem | undefined {
  return [...state.queue]
    .filter((item) => item.dueCycle <= cycle)
    .sort((left, right) => right.priority - left.priority || left.createdCycle - right.createdCycle)
    .at(0);
}

function selectActions(item: ProactiveQueueItem, state: ProactiveScheduleState, cycle: number): AgentAction[] {
  return item.actions.filter((action) => {
    if (action.type === "ask-user") {
      return passed(state.lastUserNudgeCycle, cycle, item.kind === "question" ? 4 : 6);
    }
    if (action.type === "tool") {
      return passed(state.lastToolCycle, cycle, 1);
    }
    if (action.type === "file-write") {
      return passed(state.lastWriteCycle, cycle, 1);
    }
    return true;
  });
}

function passed(lastCycle: number | undefined, cycle: number, cooldown: number): boolean {
  return lastCycle === undefined || cycle - lastCycle >= cooldown;
}

function renderIdleSummary(state: ProactiveScheduleState, cycle: number): string {
  if (state.queue.length === 0) {
    return "No proactive intentions are queued.";
  }
  const next = [...state.queue].sort((left, right) => left.dueCycle - right.dueCycle || right.priority - left.priority)[0];
  const wait = Math.max(0, next.dueCycle - cycle);
  return `Queued proactive intentions=${state.queue.length}; next="${next.title}" due in ${wait} cycle(s).`;
}
