import { ActiveAgentHost, AutonomousRuntime, MemoryStore } from "./index.js";

const memory = new MemoryStore("data/pianpian-maintenance-demo.sqlite");
const runtime = new AutonomousRuntime(memory);
const host = new ActiveAgentHost(runtime, memory, {
  heartbeatMs: 1_000,
  consolidationEveryCycles: 1,
  forgettingEveryCycles: 0,
});

memory.add({
  kind: "semantic",
  text: "The agent should maintain memory quality while idle.",
  importance: 4,
  confidence: 0.9,
  tags: ["maintenance", "autonomy"],
});
memory.add({
  kind: "semantic",
  text: "The agent should maintain memory quality while idle.",
  importance: 4,
  confidence: 0.95,
  tags: ["maintenance", "autonomy"],
});

const result = await host.heartbeat();

console.log("[heartbeat]");
console.log(`drive=${result.drive.id}`);
console.log(`action=${result.cycle.actions.map((action) => action.content).join(" ")}`);

console.log("\n[maintenance]");
console.log(JSON.stringify(result.maintenance, null, 2));

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
