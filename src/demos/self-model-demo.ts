import { AutonomousRuntime, MemoryStore } from "../index.js";

const memory = new MemoryStore("data/pianpian-self-model-demo.sqlite");
const runtime = new AutonomousRuntime(memory, undefined, {
  useConfiguredLlm: false,
});

const first = await runtime.step("Initialize self-awareness for the autonomous memory agent.");
const second = await runtime.step("What should the agent remember about itself?");

console.log("[first cycle self model]");
console.log(first.compiledContext.selfModel);

console.log("\n[second cycle self model]");
console.log(second.compiledContext.selfModel);

console.log("\n[self-model memories]");
for (const memoryRecord of memory.list(20).filter((item) => item.kind === "self_model")) {
  console.log(
    `- pinned=${memoryRecord.pinned} confidence=${memoryRecord.confidence.toFixed(2)} ${memoryRecord.text}`,
  );
}

memory.close();
