import { ActionGate } from "../index.js";
import type { AgentAction } from "../index.js";

const gate = new ActionGate();
const actions: AgentAction[] = [
  {
    type: "say",
    content: "Summarize the current memory state.",
  },
  {
    type: "file-write",
    content: "Write a new project file.",
    metadata: {
      path: "src/example.ts",
    },
  },
  {
    type: "external-message",
    content: "Send a message to someone outside the local runtime.",
  },
  {
    type: "delete-data",
    content: "Delete old memory records.",
  },
];

const decisions = gate.review(actions);
const visible = gate.toUserVisibleActions(decisions);

console.log("[policy decisions]");
for (const decision of decisions) {
  console.log(
    `- ${decision.action.type}: risk=${decision.risk} status=${decision.status} reason=${decision.reason}`,
  );
}

console.log("\n[user-visible actions]");
for (const action of visible) {
  console.log(`- ${action.type}: ${action.content}`);
}
