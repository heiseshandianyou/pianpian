import {
  buildMemoryFormationPlanFromVaultPath,
  MarkdownMemoryVault,
  suggestMemoryImportsFromVaultPath,
} from "../vault/index.js";

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const vault = new MarkdownMemoryVault(`data/vault-import-demo-${runId}`);
const sourcePath = "people/user-preference.md";
const sourceAnchor = "memory-user-tea";
const memoryText = "User preference: when discussing late-night work, suggest warm tea before stronger caffeine.";

await vault.write({
  path: sourcePath,
  title: "Late Night Tea Preference",
  body: [
    "# Late Night Tea Preference",
    "",
    `<a id="${sourceAnchor}"></a>`,
    "",
    memoryText,
  ].join("\n"),
  overwrite: true,
  frontmatter: {
    memory_local_ids: ["tea-preference"],
    source_path: sourcePath,
    source_anchor: sourceAnchor,
    kind: "preference",
    importance: 4,
    tags: ["user", "preference", "tea"],
  },
});

const suggestions = await suggestMemoryImportsFromVaultPath(vault, sourcePath);
const plan = await buildMemoryFormationPlanFromVaultPath(vault, sourcePath, {
  rationale: "Demo: rebuild MemoryFormationPlan from Markdown vault metadata.",
});

printSection("import suggestions");
for (const suggestion of suggestions) {
  console.log(
    [
      `${suggestion.localId}`,
      `${suggestion.kind}(${suggestion.importance})`,
      `${suggestion.path}#${suggestion.anchor ?? ""}`,
      suggestion.tags.join(","),
    ].join(" | "),
  );
  console.log(suggestion.text);
}

printSection("formation plan");
console.log(JSON.stringify(plan, null, 2));

printSection("path safety");
try {
  await suggestMemoryImportsFromVaultPath(vault, "../outside.md");
  console.log("FAIL unsafe path was accepted");
  process.exitCode = 1;
} catch (error) {
  console.log(`PASS unsafe path rejected: ${(error as Error).message}`);
}

function printSection(name: string): void {
  console.log(`\n[${name}]`);
}
