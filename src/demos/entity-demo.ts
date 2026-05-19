import { AutonomousRuntime, MemoryStore } from "../index.js";

const memory = new MemoryStore("data/pianpian-entity-demo-vault");
const runtime = new AutonomousRuntime(memory, undefined, {
  useConfiguredLlm: false,
});

await runtime.step(
  "Use Codex with TypeScript in Pianpian. DeepSeek powers memory formation, and ContextCompiler organizes memory.",
);

console.log("[entities]");
for (const entity of memory.listEntities(20)) {
  console.log(`- ${entity.kind}: ${entity.name} aliases=${entity.aliases.join(",")}`);
}

console.log("\n[memory-entity links]");
for (const link of memory.listMemoryEntityLinks(20)) {
  console.log(`- memory=${link.memoryId.slice(0, 12)} entity=${link.entityId.slice(0, 12)} relation=${link.relation}`);
}

memory.close();
