import { AutonomousRuntime, MemoryStore } from "../index.js";

const memory = new MemoryStore(":memory:");
const runtime = new AutonomousRuntime(memory, undefined, {
  useConfiguredLlm: false,
});

await runtime.step("检查一下当前项目状态和记忆统计。");
const result = await runtime.step("Why did you remember memory.stats and project.status?");

console.log("[actions]");
for (const action of result.actions) {
  const toolName = typeof action.metadata?.toolName === "string" ? ` ${action.metadata.toolName}` : "";
  console.log(`- ${action.type}${toolName}: ${action.content}`);
}

console.log("\n[policy]");
for (const decision of result.policyDecisions) {
  const toolName =
    typeof decision.action.metadata?.toolName === "string" ? ` ${decision.action.metadata.toolName}` : "";
  console.log(`- ${decision.action.type}${toolName}: ${decision.status}/${decision.risk}`);
}

console.log("\n[memory.inspect output]");
for (const execution of result.executionResults) {
  if (execution.action.type === "tool" && execution.action.metadata?.toolName === "memory.inspect") {
    console.log(execution.output);
  }
}

memory.close();
