import { mkdirSync } from "node:fs";
import { MemoryConsolidationEngine, MemoryStore } from "../index.js";

mkdirSync("data", { recursive: true });

const memory = new MemoryStore("data/pianpian-consolidation-demo-vault");
const engine = new MemoryConsolidationEngine(memory);

memory.add({
  kind: "semantic",
  text: "Memory should behave like a high-dimensional activation network, not like independent library categories.",
  importance: 5,
  confidence: 0.9,
  tags: ["memory", "graph"],
});
memory.add({
  kind: "semantic",
  text: "Memory should behave like a high-dimensional activation network, not like independent library categories.",
  importance: 5,
  confidence: 0.95,
  tags: ["memory", "graph"],
});
memory.add({
  kind: "goal",
  text: "Build a ContextCompiler that turns activated memory into usable agent context.",
  importance: 5,
  confidence: 0.9,
  tags: ["context", "compiler"],
});

const report = engine.consolidateExactDuplicates();

console.log("[consolidation report]");
console.log(JSON.stringify(report, null, 2));

console.log("\n[memories]");
for (const memoryRecord of memory.list(10)) {
  console.log(`- ${memoryRecord.status} ${memoryRecord.kind}: ${memoryRecord.text}`);
}

console.log("\n[edges]");
for (const edge of memory.listEdges(10)) {
  console.log(
    `- ${edge.relation} ${edge.fromMemoryId.slice(0, 12)} -> ${edge.toMemoryId.slice(0, 12)} strength=${edge.strength.toFixed(2)}`,
  );
}

memory.close();
