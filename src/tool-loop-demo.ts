import { AutonomousRuntime, MemoryStore } from "./index.js";

const memory = new MemoryStore(":memory:");
const runtime = new AutonomousRuntime(memory, undefined, {
  useConfiguredLlm: false,
});

const first = await runtime.step("检查一下当前项目状态和记忆统计。");

console.log("[cycle 1 actions]");
for (const action of first.actions) {
  const toolName = typeof action.metadata?.toolName === "string" ? ` ${action.metadata.toolName}` : "";
  console.log(`- ${action.type}${toolName}: ${action.content}`);
}

console.log("\n[cycle 1 policy decisions]");
for (const decision of first.policyDecisions) {
  const toolName =
    typeof decision.action.metadata?.toolName === "string" ? ` ${decision.action.metadata.toolName}` : "";
  console.log(`- ${decision.action.type}${toolName}: ${decision.status}/${decision.risk} -> ${decision.reason}`);
}

console.log("\n[cycle 1 execution results]");
for (const result of first.executionResults) {
  const toolName = typeof result.action.metadata?.toolName === "string" ? ` ${result.action.metadata.toolName}` : "";
  console.log(`- ${result.action.type}${toolName}: ${result.status} -> ${result.output}`);
}

const second = await runtime.step("What were the latest tool execution results for memory.stats and project.status?");

console.log("\n[cycle 2 response]");
for (const result of second.executionResults) {
  if (result.status === "executed" && result.action.type === "say") {
    console.log(result.output);
  }
}

console.log("\n[cycle 2 focus memory]");
for (const node of second.activatedMemory.focusNodes) {
  console.log(
    `- ${node.memory.kind} activation=${node.activation.toFixed(2)} depth=${node.depth}: ${node.memory.text}`,
  );
}

console.log("\n[memories]");
for (const record of memory.list(10)) {
  console.log(`- ${record.kind}(${record.importance}): ${record.text}`);
}

memory.close();
