import { ActionExecutor, ActionGate } from "./index.js";
import type { AgentAction } from "./index.js";

const actions: AgentAction[] = [
  {
    type: "tool",
    content: "Read memory stats.",
    metadata: {
      toolName: "memory.stats",
    },
  },
  {
    type: "tool",
    content: "Read project status.",
    metadata: {
      toolName: "project.status",
    },
  },
  {
    type: "tool",
    content: "Attempt unregistered tool.",
    metadata: {
      toolName: "network.post",
    },
  },
];

const gate = new ActionGate();
const executor = new ActionExecutor();
const decisions = gate.review(actions);
const results = await executor.executeAllowed(decisions, {
  memory: {
    total: 12,
    active: 10,
    archived: 2,
    pinned: 4,
  },
  project: {
    cwd: "D:\\pianpian",
  },
});

console.log("[tool decisions]");
for (const decision of decisions) {
  console.log(`- ${decision.action.metadata?.toolName}: ${decision.status}/${decision.risk}`);
}

console.log("\n[tool results]");
for (const result of results) {
  console.log(`- ${result.action.metadata?.toolName}: ${result.status} -> ${result.output}`);
}
