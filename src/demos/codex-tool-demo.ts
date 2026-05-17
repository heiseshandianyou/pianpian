import { ActionExecutor, ActionGate } from "../index.js";
import type { AgentAction } from "../index.js";

const actions: AgentAction[] = [
  {
    type: "tool",
    content: "Try Codex without confirmation.",
    metadata: {
      toolName: "codex.run",
      input: {
        prompt: "Inspect package.json and summarize the project in one sentence. Do not edit files.",
        sandbox: "read-only",
      },
    },
  },
  {
    type: "tool",
    content: "Run confirmed Codex read-only inspection.",
    metadata: {
      toolName: "codex.run",
      confirmed: true,
      input: {
        prompt: "Inspect package.json and summarize the project in one sentence. Do not edit files.",
        sandbox: "read-only",
      },
    },
  },
];

const gate = new ActionGate();
const executor = new ActionExecutor();
const decisions = gate.review(actions);
const results = await executor.executeAllowed(decisions, {
  project: {
    cwd: "D:\\pianpian",
  },
});

console.log("[codex tool decisions]");
for (const decision of decisions) {
  console.log(`- confirmed=${decision.action.metadata?.confirmed === true}: ${decision.status}/${decision.risk}`);
}

console.log("\n[codex tool results]");
for (const result of results) {
  console.log(`- ${result.status}: ${result.output.slice(0, 1200)}`);
  if (result.error) {
    console.log(`  error: ${result.error.slice(0, 1200)}`);
  }
}
