import { AutonomousRuntime, MemoryInspector, MemoryStore } from "./index.js";

const memory = new MemoryStore(":memory:");
const runtime = new AutonomousRuntime(memory, undefined, {
  useConfiguredLlm: false,
});
const inspector = new MemoryInspector(memory);

await runtime.step("检查一下当前项目状态和记忆统计。");
const recall = await runtime.step("What were the latest tool execution results for memory.stats and project.status?");

const report = inspector.inspectActivatedGraph(recall.activatedMemory, recall.compiledContext, 6);

console.log(inspector.renderMarkdown(report));

memory.close();
