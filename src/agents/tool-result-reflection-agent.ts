import { EntityExtractionAgent } from "./entity-extraction-agent.js";
import type {
  ActionExecutionResult,
  AgentProposal,
  MemoryFormationPlan,
  MemoryRecord,
  NewMemoryNode,
} from "../types.js";

type ToolOutcome = "success" | "failure" | "skipped";

interface ToolMemoryDecision {
  semantic: boolean;
  procedure: boolean;
  preference: boolean;
  episode: boolean;
  reflection: boolean;
}

interface ToolResultAnalysis {
  toolName: string;
  outcome: ToolOutcome;
  learnedFacts: string[];
  needsFollowUp: boolean;
  followUpReason?: string;
  failureSignal?: string;
  memoryDecision: ToolMemoryDecision;
}

export class ToolResultReflectionAgent {
  readonly id = "tool-reflector" as const;
  readonly role = "Turns tool execution output into durable semantic memory.";
  private readonly entityExtraction = new EntityExtractionAgent();

  reflect(results: ActionExecutionResult[], executionMemories: MemoryRecord[]): AgentProposal {
    const nodes: NewMemoryNode[] = [];
    const sourceMemoryByLocalId = new Map<string, string>();
    const executionMemoryByTool = new Map<string, MemoryRecord[]>();

    for (const memory of executionMemories) {
      const toolName = parseToolNameFromExecutionText(memory.text);
      if (toolName) {
        const existing = executionMemoryByTool.get(toolName) ?? [];
        existing.push(memory);
        executionMemoryByTool.set(toolName, existing);
      }
    }

    for (const [index, result] of results.entries()) {
      if (result.action.type !== "tool") {
        continue;
      }

      const toolName = getToolName(result) ?? "unknown-tool";
      const analysis = analyzeToolResult(toolName, result);
      const resultNodes = nodesFromToolAnalysis(analysis, result, index);
      const source = result.status === "executed" ? takeExecutionMemory(executionMemoryByTool, toolName) : undefined;
      for (const node of resultNodes) {
        nodes.push(node);
        if (source) {
          sourceMemoryByLocalId.set(node.localId, source.id);
        }
      }
    }

    const uniqueNodes = dedupeNodes(nodes);
    if (uniqueNodes.length === 0) {
      return {
        agentId: this.id,
        intent: "no-tool-facts",
        confidence: 0.72,
        content: "No durable tool facts were extracted.",
      };
    }

    const plan: MemoryFormationPlan = {
      nodes: uniqueNodes,
      edges: uniqueNodes.flatMap((node) => {
        const sourceMemoryId = sourceMemoryByLocalId.get(node.localId);
        if (!sourceMemoryId) {
          return [];
        }

        return [
          {
            fromMemoryId: sourceMemoryId,
            toLocalId: node.localId,
            relation: "derived_from" as const,
            strength: 0.85,
            confidence: node.confidence,
          },
        ];
      }),
      rationale: "Convert low-level tool execution logs into durable semantic facts and outcome reflections for future recall.",
    };
    const extracted = this.entityExtraction.extract(plan);

    return {
      agentId: this.id,
      intent: "reflect-tool-results",
      confidence: 0.88,
      content: `Reflected on ${uniqueNodes.length} durable tool outcome memory item(s).`,
      memoryFormation: {
        ...plan,
        entities: extracted.entities,
        memoryEntityLinks: extracted.memoryEntityLinks,
      },
    };
  }
}

function analyzeToolResult(toolName: string, result: ActionExecutionResult): ToolResultAnalysis {
  const outcome = classifyOutcome(result);
  const learnedFacts = extractLearnedFacts(toolName, result);
  const failureSignal = outcome === "success" ? undefined : summarizeFailureSignal(result);
  const followUpReason = followUpReasonFor(result, failureSignal);
  const needsFollowUp = Boolean(followUpReason);
  const memoryDecision: ToolMemoryDecision = {
    semantic: outcome === "success" && learnedFacts.length > 0,
    procedure: needsFollowUp && outcome !== "success",
    preference: detectsPreferenceSignal(result),
    episode: shouldCaptureEpisode(result),
    reflection: true,
  };

  return {
    toolName,
    outcome,
    learnedFacts,
    needsFollowUp,
    followUpReason,
    failureSignal,
    memoryDecision,
  };
}

function nodesFromToolAnalysis(
  analysis: ToolResultAnalysis,
  result: ActionExecutionResult,
  index: number,
): NewMemoryNode[] {
  const prefix = `tool-${slug(analysis.toolName)}-${index}`;
  const nodes: NewMemoryNode[] = [];
  const specializedSemantic =
    analysis.outcome === "success" ? semanticFromToolResult(analysis.toolName, result, `${prefix}-semantic`) : undefined;
  if (specializedSemantic) {
    nodes.push(specializedSemantic);
  } else if (analysis.memoryDecision.semantic) {
    nodes.push(memoryNode(
      `${prefix}-facts`,
      "semantic",
      `Tool ${analysis.toolName} learned: ${analysis.learnedFacts.join(" ")}`,
      ["tool-result", analysis.toolName, "learned-facts", analysis.outcome],
      3,
      0.86,
    ));
  }

  if (analysis.memoryDecision.reflection) {
    nodes.push(memoryNode(
      `${prefix}-reflection`,
      "reflection",
      renderReflectionText(analysis, result),
      ["tool-result", analysis.toolName, "outcome", analysis.outcome, "reflection"],
      analysis.outcome === "success" ? 2 : 4,
      analysis.outcome === "success" ? 0.78 : 0.88,
    ));
  }

  if (analysis.memoryDecision.episode) {
    nodes.push(memoryNode(
      `${prefix}-episode`,
      "episode",
      renderEpisodeText(analysis, result),
      ["tool-result", analysis.toolName, "episode", analysis.outcome],
      analysis.outcome === "success" ? 2 : 3,
      analysis.outcome === "success" ? 0.82 : 0.86,
    ));
  }

  if (analysis.memoryDecision.procedure && analysis.followUpReason) {
    nodes.push(memoryNode(
      `${prefix}-procedure`,
      "procedure",
      `Procedure after ${analysis.toolName} ${analysis.outcome}: ${analysis.followUpReason}`,
      ["tool-result", analysis.toolName, "follow-up", "procedure", analysis.outcome],
      4,
      0.82,
    ));
  }

  if (analysis.memoryDecision.preference) {
    nodes.push(memoryNode(
      `${prefix}-preference`,
      "preference",
      `Tool result preference signal from ${analysis.toolName}: ${firstUsefulSnippet(result.output, result.action.content)}`,
      ["tool-result", analysis.toolName, "preference"],
      3,
      0.68,
    ));
  }

  return nodes;
}

function semanticFromToolResult(
  toolName: string,
  result: ActionExecutionResult,
  localId = "tool-semantic-summary",
): NewMemoryNode | undefined {
  if (toolName === "memory.stats") {
    const stats = asRecord(result.metadata?.toolMetadata);
    const total = numberValue(stats.total);
    const active = numberValue(stats.active);
    const archived = numberValue(stats.archived);
    const pinned = numberValue(stats.pinned);
    if (total === undefined || active === undefined || archived === undefined || pinned === undefined) {
      return semanticNode(
        localId,
        `Latest memory stats reported by memory.stats: ${result.output}`,
        ["tool-result", "memory.stats", "memory", "status"],
      );
    }

    return semanticNode(
      localId,
      `Latest memory stats: total=${total}, active=${active}, archived=${archived}, pinned=${pinned}.`,
      ["tool-result", "memory.stats", "memory", "status"],
    );
  }

  if (toolName === "project.status") {
    const project = asRecord(result.metadata?.toolMetadata);
    const cwd = typeof project.cwd === "string" ? project.cwd : parseCwd(result.output);
    if (!cwd) {
      return semanticNode(
        localId,
        `Latest project status reported by project.status: ${result.output}`,
        ["tool-result", "project.status", "project", "status"],
      );
    }

    return semanticNode(
      localId,
      `Current project workspace cwd is ${cwd}.`,
      ["tool-result", "project.status", "project", "status"],
    );
  }

  return undefined;
}

function memoryNode(
  localId: string,
  kind: NewMemoryNode["kind"],
  text: string,
  tags: string[],
  importance: NewMemoryNode["importance"],
  confidence: number,
): NewMemoryNode {
  return {
    localId,
    kind,
    text,
    importance,
    confidence,
    tags,
  };
}

function semanticNode(localId: string, text: string, tags: string[]): NewMemoryNode {
  return memoryNode(localId, "semantic", text, tags, 3, 0.95);
}

function classifyOutcome(result: ActionExecutionResult): ToolOutcome {
  if (result.status === "failed") {
    return "failure";
  }

  if (result.status === "skipped") {
    return "skipped";
  }

  return hasFailureLanguage(result.output) || hasFailureLanguage(result.error) ? "failure" : "success";
}

function extractLearnedFacts(toolName: string, result: ActionExecutionResult): string[] {
  const metadata = asRecord(result.metadata?.toolMetadata);
  const facts: string[] = [];

  if (toolName === "memory.inspect") {
    const query = stringValue(metadata.query);
    const summary = stringValue(metadata.summary);
    if (query) {
      facts.push(`memory.inspect query="${clip(query, 140)}".`);
    }
    if (summary) {
      facts.push(`memory.inspect summary="${clip(summary, 220)}".`);
    }
  }

  if (toolName === "workspace.list") {
    const path = stringValue(metadata.path);
    const count = numberValue(metadata.count);
    facts.push(`workspace.list returned ${count ?? "unknown"} entries${path ? ` for ${path}` : ""}.`);
  }

  if (toolName === "workspace.search") {
    const query = stringValue(metadata.query);
    const path = stringValue(metadata.path);
    const count = numberValue(metadata.count);
    facts.push(`workspace.search found ${count ?? "unknown"} matches${query ? ` for "${clip(query, 80)}"` : ""}${path ? ` in ${path}` : ""}.`);
  }

  if (toolName === "workspace.read") {
    const path = stringValue(metadata.path);
    const chars = numberValue(metadata.chars);
    const truncated = metadata.truncated === true;
    if (path) {
      facts.push(`workspace.read read ${path}${chars !== undefined ? ` (${chars} chars${truncated ? ", truncated" : ""})` : ""}.`);
    }
  }

  if (toolName === "workspace.write") {
    const path = stringValue(metadata.path);
    const chars = numberValue(metadata.chars);
    if (path) {
      facts.push(`workspace.write wrote ${path}${chars !== undefined ? ` (${chars} chars)` : ""}.`);
    }
  }

  if (toolName === "workspace.command") {
    const command = stringValue(metadata.command);
    if (command) {
      facts.push(`workspace.command completed "${clip(command, 140)}".`);
    }
  }

  if (toolName === "codex.run") {
    const sandbox = stringValue(metadata.sandbox);
    const model = stringValue(metadata.model);
    facts.push(`codex.run completed${sandbox ? ` with sandbox=${sandbox}` : ""}${model ? ` and model=${model}` : ""}.`);
  }

  if (facts.length === 0) {
    const outputFact = extractOutputFact(result.output);
    if (outputFact) {
      facts.push(outputFact);
    }
  }

  if (result.status !== "executed" || classifyOutcome(result) !== "success") {
    const failure = summarizeFailureSignal(result);
    if (failure) {
      facts.push(`Failure detail: ${failure}`);
    }
  }

  return dedupeStrings(facts).slice(0, 4);
}

function followUpReasonFor(result: ActionExecutionResult, failureSignal: string | undefined): string | undefined {
  const signal = `${result.output}\n${result.error ?? ""}`.toLowerCase();
  if (!failureSignal && result.status === "executed") {
    return undefined;
  }

  if (signal.includes("no registered tool")) {
    return "choose a registered tool name before retrying the action.";
  }

  if (signal.includes("required")) {
    return "retry with the required input fields filled in.";
  }

  if (signal.includes("must stay inside the project workspace")) {
    return "retry with a workspace-relative path that stays inside the project root.";
  }

  if (signal.includes("not allowlisted") || signal.includes("allowed:")) {
    return "retry with an allowlisted command or ask for a safe extension to the tool policy.";
  }

  if (signal.includes("unavailable")) {
    return "rerun only after the runtime context provides the missing data.";
  }

  if (result.status === "failed") {
    return "inspect the error, adjust the tool input or environment, then retry only if the goal is still relevant.";
  }

  if (result.status === "skipped") {
    return "check the policy or tool metadata before attempting this action again.";
  }

  return failureSignal ? "verify the tool output and retry with corrected input if the task still needs it." : undefined;
}

function renderReflectionText(analysis: ToolResultAnalysis, result: ActionExecutionResult): string {
  const facts = analysis.learnedFacts.length > 0 ? analysis.learnedFacts.join(" ") : "No durable factual payload was found.";
  const followUp = analysis.needsFollowUp ? analysis.followUpReason : "No follow-up is required.";
  const input = renderToolInput(result);
  return [
    `Tool result reflection: ${analysis.toolName} outcome=${analysis.outcome} executionStatus=${result.status}.`,
    input ? `Input: ${input}.` : undefined,
    `Learned facts: ${facts}`,
    analysis.failureSignal ? `Failure signal: ${analysis.failureSignal}` : undefined,
    `Follow-up: ${followUp}`,
    `Memory decision: ${renderMemoryDecision(analysis.memoryDecision)}.`,
  ].filter((part): part is string => Boolean(part)).join(" ");
}

function renderEpisodeText(analysis: ToolResultAnalysis, result: ActionExecutionResult): string {
  const facts = analysis.learnedFacts.length > 0 ? ` Learned facts: ${analysis.learnedFacts.join(" ")}` : "";
  const failure = analysis.failureSignal ? ` Failure signal: ${analysis.failureSignal}` : "";
  return `Tool execution episode: ${analysis.toolName} outcome=${analysis.outcome} status=${result.status} at ${result.createdAt}.${facts}${failure}`;
}

function renderMemoryDecision(decision: ToolMemoryDecision): string {
  return [
    `semantic=${decision.semantic ? "yes" : "no"}`,
    `procedure=${decision.procedure ? "yes" : "no"}`,
    `preference=${decision.preference ? "yes" : "no"}`,
    `episode=${decision.episode ? "yes" : "no"}`,
    `reflection=${decision.reflection ? "yes" : "no"}`,
  ].join(", ");
}

function renderToolInput(result: ActionExecutionResult): string | undefined {
  const input = result.action.metadata?.input;
  if (!input || typeof input !== "object") {
    return undefined;
  }

  try {
    return clip(JSON.stringify(input), 220);
  } catch {
    return undefined;
  }
}

function summarizeFailureSignal(result: ActionExecutionResult): string | undefined {
  return firstUsefulSnippet(result.error, result.output);
}

function firstUsefulSnippet(...parts: Array<string | undefined>): string {
  for (const part of parts) {
    const normalized = normalizeWhitespace(part ?? "");
    if (normalized) {
      return clip(normalized, 260);
    }
  }

  return "No useful details were reported.";
}

function extractOutputFact(output: string): string | undefined {
  const normalized = normalizeWhitespace(output);
  if (!normalized || normalized.length < 4) {
    return undefined;
  }

  const firstLine = normalized.split(/(?<=\.)\s+/).find((line) => line.length > 0);
  return firstLine ? `Tool output reported: ${clip(firstLine, 260)}` : undefined;
}

function hasFailureLanguage(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim();
  return /^(failed|failure|error|exception|denied|invalid|missing|required|unavailable|unable)\b/i.test(normalized) ||
    /\b(not allowlisted|no registered tool|must stay inside|requires confirmation)\b/i.test(normalized);
}

function detectsPreferenceSignal(result: ActionExecutionResult): boolean {
  return /\b(prefer|preference|preferred)\b/i.test(`${result.action.content}\n${result.output}`);
}

function shouldCaptureEpisode(result: ActionExecutionResult): boolean {
  if (result.status !== "executed") {
    return true;
  }

  const toolName = getToolName(result) ?? "";
  return ["workspace.write", "workspace.command", "codex.run"].includes(toolName);
}

function getToolName(result: ActionExecutionResult): string | undefined {
  if (typeof result.metadata?.toolName === "string") {
    return result.metadata.toolName;
  }

  return typeof result.action.metadata?.toolName === "string" ? result.action.metadata.toolName : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function parseCwd(output: string): string | undefined {
  const match = output.match(/cwd=([^\s.]+(?:\\[^\s.]+)*)/);
  return match?.[1];
}

function parseToolNameFromExecutionText(text: string): string | undefined {
  return text.match(/Action executed: tool\(([^)]+)\)/)?.[1];
}

function takeExecutionMemory(
  executionMemoryByTool: Map<string, MemoryRecord[]>,
  toolName: string,
): MemoryRecord | undefined {
  const memories = executionMemoryByTool.get(toolName);
  if (!memories || memories.length === 0) {
    return undefined;
  }

  return memories.shift();
}

function dedupeNodes(nodes: NewMemoryNode[]): NewMemoryNode[] {
  const byText = new Map<string, NewMemoryNode>();
  for (const node of nodes) {
    byText.set(node.text.toLowerCase(), node);
  }
  return [...byText.values()];
}

function dedupeStrings(values: string[]): string[] {
  return [...new Map(values.map((value) => [value.toLowerCase(), value])).values()];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value: string, maxLength: number): string {
  const normalized = normalizeWhitespace(value);
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tool";
}
