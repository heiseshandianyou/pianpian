import type {
  ActivatedMemoryGraph,
  ActivatedMemoryNode,
  CompiledContext,
  ContextTrace,
  MemoryKind,
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

  compile(graph: ActivatedMemoryGraph): CompiledContext {
    const options = { ...defaultOptions, ...this.options };
    const nodes = dedupeNodes([...graph.focusNodes, ...graph.supportNodes]);
    const trace: ContextTrace[] = [];

    const relevantEntities = formatEntities(graph.entityNodes, trace);
    const focus = takeSection(
      nodes,
      ["self_model", "goal", "semantic", "preference", "reflection", "episode"],
      options.maxFocusItems,
      "focus",
      trace,
    );
    const selfModel = takeSection(nodes, ["self_model"], 6, "selfModel", trace);
    const goals = takeSection(nodes, ["goal"], 5, "goals", trace);
    const preferences = takeSection(nodes, ["preference"], 5, "preferences", trace);
    const longTermMemory = takeSection(
      nodes,
      ["semantic", "reflection"],
      options.maxLongTermItems,
      "longTermMemory",
      trace,
    );
    const recentEvidence = takeSection(
      nodes,
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
      return `- (${node.memory.kind}, activation=${activation}, confidence=${confidence}) ${node.memory.text}`;
    })
    .join("\n");
}

function renderPrompt(context: Omit<CompiledContext, "prompt">): string {
  return [
    "[Current Task]",
    context.currentTask,
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

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
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
