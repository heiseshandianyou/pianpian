import { AutonomousRuntime, MemoryStore } from "./index.js";

const memory = new MemoryStore(":memory:");
const runtime = new AutonomousRuntime(memory, undefined, {
  useConfiguredLlm: false,
});

const inputs = [
  "你好，简单聊聊当前系统。",
  "检查一下当前项目状态和记忆统计。",
  "Why did you remember memory.stats and project.status?",
  "Latest memory stats 这条记忆不对，不要再记这个。",
  "结合当前的进度 启动下一阶段",
];

for (const input of inputs) {
  const result = await runtime.step(input);
  console.log(`\n[input] ${input}`);
  console.log(`[route] ${result.route.mode} confidence=${result.route.confidence.toFixed(2)}`);
  console.log(`[reason] ${result.route.reason}`);
  console.log(`[agents] ${result.route.selectedAgentIds.join(", ")}`);
  console.log(`[proposals] ${result.proposals.map((proposal) => `${proposal.agentId}:${proposal.intent}`).join(", ")}`);
  console.log(`[actions] ${result.actions.map((action) => action.type).join(", ") || "none"}`);
}

memory.close();
