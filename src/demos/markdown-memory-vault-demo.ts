import {
  annotateFormationWithVaultSources,
  ContextCompiler,
  MarkdownMemoryVault,
  MemoryActivationEngine,
  MemoryInspector,
  MemoryStore,
  WorkingMemoryGate,
  writeFormationVaultDocuments,
} from "../index.js";
import type { MemoryFormationPlan } from "../types.js";

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const memory = new MemoryStore(":memory:");
const vault = new MarkdownMemoryVault(`data/memory-vault-demo-${runId}`);

const sourcePath = "places/yangzhou-breakfast.md";
const sourceAnchor = "important-memory-fuchun-breakfast";
const memoryText =
  "User preference: for the Yangzhou trip, prioritize Fuchun Teahouse breakfast and arrive early to avoid the rush.";
const recallInput =
  "For the Yangzhou trip breakfast, should we prioritize Fuchun Teahouse and arrive early?";

const plan: MemoryFormationPlan = {
  nodes: [
    {
      localId: "m1",
      kind: "preference",
      text: memoryText,
      importance: 5,
      confidence: 0.95,
      pinned: true,
      tags: ["vault", "yangzhou", "breakfast", "fuchun"],
    },
  ],
  edges: [],
  entities: [
    {
      localId: "e1",
      kind: "concept",
      name: "Fuchun Teahouse",
      aliases: ["Fuchun", "Yangzhou breakfast"],
      confidence: 0.95,
    },
  ],
  memoryEntityLinks: [
    {
      memoryLocalId: "m1",
      entityLocalId: "e1",
      relation: "about",
      confidence: 0.95,
    },
  ],
  vaultWrites: [
    {
      localId: "v1",
      title: "Yangzhou Breakfast Preference",
      path: sourcePath,
      anchor: sourceAnchor,
      body: [
        "# Yangzhou Breakfast Preference",
        "",
        `<a id="${sourceAnchor}"></a>`,
        "",
        memoryText,
      ].join("\n"),
      memoryLocalIds: ["m1"],
      tags: ["yangzhou", "breakfast", "fuchun"],
      importance: 5,
      kind: "preference",
    },
  ],
  rationale: "Verify Markdown MemoryVault source provenance through write, SQLite graph, recall, and context.",
};

try {
  const annotated = annotateFormationWithVaultSources(plan);
  const applied = memory.applyFormation(annotated);
  await writeFormationVaultDocuments(vault, annotated);

  const vaultEntry = await vault.read(sourcePath);
  const record = applied.nodes[0];

  const graph = new MemoryActivationEngine(memory).recall(recallInput, {
    expandedQueries: [recallInput, "Yangzhou breakfast Fuchun Teahouse arrive early"],
    explicitTopicTerms: ["Yangzhou", "breakfast", "Fuchun"],
    priorityTags: ["vault", "yangzhou", "fuchun"],
    priorityKinds: ["preference"],
    seedLimit: 6,
    maxNodes: 8,
  });
  const workingMemory = new WorkingMemoryGate().select(graph);
  const compiled = new ContextCompiler().compile(graph, undefined, workingMemory);
  const inspected = new MemoryInspector(memory).inspectActivatedGraph(graph, compiled, 8);
  const inspectionMarkdown = new MemoryInspector(memory).renderMarkdown(inspected);
  const activated = [...graph.focusNodes, ...graph.supportNodes].find((node) => node.memory.id === record.id);
  const sourceReference = `${sourcePath}#${sourceAnchor}`;

  printSection("vault write");
  pass(Boolean(vaultEntry), `path=${sourcePath}`);
  pass(Boolean(vaultEntry?.markdown.includes(memoryText)), "contains memory text");
  pass(Boolean(vaultEntry?.markdown.includes(sourceAnchor)), `contains anchor=${sourceAnchor}`);

  printSection("sqlite graph node");
  pass(record.storageKind === "markdown", `storageKind=${record.storageKind}`);
  pass(record.sourcePath === sourcePath, `sourcePath=${record.sourcePath ?? "none"}`);
  pass(record.sourceAnchor === sourceAnchor, `sourceAnchor=${record.sourceAnchor ?? "none"}`);

  printSection("recall");
  pass(Boolean(activated), `activated memory=${record.id} activation=${activated?.activation.toFixed(2) ?? "n/a"}`);
  pass(
    Boolean(activated?.reasons.some((reason) => reason.includes("seed") || reason.includes("topic"))),
    `reason=${activated?.reasons.join("; ") ?? "none"}`,
  );

  printSection("compiled context");
  pass(compiled.prompt.includes(memoryText), "context includes memory text");
  pass(compiled.prompt.includes(sourceReference), `context includes source ${sourceReference}`);

  printSection("inspection");
  pass(inspectionMarkdown.includes(sourceReference), "markdown report includes source path");
} finally {
  memory.close();
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
