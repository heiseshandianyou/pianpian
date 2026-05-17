import { ActiveAgentHost, AutonomousRuntime, MemoryStore } from "../index.js";

const memory = new MemoryStore("data/pianpian-active-demo.sqlite");
const runtime = new AutonomousRuntime(memory);
const host = new ActiveAgentHost(runtime, memory, {
  heartbeatMs: 1_000,
  consolidationEveryCycles: 2,
  forgettingEveryCycles: 3,
  forgettingPolicy: {
    archiveBelowScore: 0.5,
    halfLifeDays: 1,
    minAgeDays: 0,
    preserveKinds: ["goal", "preference", "self_model"],
  },
});

await runtime.step(
  "The agent should stay active without a user task, generate internal memories, and maintain its memory network.",
);

for (let i = 0; i < 3; i += 1) {
  const result = await host.heartbeat();
  const actionText = result.cycle.actions.map((action) => action.content).join(" ");
  console.log(`[heartbeat ${i + 1}] drive=${result.drive.id} ${actionText}`);
  if (result.consolidation) {
    console.log(`[consolidation] ${JSON.stringify(result.consolidation)}`);
  }
  if (result.forgetting) {
    console.log(`[forgetting] ${JSON.stringify(result.forgetting)}`);
  }
}

console.log("\n[memories]");
for (const memoryRecord of memory.list(20)) {
  console.log(
    `- ${memoryRecord.status} ${memoryRecord.kind}(${memoryRecord.importance}): ${memoryRecord.text}`,
  );
}

console.log("\n[edges]");
for (const edge of memory.listEdges(20)) {
  console.log(
    `- ${edge.relation} ${edge.fromMemoryId.slice(0, 12)} -> ${edge.toMemoryId.slice(0, 12)} strength=${edge.strength.toFixed(2)}`,
  );
}

memory.close();
