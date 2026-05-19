import type {
  ActivatedMemoryGraph,
  ActivatedMemoryNode,
  CompiledContext,
  ContextTrace,
  InnerState,
  MemoryKind,
  WorkingMemoryFrame,
  WorkingMemorySection,
  WorkingMemorySlot,
} from "../types.js";

export interface ContextCompilerOptions {
  maxFocusItems: number;
  maxLongTermItems: number;
  maxEvidenceItems: number;
}

const defaultOptions: ContextCompilerOptions = {
  maxFocusItems: 5,
  maxLongTermItems: 8,
  maxEvidenceItems: 4,
};

export class ContextCompiler {
  constructor(private readonly options: Partial<ContextCompilerOptions> = {}) {}

  compile(graph: ActivatedMemoryGraph, innerState?: InnerState, workingMemory?: WorkingMemoryFrame): CompiledContext {
    const options = { ...defaultOptions, ...this.options };
    const nodes = workingMemory
      ? workingMemory.slots.map((slot) => slot.node)
      : dedupeNodes([...graph.focusNodes, ...graph.supportNodes]);
    const contentNodes = nodes.filter((node) => !isOperationalLogNode(node));
    const trace: ContextTrace[] = [];

    const relevantEntities = formatEntities(graph.entityNodes, trace);
    const focus = workingMemory
      ? formatSlots(
          slotsFor(workingMemory, ["topic", "relationship", "procedures", "goals"], options.maxFocusItems),
          "focus",
          trace,
        )
      : takeSection(
          contentNodes,
          ["self_model", "goal", "semantic", "preference", "reflection", "episode"],
          options.maxFocusItems,
          "focus",
          trace,
        );
    const selfModel = workingMemory
      ? formatSlots(slotsFor(workingMemory, ["identity"], 6), "selfModel", trace)
      : takeSection(contentNodes, ["self_model"], 6, "selfModel", trace);
    const goals = workingMemory
      ? formatSlots(slotsFor(workingMemory, ["goals"], 5), "goals", trace)
      : takeSection(contentNodes, ["goal"], 5, "goals", trace);
    const preferences = workingMemory
      ? formatSlots(slotsFor(workingMemory, ["preferences"], 5), "preferences", trace)
      : takeSection(contentNodes, ["preference"], 5, "preferences", trace);
    const longTermMemory = workingMemory
      ? formatSlots(
          slotsFor(workingMemory, ["topic", "relationship", "background", "procedures"], options.maxLongTermItems).filter((slot) =>
            ["semantic", "reflection", "procedure", "relationship"].includes(slot.node.memory.kind),
          ),
          "longTermMemory",
          trace,
        )
      : takeSection(
          contentNodes,
          ["semantic", "reflection"],
          options.maxLongTermItems,
          "longTermMemory",
          trace,
        );
    const recentEvidence = workingMemory
      ? formatSlots(slotsFor(workingMemory, ["evidence"], options.maxEvidenceItems), "recentEvidence", trace)
      : takeSection(
          contentNodes,
          ["episode"],
          options.maxEvidenceItems,
          "recentEvidence",
          trace,
        );
    const uncertainty =
      graph.contradictionNodes.length > 0
        ? formatNodes(graph.contradictionNodes, "uncertainty", trace)
        : "No activated contradictions.";

    const compiled: CompiledContext = {
      currentTask: graph.query.taskIntent,
      innerState: formatInnerState(innerState),
      workingMemory: formatWorkingMemoryFrame(workingMemory),
      relevantEntities,
      selfModel,
      focus,
      goals,
      preferences,
      longTermMemory,
      uncertainty,
      recentEvidence,
      trace,
      prompt: "",
    };

    compiled.prompt = renderPrompt(compiled);
    return compiled;
  }
}

function dedupeNodes(nodes: ActivatedMemoryNode[]): ActivatedMemoryNode[] {
  const byText = new Map<string, ActivatedMemoryNode>();

  for (const node of nodes) {
    const key = `${node.memory.kind}:${normalizeText(node.memory.text)}`;
    const existing = byText.get(key);
    if (!existing || node.activation > existing.activation) {
      byText.set(key, node);
    }
  }

  return [...byText.values()].sort((left, right) => right.activation - left.activation);
}

function takeSection(
  nodes: ActivatedMemoryNode[],
  kinds: MemoryKind[],
  limit: number,
  section: string,
  trace: ContextTrace[],
): string {
  const selected = nodes.filter((node) => kinds.includes(node.memory.kind)).slice(0, limit);
  return formatNodes(selected, section, trace);
}

function formatNodes(nodes: ActivatedMemoryNode[], section: string, trace: ContextTrace[]): string {
  if (nodes.length === 0) {
    return "None activated.";
  }

  for (const node of nodes) {
    trace.push({
      memoryId: node.memory.id,
      section,
      reason: node.reasons.join("; "),
      activation: node.activation,
    });
  }

  return nodes
    .map((node) => {
      const confidence = node.memory.confidence.toFixed(2);
      const activation = node.activation.toFixed(2);
      const source = formatMemorySource(node.memory);
      return `- (${node.memory.kind}, activation=${activation}, confidence=${confidence}${source}) ${node.memory.text}`;
    })
    .join("\n");
}

function renderPrompt(context: Omit<CompiledContext, "prompt">): string {
  return [
    "[Current Task]",
    context.currentTask,
    "",
    "[Inner State]",
    context.innerState,
    "",
    "[Working Memory Gate]",
    context.workingMemory,
    "",
    "[Relevant Entities]",
    context.relevantEntities,
    "",
    "[Self Model]",
    context.selfModel,
    "",
    "[Focus Memory]",
    context.focus,
    "",
    "[Active Goals]",
    context.goals,
    "",
    "[User Preferences]",
    context.preferences,
    "",
    "[Relevant Long-Term Memory]",
    context.longTermMemory,
    "",
    "[Uncertainty / Contradictions]",
    context.uncertainty,
    "",
    "[Recent Evidence]",
    context.recentEvidence,
  ].join("\n");
}

function slotsFor(
  workingMemory: WorkingMemoryFrame,
  sections: WorkingMemorySection[],
  limit: number,
): WorkingMemorySlot[] {
  return workingMemory.slots.filter((slot) => sections.includes(slot.section)).slice(0, limit);
}

function formatSlots(slots: WorkingMemorySlot[], section: string, trace: ContextTrace[]): string {
  if (slots.length === 0) {
    return "None activated.";
  }

  for (const slot of slots) {
    trace.push({
      memoryId: slot.node.memory.id,
      section,
      reason: [`workingMemory=${slot.section}`, ...slot.reasons, ...slot.node.reasons].join("; "),
      activation: slot.node.activation,
    });
  }

  return slots
    .map((slot) => {
      const confidence = slot.node.memory.confidence.toFixed(2);
      const activation = slot.node.activation.toFixed(2);
      const score = slot.score.toFixed(2);
      const source = formatMemorySource(slot.node.memory);
      return `- (${slot.node.memory.kind}, wm=${slot.section}, score=${score}, activation=${activation}, confidence=${confidence}${source}) ${slot.node.memory.text}`;
    })
    .join("\n");
}

function formatWorkingMemoryFrame(workingMemory?: WorkingMemoryFrame): string {
  if (!workingMemory) {
    return "No working memory gate was applied.";
  }

  const slots = workingMemory.slots
    .map((slot) => `${slot.section}${slot.topicSubchannel ? `.${slot.topicSubchannel}` : ""}:${slot.node.memory.kind}:${slot.score.toFixed(2)}`)
    .join(", ");
  return [
    workingMemory.summary,
    ...formatTopicSubchannels(workingMemory),
    `selected=${slots || "none"}`,
    `excluded=${workingMemory.excluded.length}`,
  ].join("\n");
}

function formatTopicSubchannels(workingMemory: WorkingMemoryFrame): string[] {
  const labels: Array<[string, string]> = [
    ["history", "Topic History"],
    ["food", "Topic Food"],
    ["route", "Topic Route"],
    ["promise", "Topic Promise / Relationship"],
    ["general", "Topic General"],
  ];

  return labels.map(([subchannel, label]) => {
    const items = workingMemory.slots.filter(
      (slot) => slot.section === "topic" && (slot.topicSubchannel ?? "general") === subchannel,
    );
    if (items.length === 0) {
      return `[${label}]\nNone selected.`;
    }
    return [
      `[${label}]`,
      ...items.map((slot) => {
        const score = slot.score.toFixed(2);
        const source = formatMemorySource(slot.node.memory);
        return `- (${slot.node.memory.kind}, score=${score}${source}) ${slot.node.memory.text}`;
      }),
    ].join("\n");
  });
}

function formatMemorySource(memory: ActivatedMemoryNode["memory"]): string {
  if (!memory.sourcePath) {
    return "";
  }

  const anchor = memory.sourceAnchor ? `#${memory.sourceAnchor}` : "";
  return `, source=${memory.storageKind}:${memory.sourcePath}${anchor}`;
}

function formatInnerState(innerState?: InnerState): string {
  if (!innerState) {
    return "No inner state snapshot.";
  }

  return [
    `mood=${innerState.mood}`,
    `arousal=${innerState.arousal.toFixed(2)}`,
    `socialNeed=${innerState.socialNeed.toFixed(2)}`,
    `curiosity=${innerState.curiosity.toFixed(2)}`,
    `continuityNeed=${innerState.continuityNeed.toFixed(2)}`,
    `dominantDrives=${innerState.dominantDrives.join(", ")}`,
    `recallBiasTags=${innerState.recallBiasTags.join(", ")}`,
    innerState.note,
  ].join("\n");
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function isOperationalLogNode(node: ActivatedMemoryNode): boolean {
  const text = node.memory.text.toLowerCase();
  const tags = node.memory.tags.map((tag) => tag.toLowerCase());
  return (
    text.startsWith("action executed:") ||
    text.startsWith("cycle ") ||
    text.startsWith("internal heartbeat:") ||
    text.includes("learning evaluation:") ||
    tags.includes("action") ||
    tags.includes("execution") ||
    tags.includes("say") ||
    tags.includes("cycle-evaluation") ||
    tags.includes("heartbeat") ||
    (tags.includes("learning") && tags.includes("cycle-evaluation"))
  );
}

function formatEntities(
  entities: ActivatedMemoryGraph["entityNodes"],
  trace: ContextTrace[],
): string {
  if (entities.length === 0) {
    return "None activated.";
  }

  for (const node of entities) {
    trace.push({
      section: "relevantEntities",
      reason: node.reasons.join("; "),
      activation: node.activation,
    });
  }

  return entities
    .map((node) => {
      const activation = node.activation.toFixed(2);
      const aliases = node.entity.aliases.length > 0 ? ` aliases=${node.entity.aliases.join(", ")}` : "";
      const linked = node.linkedMemoryIds.length;
      return `- (${node.entity.kind}, activation=${activation}, linkedMemories=${linked}) ${node.entity.name}${aliases}`;
    })
    .join("\n");
}
