import { AutonomousRuntime, MemoryStore } from "./index.js";

const memory = new MemoryStore(":memory:");
const runtime = new AutonomousRuntime(memory, undefined, {
  useConfiguredLlm: false,
});

await runtime.step("检查一下当前项目状态和记忆统计。");

console.log("[before correction]");
for (const record of memory.listActive(20).filter((record) => record.text.includes("Latest memory stats"))) {
  console.log(`- ${record.status} pinned=${record.pinned} ${record.kind}: ${record.text}`);
}

const correction = await runtime.step("Latest memory stats 这条记忆不对，不要再记这个。");

console.log("\n[correction proposals]");
for (const proposal of correction.proposals) {
  if (proposal.memoryCorrection) {
    console.log(
      `- ${proposal.agentId}: ${proposal.memoryCorrection.operation} targets=${proposal.memoryCorrection.targetMemoryIds.length}`,
    );
  }
}

console.log("\n[after correction]");
for (const record of memory.list(30).filter((record) => record.kind === "semantic" && record.text.includes("Latest memory stats"))) {
  console.log(`- ${record.status} pinned=${record.pinned} ${record.kind}: ${record.text}`);
}

console.log("\n[correction notes]");
for (const record of memory.list(30).filter((record) => record.tags.includes("memory-correction"))) {
  console.log(`- ${record.kind}: ${record.text}`);
}

const recall = await runtime.step("What do we remember about Latest memory stats?");

console.log("\n[recall after correction]");
for (const node of recall.activatedMemory.focusNodes) {
  console.log(`- ${node.memory.status} ${node.memory.kind}: ${node.memory.text}`);
}

memory.close();
