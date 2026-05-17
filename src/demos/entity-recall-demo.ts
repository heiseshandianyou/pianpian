import { AutonomousRuntime, MemoryStore } from "../index.js";

const memory = new MemoryStore(":memory:");
const runtime = new AutonomousRuntime(memory, undefined, {
  useConfiguredLlm: false,
});

await runtime.step(
  "Use Codex with TypeScript in Pianpian. DeepSeek powers memory formation, and ContextCompiler organizes memory.",
);

const result = await runtime.step("Codex 那个能力现在怎么样？");

console.log("[response]");
for (const execution of result.executionResults) {
  if (execution.status === "executed" && execution.action.type === "say") {
    console.log(execution.output);
  }
}

console.log("[relevant entities]");
for (const entityNode of result.activatedMemory.entityNodes) {
  console.log(
    `- ${entityNode.entity.kind}:${entityNode.entity.name} activation=${entityNode.activation.toFixed(2)} linkedMemories=${entityNode.linkedMemoryIds.length}`,
  );
}

console.log("\n[focus memory]");
for (const node of result.activatedMemory.focusNodes) {
  console.log(
    `- ${node.memory.kind} activation=${node.activation.toFixed(2)} depth=${node.depth}: ${node.memory.text}`,
  );
}

console.log("\n[activation trace]");
for (const trace of result.activatedMemory.activationTrace.slice(0, 10)) {
  console.log(`- ${trace.reason} amount=${trace.amount.toFixed(2)}`);
}

console.log("\n[compiled context]");
console.log(result.compiledContext.prompt);

memory.close();
