import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMarkdownGraphMemoryCore } from "../vault/index.js";
import type { MarkdownGraphActivatedSection } from "../vault/index.js";

interface NormalizedSection {
  path: string;
  heading: string;
  text: string;
  activation: number;
}

const vaultRoot = await mkdtemp(path.join(tmpdir(), "pianpian-markdown-graph-memory-"));

await writeVaultFile(
  "people/卢静涵.md",
  `---
type: person
name: 卢静涵
aliases: ["静涵", "用户"]
graph_id: person:lu-jinghan
links:
  - target: relationship:lu-jinghan-lin-pianpian
    relation: same_entity
    strength: 0.75
  - target: place:yangzhou
    relation: elaborates
    strength: 0.45
tags: ["person", "user"]
---

# 卢静涵

## 身份

卢静涵是林翩翩长期陪伴关系中的用户。

## 偏好

卢静涵的爱好是听琵琶，尤其喜欢安静、温柔、带一点古意的琵琶声。

## 关系

卢静涵与 [[林翩翩]] 的关系源自 [[扬州]] 河边的第一次相遇。`,
);

await writeVaultFile(
  "relationships/卢静涵-林翩翩.md",
  `---
type: relationship
name: 卢静涵-林翩翩
graph_id: relationship:lu-jinghan-lin-pianpian
people: ["卢静涵", "林翩翩"]
places: ["扬州"]
links:
  - target: person:lu-jinghan
    relation: same_entity
    strength: 0.9
  - target: place:yangzhou
    relation: elaborates
    strength: 0.9
tags: ["relationship-origin"]
---

# 卢静涵-林翩翩

## origin

卢静涵和林翩翩第一次相遇在扬州河边；那是这段关系的起点。

## 现在

这段关系会把偏好、地点和共同经历连成可激活的图，而不是只做全文搜索。`,
);

await writeVaultFile(
  "places/扬州.md",
  `---
type: place
name: 扬州
graph_id: place:yangzhou
aliases: ["扬州河边"]
links:
  - target: relationship:lu-jinghan-lin-pianpian
    relation: elaborates
    strength: 0.9
---

# 扬州

## 河边

扬州河边是卢静涵和林翩翩第一次相遇的地点。`,
);

const core = createMarkdownGraphMemoryCore({ vaultPath: vaultRoot });

const hobbyRecall = await core.recall("你还记得我的爱好吗？", {
  maxNodes: 8,
  maxDepth: 2,
});
const originRecall = await core.recall("我们第一次在哪里相遇？", {
  maxNodes: 8,
  maxDepth: 2,
});

const hobbySections = normalizeSections(hobbyRecall.activatedSections);
const originSections = normalizeSections(originRecall.activatedSections);
const topHobby = hobbySections[0];

printSection("vault");
pass(vaultRoot.includes("pianpian-markdown-graph-memory-"), `temporary vault=${vaultRoot}`);

printSection("hobby recall");
pass(
  hobbySections.some((section) => mentionsAll(section, ["听琵琶"]) && mentionsAny(section, ["偏好", "爱好"])),
  "activates people/卢静涵.md preference section with 听琵琶",
);
pass(
  !(topHobby && isOriginSection(topHobby)),
  `origin is not ranked first; top=${describeSection(topHobby)}`,
);

printSection("origin recall");
pass(
  originSections.some((section) => isOriginSection(section) && mentionsAll(section, ["扬州", "河边"])),
  "activates relationship origin section with 扬州河边",
);
pass(
  originSections.some((section) => section.path === "places/扬州.md" && mentionsAll(section, ["扬州", "河边"])),
  "keeps place node reachable through graph activation",
);

function normalizeSections(sections: MarkdownGraphActivatedSection[]): NormalizedSection[] {
  return sections
    .map((section) => ({
      path: section.path,
      heading: section.heading,
      text: section.text,
      activation: section.activation,
    }))
    .sort((left, right) => right.activation - left.activation);
}

function isOriginSection(section: NormalizedSection): boolean {
  return mentionsAny(section, ["origin", "第一次相遇", "关系的起点", "relationship-origin"]);
}

function mentionsAll(section: NormalizedSection, terms: string[]): boolean {
  const haystack = sectionHaystack(section);
  return terms.every((term) => haystack.includes(term.toLowerCase()));
}

function mentionsAny(section: NormalizedSection, terms: string[]): boolean {
  const haystack = sectionHaystack(section);
  return terms.some((term) => haystack.includes(term.toLowerCase()));
}

function sectionHaystack(section: NormalizedSection): string {
  return `${section.path} ${section.heading} ${section.text}`.toLowerCase();
}

function describeSection(section: NormalizedSection | undefined): string {
  if (!section) {
    return "none";
  }

  return `${section.path || "unknown"}#${section.heading || "untitled"} activation=${section.activation.toFixed(2)}`;
}

async function writeVaultFile(relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content.trimStart(), "utf8");
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
