import type { EntityKind, MemoryFormationPlan, NewEntity, NewMemoryEntityLink } from "../types.js";

export class EntityExtractionAgent {
  extract(plan: MemoryFormationPlan): Pick<MemoryFormationPlan, "entities" | "memoryEntityLinks"> {
    const entities = new Map<string, NewEntity>();
    const links: NewMemoryEntityLink[] = [];

    for (const node of plan.nodes) {
      const extracted = extractEntities(node.text);
      for (const entity of extracted) {
        entities.set(entity.localId, entity);
        links.push({
          memoryLocalId: node.localId,
          entityLocalId: entity.localId,
          relation: inferMemoryEntityRelation(entity.kind),
          confidence: entity.confidence ?? 0.8,
        });
      }
    }

    return {
      entities: [...entities.values()],
      memoryEntityLinks: links,
    };
  }
}

function extractEntities(text: string): NewEntity[] {
  const entities: NewEntity[] = [];
  const normalizedText = text.toLowerCase();
  const patterns: Array<{ kind: EntityKind; name: string; aliases?: string[]; terms: string[] }> = [
    { kind: "user", name: "User", terms: ["user", "the user"] },
    { kind: "project", name: "Pianpian", aliases: ["pianpian"], terms: ["Pianpian", "autonomous agent project"] },
    { kind: "tool", name: "Codex", aliases: ["codex.run"], terms: ["Codex", "codex.run"] },
    { kind: "tool", name: "memory.stats", terms: ["memory.stats", "Memory stats"] },
    { kind: "tool", name: "project.status", terms: ["project.status", "Project status"] },
    { kind: "tool", name: "Tool Registry", terms: ["ToolRegistry", "tool registry"] },
    { kind: "model", name: "DeepSeek", aliases: ["deepseek-v4-pro"], terms: ["DeepSeek", "deepseek"] },
    { kind: "model", name: "TypeScript", aliases: ["typescript"], terms: ["TypeScript", "typescript"] },
    { kind: "concept", name: "Memory Graph", terms: ["memory graph", "graph memory", "high-dimensional activation network"] },
    { kind: "concept", name: "Context Compiler", terms: ["ContextCompiler", "compiled context", "context compiler"] },
    { kind: "concept", name: "Policy Gate", terms: ["PolicyAgent", "policy gate", "ActionGate"] },
    { kind: "agent", name: "SelfModelAgent", terms: ["SelfModelAgent", "self-model"] },
    { kind: "agent", name: "MemoryConsolidationAgent", terms: ["MemoryConsolidationAgent", "consolidation agent"] },
  ];

  for (const pattern of patterns) {
    if (pattern.terms.some((term) => normalizedText.includes(term.toLowerCase()))) {
      entities.push({
        localId: entityLocalId(pattern.kind, pattern.name),
        kind: pattern.kind,
        name: pattern.name,
        aliases: pattern.aliases,
        confidence: 0.85,
      });
    }
  }

  for (const file of text.match(/[A-Za-z0-9_-]+\.(ts|tsx|js|json|md)/g) ?? []) {
    entities.push({
      localId: entityLocalId("file", file),
      kind: "file",
      name: file,
      confidence: 0.9,
    });
  }

  return entities;
}

function inferMemoryEntityRelation(kind: EntityKind): NewMemoryEntityLink["relation"] {
  if (kind === "tool" || kind === "model") {
    return "uses";
  }
  if (kind === "project" || kind === "concept" || kind === "goal") {
    return "about";
  }
  return "mentions";
}

function entityLocalId(kind: EntityKind, name: string): string {
  return `entity_${kind}_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}
