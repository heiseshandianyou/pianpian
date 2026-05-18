import {
  parseMarkdown,
  suggestMemoryImportsFromMarkdown,
} from "../vault/index.js";

const yamlListMarkdown = [
  "---",
  "title: Late Night Tea Preference",
  "memory_local_ids:",
  "  - tea-preference",
  "tags:",
  "  - user",
  "  - preference",
  "memory_ids:",
  "  - mem-001",
  "  - mem-002",
  "kind: preference",
  "importance: 4",
  "confidence: 0.9",
  "source_path: ../outside",
  "---",
  "",
  "# Late Night Tea Preference",
  "",
  "User preference: when discussing late-night work, suggest warm tea before stronger caffeine.",
].join("\n");

const jsonLikeMarkdown = [
  "---",
  "title: \"JSON-like frontmatter\"",
  "tags: [\"json\", \"inline\"]",
  "memory_ids: [\"mem-json\"]",
  "importance: 3",
  "---",
  "",
  "Inline arrays should keep working.",
].join("\n");
const crlfMarkdown = [
  "---",
  "title: Windows Frontmatter",
  "tags:",
  "  - crlf",
  "---",
  "",
  "CRLF frontmatter should parse.",
].join("\r\n");

const parsedYaml = parseMarkdown(yamlListMarkdown);
const parsedJsonLike = parseMarkdown(jsonLikeMarkdown);
const parsedCrlf = parseMarkdown(crlfMarkdown);
const suggestions = suggestMemoryImportsFromMarkdown(
  yamlListMarkdown,
  "people/user-preference.md",
);

printSection("list parsing");
pass(arrayEquals(parsedYaml.frontmatter.tags, ["user", "preference"]), "tags YAML list parsed");
pass(arrayEquals(parsedYaml.frontmatter.memory_ids, ["mem-001", "mem-002"]), "memory_ids YAML list parsed");

printSection("JSON-like compatibility");
pass(arrayEquals(parsedJsonLike.frontmatter.tags, ["json", "inline"]), "inline tags array parsed");
pass(arrayEquals(parsedJsonLike.frontmatter.memory_ids, ["mem-json"]), "inline memory_ids array parsed");

printSection("CRLF compatibility");
pass(parsedCrlf.frontmatter.title === "Windows Frontmatter", "CRLF title parsed");
pass(arrayEquals(parsedCrlf.frontmatter.tags, ["crlf"]), "CRLF YAML list parsed");

printSection("import suggestion");
pass(suggestions.length === 1, `suggestions=${suggestions.length}`);
pass(suggestions[0]?.localId === "tea-preference", `localId=${suggestions[0]?.localId ?? "none"}`);
pass(arrayEquals(suggestions[0]?.tags, ["user", "preference"]), "suggestion tags from YAML list");
pass(suggestions[0]?.kind === "preference", `kind=${suggestions[0]?.kind ?? "none"}`);

printSection("path safety");
pass(suggestions[0]?.path === "people/user-preference.md", `safe fallback path=${suggestions[0]?.path ?? "none"}`);
pass(
  Boolean(suggestions[0]?.warnings.some((warning) => warning.includes("unsafe source_path"))),
  "unsafe frontmatter source_path warned and ignored",
);

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

function arrayEquals(value: unknown, expected: string[]): boolean {
  return (
    Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index])
  );
}
