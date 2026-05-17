import { MemoryConsolidationEngine, MemoryStore } from "../index.js";

const memory = new MemoryStore("data/pianpian-llm-consolidation-demo.sqlite");
const engine = new MemoryConsolidationEngine(memory, {
  relatedClusterMinSize: 3,
  relatedClusterLimit: 1,
});

memory.add({
  kind: "episode",
  text: "The user said memory should be a high-dimensional network.",
  importance: 3,
  confidence: 0.95,
  tags: ["memory", "graph", "activation"],
});
memory.add({
  kind: "episode",
  text: "The user emphasized that memory is not a library of independent categories.",
  importance: 3,
  confidence: 0.95,
  tags: ["memory", "graph"],
});
memory.add({
  kind: "semantic",
  text: "Memory recall should activate related nodes through graph edges.",
  importance: 4,
  confidence: 0.9,
  tags: ["memory", "graph", "activation"],
});
memory.add({
  kind: "goal",
  text: "Build a tool registry for safe read-only local tools.",
  importance: 4,
  confidence: 0.9,
  tags: ["tools"],
});

const report = await engine.consolidateRelatedMemories();

console.log("[related consolidation report]");
console.log(JSON.stringify(report, null, 2));

console.log("\n[memories]");
for (const memoryRecord of memory.list(20)) {
  console.log(`- ${memoryRecord.status} ${memoryRecord.kind}: ${memoryRecord.text}`);
}

console.log("\n[edges]");
for (const edge of memory.listEdges(20)) {
  console.log(
    `- ${edge.relation} ${edge.fromMemoryId.slice(0, 12)} -> ${edge.toMemoryId.slice(0, 12)} strength=${edge.strength.toFixed(2)}`,
  );
}

memory.close();
