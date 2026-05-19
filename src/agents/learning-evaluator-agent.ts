import { EntityExtractionAgent } from "./entity-extraction-agent.js";
import type {
  ActionExecutionResult,
  Agent,
  AgentAction,
  AgentContext,
  AgentProposal,
  MemoryFormationPlan,
  NewMemoryEdge,
  NewMemoryNode,
  Perception,
} from "../types.js";

export type LearningOutcome = "success" | "partial" | "failure" | "no-op" | "unknown";

export interface LearningEvaluatorInput {
  cycle?: number;
  perception?: Perception;
  proposals?: AgentProposal[];
  actions?: AgentAction[];
  executionResults?: ActionExecutionResult[];
  notes?: string[];
  evaluatedAt?: string;
}

export interface LearningEvaluationMetrics {
  proposalCount: number;
  proposedActionCount: number;
  selectedActionCount: number;
  executionCount: number;
  executedCount: number;
  failedCount: number;
  skippedCount: number;
  memoryProposalCount: number;
  toolActionCount: number;
}

export interface LearningEvaluation {
  outcome: LearningOutcome;
  successes: string[];
  failures: string[];
  gaps: string[];
  nextStrategies: string[];
  durablePreferenceSignals: string[];
  metrics: LearningEvaluationMetrics;
}

interface SnapshotInput {
  proposals: AgentProposal[];
  actions: AgentAction[];
  executionResults: ActionExecutionResult[];
}

export class LearningEvaluatorAgent implements Agent {
  readonly id = "learning-evaluator" as const;
  readonly role = "Evaluates cycle outcomes and turns successes, failures, gaps, and next strategies into learning memory.";
  private readonly entityExtraction = new EntityExtractionAgent();

  async run(context: AgentContext): Promise<AgentProposal> {
    return this.evaluate({
      cycle: context.cycle,
      perception: context.perception,
      ...snapshotFromScratchpad(context.scratchpad),
      notes: [
        "Lightweight run(context) mode was used; runtime can provide richer post-execution snapshots through evaluate(input).",
      ],
    });
  }

  evaluate(input: LearningEvaluatorInput): AgentProposal {
    const snapshot = normalizeSnapshot(input);
    const evaluation = evaluateSnapshot(snapshot, input);
    const memoryFormation = buildMemoryFormation(evaluation, input, this.entityExtraction);

    return {
      agentId: this.id,
      intent: "evaluate-cycle-learning",
      confidence: confidenceFor(evaluation, snapshot),
      content: renderContent(evaluation, input),
      ...(memoryFormation.nodes.length > 0 ? { memoryFormation } : {}),
    };
  }
}

function normalizeSnapshot(input: LearningEvaluatorInput): SnapshotInput {
  const proposals = input.proposals ?? [];
  const explicitActions = input.actions ?? [];
  const proposedActions = proposals.flatMap((proposal) => proposal.actions ?? []);
  const actions = explicitActions.length > 0 ? explicitActions : proposedActions;
  return {
    proposals,
    actions,
    executionResults: input.executionResults ?? [],
  };
}

function evaluateSnapshot(snapshot: SnapshotInput, input: LearningEvaluatorInput): LearningEvaluation {
  const metrics = metricsFor(snapshot);
  const successes = collectSuccesses(snapshot, metrics);
  const failures = collectFailures(snapshot);
  const gaps = collectGaps(snapshot, input, metrics);
  const nextStrategies = collectNextStrategies(snapshot, failures, gaps, metrics);
  const durablePreferenceSignals = collectPreferenceSignals(snapshot, input);
  const outcome = classifyLearningOutcome(metrics, failures, gaps);

  return {
    outcome,
    successes,
    failures,
    gaps,
    nextStrategies,
    durablePreferenceSignals,
    metrics,
  };
}

function metricsFor(snapshot: SnapshotInput): LearningEvaluationMetrics {
  return {
    proposalCount: snapshot.proposals.length,
    proposedActionCount: snapshot.proposals.reduce((sum, proposal) => sum + (proposal.actions?.length ?? 0), 0),
    selectedActionCount: snapshot.actions.length,
    executionCount: snapshot.executionResults.length,
    executedCount: snapshot.executionResults.filter((result) => result.status === "executed").length,
    failedCount: snapshot.executionResults.filter((result) => result.status === "failed").length,
    skippedCount: snapshot.executionResults.filter((result) => result.status === "skipped").length,
    memoryProposalCount: snapshot.proposals.filter((proposal) => proposal.memoryFormation || proposal.memoryWrites?.length).length,
    toolActionCount: snapshot.actions.filter((action) => action.type === "tool").length,
  };
}

function collectSuccesses(snapshot: SnapshotInput, metrics: LearningEvaluationMetrics): string[] {
  const successes: string[] = [];
  if (metrics.proposalCount > 0) {
    successes.push(`${metrics.proposalCount} agent proposal(s) were produced.`);
  }
  if (metrics.memoryProposalCount > 0) {
    successes.push(`${metrics.memoryProposalCount} proposal(s) carried memory updates.`);
  }
  if (metrics.executedCount > 0) {
    successes.push(`${metrics.executedCount} action(s) executed successfully.`);
  }

  for (const result of snapshot.executionResults
    .filter((candidate) => candidate.status === "executed" && candidate.action.type !== "say")
    .slice(0, 3)) {
    successes.push(`Executed ${actionLabel(result.action)}: ${clip(firstUsefulLine(result.output), 180)}`);
  }

  if (successes.length === 0 && metrics.proposalCount === 0 && metrics.executionCount === 0) {
    successes.push("No concrete success signal was available in the supplied snapshot.");
  }

  return dedupeStrings(successes).slice(0, 5);
}

function collectFailures(snapshot: SnapshotInput): string[] {
  const failures = snapshot.executionResults
    .filter((result) => result.status === "failed")
    .map((result) => `${actionLabel(result.action)} failed: ${clip(firstUsefulLine(result.error ?? result.output), 220)}`);

  const suspiciousOutputs = snapshot.executionResults
    .filter((result) => result.status === "executed" && shouldInspectOutputForFailure(result) && hasFailureLanguage(result.output))
    .map((result) => `${actionLabel(result.action)} output still contained a failure signal: ${clip(firstUsefulLine(result.output), 220)}`);

  return dedupeStrings([...failures, ...suspiciousOutputs]).slice(0, 5);
}

function shouldInspectOutputForFailure(result: ActionExecutionResult): boolean {
  if (result.action.type !== "tool") {
    return true;
  }

  const toolName = typeof result.action.metadata?.toolName === "string" ? result.action.metadata.toolName : "";
  return !["workspace.search", "workspace.read"].includes(toolName);
}

function collectGaps(
  snapshot: SnapshotInput,
  input: LearningEvaluatorInput,
  metrics: LearningEvaluationMetrics,
): string[] {
  const gaps: string[] = [];
  if (metrics.proposalCount === 0) {
    gaps.push("No proposal snapshot was supplied, so agent intent quality could not be compared.");
  }
  if (metrics.selectedActionCount === 0 && metrics.proposedActionCount > 0) {
    gaps.push("Agents proposed actions, but no selected action reached the execution snapshot.");
  }
  if (metrics.executionCount === 0 && metrics.selectedActionCount > 0) {
    gaps.push("Selected actions had no execution result, so success or failure cannot be confirmed.");
  }
  if (metrics.skippedCount > 0) {
    gaps.push(`${metrics.skippedCount} action(s) were skipped; policy or readiness should be reviewed before retrying.`);
  }
  if (metrics.memoryProposalCount === 0 && hasLearningSignal(snapshot, input)) {
    gaps.push("The cycle had outcome signals but no proposal attempted to form durable learning memory.");
  }

  return dedupeStrings([...gaps, ...(input.notes ?? [])]).slice(0, 6);
}

function collectNextStrategies(
  snapshot: SnapshotInput,
  failures: string[],
  gaps: string[],
  metrics: LearningEvaluationMetrics,
): string[] {
  const strategies: string[] = [];
  if (failures.length > 0) {
    strategies.push("Before retrying, inspect the failing action input, error text, and policy/tool constraints, then retry the smallest corrected step.");
  }
  if (metrics.skippedCount > 0) {
    strategies.push("When an action is skipped, preserve the user-facing intent but choose an allowed action or ask for confirmation instead of silently dropping it.");
  }
  if (metrics.executionCount === 0 && metrics.selectedActionCount > 0) {
    strategies.push("At the end of the cycle, pass executionResults into evaluate(input) so learning can distinguish completion from pending work.");
  }
  if (metrics.toolActionCount > 0 && metrics.executedCount > 0) {
    strategies.push("Keep tool-backed answers grounded in the latest execution output and summarize only the durable fact, not the raw log.");
  }
  if (gaps.some((gap) => gap.includes("No proposal snapshot"))) {
    strategies.push("Call evaluate({ proposals, actions, executionResults }) after the director and executor finish to enable full-cycle comparison.");
  }
  if (strategies.length === 0) {
    strategies.push("Repeat the working pattern: propose a focused action, execute it, and store only compact outcome memory.");
  }

  return dedupeStrings(strategies).slice(0, 5);
}

function collectPreferenceSignals(snapshot: SnapshotInput, input: LearningEvaluatorInput): string[] {
  const text = [
    input.perception?.text,
    ...snapshot.proposals.map((proposal) => proposal.content),
    ...snapshot.actions.map((action) => action.content),
    ...snapshot.executionResults.flatMap((result) => [result.output, result.error ?? ""]),
  ].join("\n");
  const signals: string[] = [];

  if (/\b(prefer|preference|preferred)\b/i.test(text)) {
    signals.push(`Potential user/system preference signal: ${clip(firstUsefulLine(text), 220)}`);
  }
  if (snapshot.executionResults.some((result) => result.action.type === "tool" && result.status === "executed")) {
    signals.push("Prefer tool-grounded learning when the cycle includes successful tool execution.");
  }

  return dedupeStrings(signals).slice(0, 3);
}

function classifyLearningOutcome(
  metrics: LearningEvaluationMetrics,
  failures: string[],
  gaps: string[],
): LearningOutcome {
  if (metrics.proposalCount === 0 && metrics.selectedActionCount === 0 && metrics.executionCount === 0) {
    return "unknown";
  }
  if (metrics.executionCount === 0 && metrics.selectedActionCount === 0) {
    return "no-op";
  }
  if (failures.length > 0 && metrics.executedCount === 0) {
    return "failure";
  }
  if (failures.length > 0 || metrics.skippedCount > 0 || gaps.length > 0) {
    return "partial";
  }
  return "success";
}

function buildMemoryFormation(
  evaluation: LearningEvaluation,
  input: LearningEvaluatorInput,
  entityExtraction: EntityExtractionAgent,
): MemoryFormationPlan {
  const cycle = input.cycle ?? "unknown";
  const prefix = `learning-${slug(String(cycle))}`;
  const nodes: NewMemoryNode[] = [
    {
      localId: `${prefix}-reflection`,
      kind: "reflection",
      text: renderReflectionMemory(evaluation, input),
      importance: importanceFor(evaluation.outcome),
      confidence: evaluation.outcome === "unknown" ? 0.58 : 0.84,
      tags: ["learning", "cycle-evaluation", "reflection", evaluation.outcome],
    },
  ];

  if (evaluation.nextStrategies.length > 0 && evaluation.outcome !== "success") {
    nodes.push({
      localId: `${prefix}-procedure`,
      kind: "procedure",
      text: `Cycle ${cycle} next strategy: ${evaluation.nextStrategies.join(" ")}`,
      importance: evaluation.failures.length > 0 ? 4 : 3,
      confidence: 0.8,
      tags: ["learning", "cycle-evaluation", "procedure", evaluation.outcome],
    });
  }

  for (const [index, signal] of evaluation.durablePreferenceSignals.entries()) {
    nodes.push({
      localId: `${prefix}-preference-${index + 1}`,
      kind: "preference",
      text: `Learning preference from cycle ${cycle}: ${signal}`,
      importance: 3,
      confidence: 0.66,
      tags: ["learning", "cycle-evaluation", "preference"],
    });
  }

  const edges: NewMemoryEdge[] = nodes
    .filter((node) => node.localId !== `${prefix}-reflection`)
    .map((node) => ({
      fromLocalId: `${prefix}-reflection`,
      toLocalId: node.localId,
      relation: "elaborates" as const,
      strength: 0.72,
      confidence: node.confidence,
    }));

  const plan: MemoryFormationPlan = {
    nodes,
    edges,
    rationale: "Evaluate the completed cycle snapshot and store compact reflection, procedure, and preference learning for future cycles.",
  };
  const extracted = entityExtraction.extract(plan);

  return {
    ...plan,
    entities: extracted.entities,
    memoryEntityLinks: extracted.memoryEntityLinks,
  };
}

function renderReflectionMemory(evaluation: LearningEvaluation, input: LearningEvaluatorInput): string {
  const cycle = input.cycle ?? "unknown";
  const task = input.perception?.text ? ` Perception: ${clip(input.perception.text, 180)}` : "";
  return [
    `Learning evaluation for cycle ${cycle}: outcome=${evaluation.outcome}.`,
    `Successes: ${evaluation.successes.join(" ")}`,
    evaluation.failures.length > 0 ? `Failures: ${evaluation.failures.join(" ")}` : "Failures: none detected.",
    evaluation.gaps.length > 0 ? `Gaps: ${evaluation.gaps.join(" ")}` : "Gaps: none detected.",
    `Next strategy: ${evaluation.nextStrategies.join(" ")}`,
    `Metrics: proposals=${evaluation.metrics.proposalCount}, actions=${evaluation.metrics.selectedActionCount}, executed=${evaluation.metrics.executedCount}, failed=${evaluation.metrics.failedCount}, skipped=${evaluation.metrics.skippedCount}.`,
    task,
  ].filter((part) => part.length > 0).join(" ");
}

function renderContent(evaluation: LearningEvaluation, input: LearningEvaluatorInput): string {
  const cycle = input.cycle ?? "unknown";
  return [
    `Cycle ${cycle} learning evaluation: ${evaluation.outcome}.`,
    `Success: ${evaluation.successes[0] ?? "none"}`,
    `Failure: ${evaluation.failures[0] ?? "none"}`,
    `Gap: ${evaluation.gaps[0] ?? "none"}`,
    `Next: ${evaluation.nextStrategies[0] ?? "continue compact reflection"}`,
  ].join(" ");
}

function confidenceFor(evaluation: LearningEvaluation, snapshot: SnapshotInput): number {
  if (evaluation.outcome === "unknown") {
    return 0.52;
  }
  if (snapshot.executionResults.length > 0) {
    return evaluation.failures.length > 0 ? 0.86 : 0.82;
  }
  return 0.66;
}

function importanceFor(outcome: LearningOutcome): NewMemoryNode["importance"] {
  if (outcome === "failure") {
    return 5;
  }
  if (outcome === "partial") {
    return 4;
  }
  if (outcome === "success") {
    return 3;
  }
  return 2;
}

function snapshotFromScratchpad(scratchpad: Record<string, unknown>): Partial<LearningEvaluatorInput> {
  return {
    proposals: arrayOfProposals(firstDefined(scratchpad.proposals, scratchpad.agentProposals, scratchpad.cycleProposals)),
    actions: arrayOfActions(firstDefined(scratchpad.actions, scratchpad.selectedActions, scratchpad.cycleActions)),
    executionResults: arrayOfExecutionResults(firstDefined(
      scratchpad.executionResults,
      scratchpad.actionExecutionResults,
      scratchpad.cycleExecutionResults,
    )),
  };
}

function arrayOfProposals(value: unknown): AgentProposal[] | undefined {
  return Array.isArray(value) ? value.filter(isAgentProposal) : undefined;
}

function arrayOfActions(value: unknown): AgentAction[] | undefined {
  return Array.isArray(value) ? value.filter(isAgentAction) : undefined;
}

function arrayOfExecutionResults(value: unknown): ActionExecutionResult[] | undefined {
  return Array.isArray(value) ? value.filter(isActionExecutionResult) : undefined;
}

function isAgentProposal(value: unknown): value is AgentProposal {
  const record = asRecord(value);
  return typeof record.agentId === "string" && typeof record.intent === "string" && typeof record.content === "string";
}

function isAgentAction(value: unknown): value is AgentAction {
  const record = asRecord(value);
  return typeof record.type === "string" && typeof record.content === "string";
}

function isActionExecutionResult(value: unknown): value is ActionExecutionResult {
  const record = asRecord(value);
  return isAgentAction(record.action) && typeof record.status === "string" && typeof record.output === "string";
}

function hasLearningSignal(snapshot: SnapshotInput, input: LearningEvaluatorInput): boolean {
  return Boolean(input.perception?.text) || snapshot.executionResults.length > 0 || snapshot.actions.length > 0;
}

function actionLabel(action: AgentAction): string {
  if (action.type === "tool" && typeof action.metadata?.toolName === "string") {
    return `tool(${action.metadata.toolName})`;
  }
  return action.type;
}

function hasFailureLanguage(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim();
  return /^(failed|failure|error|exception|denied|invalid|missing|required|unavailable|unable)\b/i.test(normalized) ||
    /\b(not allowlisted|no registered tool|must stay inside|requires confirmation)\b/i.test(normalized);
}

function firstUsefulLine(value: string | undefined): string {
  const normalized = normalizeWhitespace(value ?? "");
  return normalized.split(/(?<=\.)\s+/).find((line) => line.trim().length > 0) ?? "No useful detail was reported.";
}

function firstDefined<T>(...values: T[]): T | undefined {
  return values.find((value) => value !== undefined);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function dedupeStrings(values: string[]): string[] {
  return [...new Map(values.map((value) => [normalizeWhitespace(value).toLowerCase(), normalizeWhitespace(value)])).values()]
    .filter((value) => value.length > 0);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value: string, maxLength: number): string {
  const normalized = normalizeWhitespace(value);
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cycle";
}
