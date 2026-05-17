import { mkdirSync } from "node:fs";
import { AutonomousRuntime, MemoryStore } from "../index.js";

mkdirSync("data", { recursive: true });

const memory = new MemoryStore();
const runtime = new AutonomousRuntime(memory);

runtime.onEvent((event) => {
  if (event.type === "cycle.completed") {
    console.log("[event]", JSON.stringify(event.payload, null, 2));
  }
});

const input =
  process.argv.slice(2).join(" ") ||
  "I want to design an autonomous TypeScript multi-agent system with long-term memory.";

const result = await runtime.step(input);

console.log("\n[action]");
for (const action of result.actions) {
  console.log(`${action.type}: ${action.content}`);
}

console.log("\n[activated memory]");
for (const node of result.activatedMemory.focusNodes) {
  console.log(
    `- ${node.memory.kind} activation=${node.activation.toFixed(2)} depth=${node.depth}: ${node.memory.text}`,
  );
}

console.log("\n[activation trace]");
for (const trace of result.activatedMemory.activationTrace.slice(0, 8)) {
  console.log(`- ${trace.reason} amount=${trace.amount.toFixed(2)}`);
}

console.log("\n[compiled context]");
console.log(result.compiledContext.prompt);

console.log("\n[context trace]");
for (const trace of result.compiledContext.trace.slice(0, 8)) {
  console.log(
    `- ${trace.section}: ${trace.memoryId?.slice(0, 12) ?? "none"} activation=${trace.activation?.toFixed(2) ?? "n/a"}`,
  );
}

console.log("\n[memories]");
for (const memoryRecord of memory.list(12)) {
  console.log(`- ${memoryRecord.kind}(${memoryRecord.importance}): ${memoryRecord.text}`);
}

console.log("\n[edges]");
for (const edge of memory.listEdges(12)) {
  console.log(
    `- ${edge.relation} ${edge.fromMemoryId.slice(0, 12)} -> ${edge.toMemoryId.slice(0, 12)} strength=${edge.strength.toFixed(2)}`,
  );
}

memory.close();
