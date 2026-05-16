import { ActionExecutor, ActionGate } from "./index.js";
import type { AgentAction } from "./index.js";

const actions: AgentAction[] = [
  {
    type: "say",
    content: "This low-risk action can be executed immediately.",
  },
  {
    type: "remember",
    content: "Actor execution should record low-risk action results.",
  },
  {
    type: "file-write",
    content: "Write a file after confirmation.",
    metadata: {
      path: "tmp/example.txt",
    },
  },
];

const gate = new ActionGate();
const executor = new ActionExecutor();
const decisions = gate.review(actions);
const results = await executor.executeAllowed(decisions);

console.log("[decisions]");
for (const decision of decisions) {
  console.log(`- ${decision.action.type}: ${decision.status}/${decision.risk}`);
}

console.log("\n[execution results]");
for (const result of results) {
  console.log(`- ${result.action.type}: ${result.status} -> ${result.output}`);
}
