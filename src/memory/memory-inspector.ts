import { nowIso } from "../utils/id.js";
import { MemoryStore } from "./memory-store.js";
import type {
  ActivatedMemoryGraph,
  CompiledContext,
  MemoryInspectionNode,
  MemoryInspectionReport,
} from "../types.js";

export class MemoryInspector {
  constructor(private readonly memory: MemoryStore) {}

  inspectActivatedGraph(
    graph: ActivatedMemoryGraph,
    context?: CompiledContext,
    limit = 8,
  ): MemoryInspectionReport {
    const nodes = [...graph.focusNodes, ...graph.supportNodes].slice(0, limit);
    const memoryIds = nodes.map((node) => node.memory.id);
    const contextSectionsByMemory = groupContextSections(context);
    const traceReasonsByMemory = groupTraceReasons(graph);
    const edgesByMemory = groupEdgesByMemory(this.memory.listEdgesForMemoryIds(memoryIds));
    const entityLinks = this.memory.listMemoryEntityLinksForMemoryIds(memoryIds);
    const entitiesById = new Map(
      this.memory.getEntitiesByIds([...new Set(entityLinks.map((link) => link.entityId))]).map((entity) => [
        entity.id,
        entity,
      ]),
    );
    const linksByMemory = groupLinksByMemory(entityLinks);

    const inspectionNodes: MemoryInspectionNode[] = nodes.map((node) => {
      const links = linksByMemory.get(node.memory.id) ?? [];
      return {
        memory: node.memory,
        activation: node.activation,
        depth: node.depth,
        activationReasons: node.reasons,
        contextSections: contextSectionsByMemory.get(node.memory.id) ?? [],
        traceReasons: traceReasonsByMemory.get(node.memory.id) ?? [],
        edges: edgesByMemory.get(node.memory.id) ?? [],
        entities: links.flatMap((link) => {
          const entity = entitiesById.get(link.entityId);
          if (!entity) {
            return [];
          }

          return [
            {
              entity,
              relation: link.relation,
              confidence: link.confidence,
            },
          ];
        }),
      };
    });

    return {
      query: graph.query.rawInput,
      inspectedAt: nowIso(),
      nodes: inspectionNodes,
      summary: summarizeInspection(inspectionNodes),
    };
  }

  renderMarkdown(report: MemoryInspectionReport): string {
    return [
      `# Memory Inspection`,
      "",
      `Query: ${report.query}`,
      `Inspected at: ${report.inspectedAt}`,
      "",
      `Summary: ${report.summary}`,
      "",
      ...report.nodes.flatMap((node, index) => renderNode(node, index + 1)),
    ].join("\n");
  }
}

function groupContextSections(context: CompiledContext | undefined): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  if (!context) {
    return grouped;
  }

  for (const item of context.trace) {
    if (!item.memoryId) {
      continue;
    }
    const sections = grouped.get(item.memoryId) ?? [];
    sections.push(item.section);
    grouped.set(item.memoryId, [...new Set(sections)]);
  }

  return grouped;
}

function groupTraceReasons(graph: ActivatedMemoryGraph): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const trace of graph.activationTrace) {
    const reasons = grouped.get(trace.toMemoryId) ?? [];
    const from = trace.fromMemoryId ? ` from ${shortId(trace.fromMemoryId)}` : "";
    reasons.push(`${trace.reason}${from} amount=${trace.amount.toFixed(2)}`);
    grouped.set(trace.toMemoryId, reasons);
  }
  return grouped;
}

function groupEdgesByMemory<T extends { fromMemoryId: string; toMemoryId: string }>(
  edges: T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const edge of edges) {
    for (const id of [edge.fromMemoryId, edge.toMemoryId]) {
      const existing = grouped.get(id) ?? [];
      existing.push(edge);
      grouped.set(id, existing);
    }
  }
  return grouped;
}

function groupLinksByMemory<T extends { memoryId: string }>(links: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const link of links) {
    const existing = grouped.get(link.memoryId) ?? [];
    existing.push(link);
    grouped.set(link.memoryId, existing);
  }
  return grouped;
}

function summarizeInspection(nodes: MemoryInspectionNode[]): string {
  const withEntities = nodes.filter((node) => node.entities.length > 0).length;
  const withEdges = nodes.filter((node) => node.edges.length > 0).length;
  const contextSections = new Set(nodes.flatMap((node) => node.contextSections));
  return `${nodes.length} memory node(s), ${withEntities} with entity links, ${withEdges} with graph edges, context sections: ${[...contextSections].join(", ") || "none"}.`;
}

function renderNode(node: MemoryInspectionNode, index: number): string[] {
  return [
    `## ${index}. ${node.memory.kind} ${shortId(node.memory.id)}`,
    "",
    `Text: ${node.memory.text}`,
    `Status: ${node.memory.status}; importance=${node.memory.importance}; confidence=${node.memory.confidence.toFixed(2)}; pinned=${node.memory.pinned}`,
    `Activation: ${node.activation?.toFixed(2) ?? "n/a"}; depth=${node.depth ?? "n/a"}`,
    `Activation reasons: ${node.activationReasons.join("; ") || "none"}`,
    `Trace reasons: ${node.traceReasons.join(" | ") || "none"}`,
    `Context sections: ${node.contextSections.join(", ") || "none"}`,
    `Entities: ${renderEntities(node)}`,
    `Edges: ${renderEdges(node)}`,
    "",
  ];
}

function renderEntities(node: MemoryInspectionNode): string {
  if (node.entities.length === 0) {
    return "none";
  }

  return node.entities
    .map((item) => `${item.entity.kind}:${item.entity.name} relation=${item.relation} confidence=${item.confidence.toFixed(2)}`)
    .join("; ");
}

function renderEdges(node: MemoryInspectionNode): string {
  if (node.edges.length === 0) {
    return "none";
  }

  return node.edges
    .map((edge) => `${shortId(edge.fromMemoryId)} -${edge.relation}/${edge.strength.toFixed(2)}-> ${shortId(edge.toMemoryId)}`)
    .join("; ");
}

function shortId(id: string): string {
  return id.slice(0, 12);
}
