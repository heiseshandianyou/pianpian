import {
  annotateFormationWithVaultSources,
  MarkdownMemoryVault,
  MemoryStore,
  syncVaultMemoryFrontmatter,
  writeFormationVaultDocuments,
} from "../index.js";
import type { MemoryFormationPlan } from "../types.js";

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const memory = new MemoryStore(":memory:");
const vault = new MarkdownMemoryVault(`data/vault-correction-sync-demo-${runId}`);
const sourcePath = "preferences/tea.md";
const sourceAnchor = "memory-tea";

const plan: MemoryFormationPlan = {
  nodes: [
    {
      localId: "tea",
      kind: "preference",
      text: "User preference: offer tea before coffee during late-night work.",
      importance: 4,
      confidence: 0.9,
      pinned: true,
      tags: ["preference", "tea"],
    },
  ],
  edges: [],
  vaultWrites: [
    {
      localId: "vault-tea",
      title: "Tea Before Coffee",
      path: sourcePath,
      anchor: sourceAnchor,
      body: [
        "# Tea Before Coffee",
        "",
        `<a id="${sourceAnchor}"></a>`,
        "",
        "User preference: offer tea before coffee during late-night work.",
      ].join("\n"),
      memoryLocalIds: ["tea"],
      tags: ["preference", "tea"],
      importance: 4,
      kind: "preference",
    },
  ],
  rationale: "Demo: sync Markdown frontmatter after memory correction.",
};

try {
  const annotated = annotateFormationWithVaultSources(plan);
  const applied = memory.applyFormation(annotated);
  const localToMemory = new Map(annotated.nodes.map((node, index) => [node.localId, applied.nodes[index]] as const));
  await writeFormationVaultDocuments(vault, annotated, localToMemory);

  const record = applied.nodes[0];
  const correction = memory.applyCorrectionDetailed({
    operation: "archive",
    targetMemoryIds: [record.id],
    reason: "Demo correction archives a markdown-backed memory.",
  });
  await syncVaultMemoryFrontmatter(vault, correction.memories);

  const entry = await vault.read(sourcePath);
  const markdown = entry?.markdown ?? "";

  printSection("correction sync");
  pass(correction.report.changed === 1, `changed=${correction.report.changed}`);
  pass(markdown.includes("memory_status: \"archived\""), "frontmatter document status archived");
  pass(markdown.includes(`\"${record.id}\":`), "frontmatter contains real memory id");
  pass(markdown.includes("status\":\"archived\""), "per-memory state archived");
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
