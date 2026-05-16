import { EntityExtractionAgent } from "./entity-extraction-agent.js";
import type {
  ActionExecutionResult,
  AgentProposal,
  MemoryFormationPlan,
  MemoryRecord,
  NewMemoryNode,
} from "../types.js";

export class ToolResultReflectionAgent {
  readonly id = "tool-reflector" as const;
  readonly role = "Turns tool execution output into durable semantic memory.";
  private readonly entityExtraction = new EntityExtractionAgent();

  reflect(results: ActionExecutionResult[], executionMemories: MemoryRecord[]): AgentProposal {
    const nodes: NewMemoryNode[] = [];
    const executionMemoryByTool = new Map<string, MemoryRecord>();

    for (const memory of executionMemories) {
      const toolName = parseToolNameFromExecutionText(memory.text);
      if (toolName) {
        executionMemoryByTool.set(toolName, memory);
      }
    }

    for (const result of results) {
      if (result.status !== "executed" || result.action.type !== "tool") {
        continue;
      }

      const toolName = getToolName(result);
      if (!toolName) {
        continue;
      }

      const semantic = semanticFromToolResult(toolName, result);
      if (semantic) {
        nodes.push(semantic);
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
        const toolName = node.tags?.find((tag) => tag.includes("."));
        const source = toolName ? executionMemoryByTool.get(toolName) : undefined;
        if (!source) {
          return [];
        }

        return [
          {
            fromMemoryId: source.id,
            toLocalId: node.localId,
            relation: "derived_from" as const,
            strength: 0.85,
            confidence: node.confidence,
          },
        ];
      }),
      rationale: "Convert low-level tool execution logs into durable semantic facts for future recall.",
    };
    const extracted = this.entityExtraction.extract(plan);

    return {
      agentId: this.id,
      intent: "reflect-tool-results",
      confidence: 0.88,
      content: `Extracted ${uniqueNodes.length} durable semantic fact(s) from tool output.`,
      memoryFormation: {
        ...plan,
        entities: extracted.entities,
        memoryEntityLinks: extracted.memoryEntityLinks,
      },
    };
  }
}

function semanticFromToolResult(
  toolName: string,
  result: ActionExecutionResult,
): NewMemoryNode | undefined {
  if (toolName === "memory.stats") {
    const stats = asRecord(result.metadata?.toolMetadata);
    const total = numberValue(stats.total);
    const active = numberValue(stats.active);
    const archived = numberValue(stats.archived);
    const pinned = numberValue(stats.pinned);
    if (total === undefined || active === undefined || archived === undefined || pinned === undefined) {
      return semanticNode(
        "tool-memory-stats-summary",
        `Latest memory stats reported by memory.stats: ${result.output}`,
        ["tool-result", "memory.stats", "memory", "status"],
      );
    }

    return semanticNode(
      "tool-memory-stats-summary",
      `Latest memory stats: total=${total}, active=${active}, archived=${archived}, pinned=${pinned}.`,
      ["tool-result", "memory.stats", "memory", "status"],
    );
  }

  if (toolName === "project.status") {
    const project = asRecord(result.metadata?.toolMetadata);
    const cwd = typeof project.cwd === "string" ? project.cwd : parseCwd(result.output);
    if (!cwd) {
      return semanticNode(
        "tool-project-status-summary",
        `Latest project status reported by project.status: ${result.output}`,
        ["tool-result", "project.status", "project", "status"],
      );
    }

    return semanticNode(
      "tool-project-status-summary",
      `Current project workspace cwd is ${cwd}.`,
      ["tool-result", "project.status", "project", "status"],
    );
  }

  return undefined;
}

function semanticNode(localId: string, text: string, tags: string[]): NewMemoryNode {
  return {
    localId,
    kind: "semantic",
    text,
    importance: 3,
    confidence: 0.95,
    tags,
  };
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

function parseCwd(output: string): string | undefined {
  const match = output.match(/cwd=([^\s.]+(?:\\[^\s.]+)*)/);
  return match?.[1];
}

function parseToolNameFromExecutionText(text: string): string | undefined {
  return text.match(/Action executed: tool\(([^)]+)\)/)?.[1];
}

function dedupeNodes(nodes: NewMemoryNode[]): NewMemoryNode[] {
  const byText = new Map<string, NewMemoryNode>();
  for (const node of nodes) {
    byText.set(node.text.toLowerCase(), node);
  }
  return [...byText.values()];
}
