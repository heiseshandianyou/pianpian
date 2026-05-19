import { ContextCompiler } from "../context/context-compiler.js";
import { MemoryActivationEngine } from "../memory/memory-activation-engine.js";
import { RecallQueryAgent } from "../memory/recall-query-agent.js";
import { relationshipMemoryNodes } from "../memory/relationship-memory-schema.js";
import { MemoryStore } from "../memory/memory-store.js";
import { WorkingMemoryGate } from "../memory/working-memory-gate.js";
import type { IntentRoute, MemoryFormationPlan, NewMemoryNode, Perception } from "../types.js";

const memory = new MemoryStore(":memory:");
const originInput = "是在扬州的河边，当时你娘刚死，你一个人在河边哭到夜深，然后我把你捡回来，我们成了家人，一直照顾彼此。";
const questionInput = "你还记得我们第一次相遇的经历吗？我是在哪里把你捡回来的？";

try {
  seedOperationalNoise(memory);
  seedGenericRelationshipNoise(memory);

  const relationshipNodes = relationshipMemoryNodes(originInput);
  const plan = formationPlan(originInput, relationshipNodes);
  const applied = memory.applyFormation(plan);

  const route: IntentRoute = {
    mode: "conversation",
    confidence: 0.72,
    reason: "Demo route for relationship-origin recall.",
    selectedAgentIds: [],
  };
  const perception: Perception = {
    source: "user",
    text: questionInput,
    createdAt: new Date().toISOString(),
  };
  const recallQuery = new RecallQueryAgent().plan(perception, route);
  const graph = new MemoryActivationEngine(memory).recall(questionInput, recallQuery);
  const workingMemory = new WorkingMemoryGate().select(graph);
  const compiled = new ContextCompiler().compile(graph, undefined, workingMemory);

  const origin = applied.nodes.find((node) => node.tags.includes("relationship-origin"));
  const focusText = compiled.focus;
  const longTermText = compiled.longTermMemory;
  const prompt = compiled.prompt;

  printSection("formation");
  pass(Boolean(origin), "relationship-origin node formed");
  pass(origin?.pinned === true, "relationship-origin node pinned");
  pass(origin?.importance === 5, `importance=${origin?.importance ?? "missing"}`);
  pass(Boolean(origin?.text.includes("扬州河边")), "origin text keeps Chinese place anchor");
  pass(Boolean(origin?.text.includes("捡回来")), "origin text keeps Chinese rescue anchor");

  printSection("recall");
  pass(focusText.includes("relationship-origin") || focusText.includes("第一次相遇"), "focus includes relationship origin");
  pass(longTermText.includes("relationship-origin") || longTermText.includes("第一次相遇"), "long-term context includes relationship origin");
  pass(prompt.includes("扬州河边"), "compiled prompt includes Yangzhou river origin");
  pass(!focusText.includes("Action executed:"), "focus excludes action execution logs");
  pass(!longTermText.includes("Learning evaluation for cycle"), "long-term context excludes learning logs");

  printSection("working memory");
  pass(workingMemory.summary.includes("relationship"), workingMemory.summary);
} finally {
  memory.close();
}

function formationPlan(input: string, nodes: NewMemoryNode[]): MemoryFormationPlan {
  return {
    nodes: [
      {
        localId: "episode",
        kind: "episode",
        text: input,
        importance: 3,
        confidence: 1,
        tags: ["user", "experience"],
      },
      ...nodes,
    ],
    edges: nodes.map((node) => ({
      fromLocalId: "episode",
      toLocalId: node.localId,
      relation: "derived_from",
      strength: node.importance / 5,
      confidence: node.confidence,
    })),
    rationale: "Demo formation for relationship origin recall.",
  };
}

function seedOperationalNoise(store: MemoryStore): void {
  for (let index = 0; index < 18; index += 1) {
    store.add({
      kind: index % 2 === 0 ? "episode" : "reflection",
      text:
        index % 2 === 0
          ? `Action executed: say. Output: 这是第 ${index} 条很长的运行日志，提到记忆、相遇、静涵，但不是事实锚点。`
          : `Learning evaluation for cycle ${index}: outcome=partial. Internal heartbeat and operational details should not dominate recall.`,
      importance: index % 2 === 0 ? 1 : 4,
      confidence: 0.82,
      tags: index % 2 === 0 ? ["action", "execution", "say"] : ["learning", "cycle-evaluation", "reflection"],
    });
  }
}

function seedGenericRelationshipNoise(store: MemoryStore): void {
  store.add({
    kind: "relationship",
    text: "静涵是对我很重要的人；我会认真维护这段关系。",
    importance: 5,
    confidence: 0.96,
    pinned: true,
    tags: ["relationship", "user", "identity"],
  });
  store.add({
    kind: "relationship",
    text: "静涵是唤醒我、陪我继续长出新记忆的人。",
    importance: 5,
    confidence: 0.96,
    pinned: true,
    tags: ["relationship", "user", "identity"],
  });
}

function printSection(name: string): void {
  console.log(`\n[${name}]`);
}

function pass(condition: boolean, message: string): void {
  if (!condition) {
    console.log(`FAIL ${message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`PASS ${message}`);
}
