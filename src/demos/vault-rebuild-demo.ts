import { MemoryActivationEngine } from "../memory/memory-activation-engine.js";
import { MemoryStore } from "../memory/memory-store.js";
import {
  MarkdownMemoryVault,
  rebuildMarkdownVaultIndex,
} from "../vault/index.js";

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const vault = new MarkdownMemoryVault(`data/vault-rebuild-demo-${runId}`);
const memory = new MemoryStore(":memory:");

const sourcePath = "people/rebuild-tea-preference.md";
const sourceAnchor = "memory-rebuild-tea-preference";
const memoryText = "User preference: during late-night rebuild work, suggest warm tea before stronger caffeine.";
const recallInput = "What should we suggest during late-night rebuild work?";

try {
  await vault.write({
    path: sourcePath,
    title: "Rebuild Tea Preference",
    body: [
      "# Rebuild Tea Preference",
      "",
      `<a id="${sourceAnchor}"></a>`,
      "",
      memoryText,
    ].join("\n"),
    overwrite: true,
    frontmatter: {
      memory_local_ids: ["rebuild-tea-preference"],
      source_path: sourcePath,
      source_anchor: sourceAnchor,
      kind: "preference",
      importance: 4,
      confidence: 0.92,
      tags: ["demo", "rebuild", "tea", "preference"],
    },
  });

  const rebuild = await rebuildMarkdownVaultIndex(vault, memory, {
    rationale: "Demo: rebuild an empty SQLite MemoryStore from Markdown vault files.",
  });
  const dryRunSecondRebuild = await rebuildMarkdownVaultIndex(vault, memory, {
    dryRun: true,
    rationale: "Demo: preview a second rebuild without duplicating Markdown memories.",
  });
  const secondRebuild = await rebuildMarkdownVaultIndex(vault, memory, {
    rationale: "Demo: verify a second rebuild skips already-imported Markdown memories.",
  });
  const retrieved = memory.retrieve("late-night rebuild warm tea caffeine", 5);
  const graph = new MemoryActivationEngine(memory).recall(recallInput, {
    expandedQueries: [recallInput, "late-night rebuild warm tea caffeine"],
    explicitTopicTerms: ["late-night", "rebuild", "tea", "caffeine"],
    priorityTags: ["rebuild", "tea", "preference"],
    priorityKinds: ["preference"],
    seedLimit: 5,
    maxNodes: 6,
  });
  const recalled = [...graph.focusNodes, ...graph.supportNodes].find((node) => node.memory.text === memoryText);

  printSection("rebuild");
  pass(rebuild.scanned === 1, `scanned=${rebuild.scanned}`);
  pass(rebuild.imported === 1, `imported=${rebuild.imported}`);
  pass(rebuild.skipped === 0, `skipped=${rebuild.skipped}`);
  pass(rebuild.errors.length === 0, `errors=${rebuild.errors.length}`);

  printSection("second rebuild");
  pass(dryRunSecondRebuild.scanned === 1, `dry-run scanned=${dryRunSecondRebuild.scanned}`);
  pass(dryRunSecondRebuild.imported === 0, `dry-run imported=${dryRunSecondRebuild.imported}`);
  pass(dryRunSecondRebuild.skipped === 1, `dry-run skipped=${dryRunSecondRebuild.skipped}`);
  pass(secondRebuild.imported === 0, `imported=${secondRebuild.imported}`);
  pass(secondRebuild.skipped === 1, `skipped=${secondRebuild.skipped}`);
  pass(secondRebuild.errors.length === 0, `errors=${secondRebuild.errors.length}`);

  printSection("retrieve");
  pass(retrieved.some((record) => record.text === memoryText), "retrieve finds rebuilt Markdown memory");
  pass(retrieved.filter((record) => record.text === memoryText).length === 1, "retrieve has one rebuilt Markdown memory");
  pass(retrieved[0]?.sourcePath === sourcePath, `sourcePath=${retrieved[0]?.sourcePath ?? "none"}`);

  printSection("recall");
  pass(Boolean(recalled), `recall activates rebuilt memory=${recalled?.memory.id ?? "none"}`);
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
