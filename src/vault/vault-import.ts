import { createHash } from "node:crypto";
import path from "node:path";
import {
  ensureMarkdownPath,
  normalizeVaultRelativePath,
  parseMarkdown,
} from "./markdown-memory-vault.js";
import type { MarkdownMemoryVault } from "./markdown-memory-vault.js";
import type {
  MarkdownFrontmatter,
  MarkdownFrontmatterValue,
  MarkdownMemoryImportOptions,
  MarkdownMemoryImportSuggestion,
  MarkdownVaultEntry,
} from "./types.js";
import type { Importance, MemoryFormationPlan, MemoryKind, NewMemoryNode } from "../types.js";

const MEMORY_KINDS = new Set<MemoryKind>([
  "episode",
  "semantic",
  "goal",
  "preference",
  "reflection",
  "self_model",
  "procedure",
  "relationship",
]);

export function suggestMemoryImportsFromMarkdown(
  markdown: string,
  sourcePath: string,
  options: MarkdownMemoryImportOptions = {},
): MarkdownMemoryImportSuggestion[] {
  const parsed = parseMarkdown(markdown);
  const safePath = normalizeSourcePath(sourcePath);

  return suggestMemoryImportsFromEntry(
    {
      path: safePath,
      absolutePath: "",
      body: parsed.body,
      markdown,
      frontmatter: parsed.frontmatter,
      createdAt: valueAsString(parsed.frontmatter.created_at),
      updatedAt: valueAsString(parsed.frontmatter.updated_at),
    },
    options,
  );
}

export function suggestMemoryImportsFromEntry(
  entry: MarkdownVaultEntry,
  options: MarkdownMemoryImportOptions = {},
): MarkdownMemoryImportSuggestion[] {
  const warnings: string[] = [];
  const frontmatter = entry.frontmatter;
  const path = sourcePathForEntry(entry, warnings);
  const title = stringValue(frontmatter.title) ?? titleFromBody(entry.body) ?? titleFromPath(path);
  const anchor = anchorForEntry(entry, title);
  const kind = memoryKind(frontmatter.kind, options.defaultKind, warnings);
  const importance = importanceValue(frontmatter.importance, options.defaultImportance, warnings);
  const confidence = confidenceValue(frontmatter.confidence, options.defaultConfidence, warnings);
  const tags = tagList(frontmatter.tags);
  const text = memoryTextFromBody(entry.body, title);
  const memoryLocalIds = localIdsForEntry(frontmatter, path, anchor);

  return memoryLocalIds.map((localId) => ({
    localId,
    title,
    text,
    path,
    anchor,
    kind,
    importance,
    confidence,
    tags,
    frontmatter,
    warnings,
  }));
}

export async function suggestMemoryImportsFromVaultPath(
  vault: MarkdownMemoryVault,
  vaultPath: string,
  options: MarkdownMemoryImportOptions = {},
): Promise<MarkdownMemoryImportSuggestion[]> {
  const entry = await vault.read(vaultPath);
  if (!entry) {
    return [];
  }

  return suggestMemoryImportsFromEntry(entry, options);
}

export function buildMemoryFormationPlanFromSuggestions(
  suggestions: MarkdownMemoryImportSuggestion[],
  options: MarkdownMemoryImportOptions = {},
): MemoryFormationPlan {
  const nodes: NewMemoryNode[] = suggestions.map((suggestion) => ({
    localId: suggestion.localId,
    kind: suggestion.kind as MemoryKind,
    text: suggestion.text,
    importance: suggestion.importance as Importance,
    confidence: suggestion.confidence,
    tags: suggestion.tags,
    storageKind: "markdown",
    sourcePath: suggestion.path,
    sourceAnchor: suggestion.anchor,
  }));

  const plan: MemoryFormationPlan = {
    nodes,
    edges: [],
    rationale: options.rationale ?? `Imported ${nodes.length} Markdown memory node(s) from vault source metadata.`,
  };

  if (options.includeVaultWrite) {
    plan.vaultWrites = suggestions.map((suggestion) => ({
      localId: `vault:${suggestion.localId}`,
      title: suggestion.title,
      path: suggestion.path,
      anchor: suggestion.anchor,
      body: suggestion.text,
      memoryLocalIds: [suggestion.localId],
      tags: suggestion.tags,
      importance: suggestion.importance as Importance,
      kind: suggestion.kind as MemoryKind,
    }));
  }

  return plan;
}

export async function buildMemoryFormationPlanFromVaultPath(
  vault: MarkdownMemoryVault,
  vaultPath: string,
  options: MarkdownMemoryImportOptions = {},
): Promise<MemoryFormationPlan | null> {
  const suggestions = await suggestMemoryImportsFromVaultPath(vault, vaultPath, options);
  if (suggestions.length === 0) {
    return null;
  }

  return buildMemoryFormationPlanFromSuggestions(suggestions, options);
}

function sourcePathForEntry(entry: MarkdownVaultEntry, warnings: string[]): string {
  const sourcePath = stringValue(entry.frontmatter.source_path) ?? stringValue(entry.frontmatter.sourcePath) ?? entry.path;
  try {
    return normalizeSourcePath(sourcePath);
  } catch (error) {
    warnings.push(`Ignored unsafe source_path frontmatter: ${sourcePath}`);
    return normalizeSourcePath(entry.path);
  }
}

function normalizeSourcePath(input: string): string {
  return normalizeVaultRelativePath(ensureMarkdownPath(input));
}

function localIdsForEntry(frontmatter: MarkdownFrontmatter, sourcePath: string, anchor: string | undefined): string[] {
  const values = arrayValue(frontmatter.memory_local_ids)
    ?? arrayValue(frontmatter.memoryLocalIds)
    ?? maybeSingleValue(frontmatter.memory_local_id)
    ?? maybeSingleValue(frontmatter.memoryLocalId)
    ?? maybeSingleValue(frontmatter.vault_id);

  const ids = values
    ?.map((value) => String(value).trim())
    .filter(Boolean);

  if (ids && ids.length > 0) {
    return [...new Set(ids)];
  }

  return [`md:${stableId(`${sourcePath}#${anchor ?? ""}`)}`];
}

function memoryKind(
  rawKind: MarkdownFrontmatterValue | undefined,
  defaultKind: string | undefined,
  warnings: string[],
): MemoryKind {
  const candidate = (stringValue(rawKind) ?? defaultKind ?? "semantic") as MemoryKind;
  if (MEMORY_KINDS.has(candidate)) {
    return candidate;
  }

  warnings.push(`Unsupported kind "${candidate}", defaulted to semantic.`);
  return "semantic";
}

function importanceValue(
  rawImportance: MarkdownFrontmatterValue | undefined,
  defaultImportance: number | undefined,
  warnings: string[],
): Importance {
  const numeric = numberValue(rawImportance) ?? defaultImportance ?? 3;
  const rounded = Math.round(numeric);

  if (rounded < 1 || rounded > 5) {
    warnings.push(`Clamped importance ${numeric} into the 1..5 range.`);
  }

  return Math.max(1, Math.min(5, rounded)) as Importance;
}

function confidenceValue(
  rawConfidence: MarkdownFrontmatterValue | undefined,
  defaultConfidence: number | undefined,
  warnings: string[],
): number {
  const numeric = numberValue(rawConfidence) ?? defaultConfidence ?? 0.85;

  if (numeric < 0 || numeric > 1) {
    warnings.push(`Clamped confidence ${numeric} into the 0..1 range.`);
  }

  return Math.max(0, Math.min(1, numeric));
}

function tagList(rawTags: MarkdownFrontmatterValue | undefined): string[] {
  const values = arrayValue(rawTags) ?? (typeof rawTags === "string" ? rawTags.split(",") : []);
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function anchorForEntry(entry: MarkdownVaultEntry, title: string): string | undefined {
  return (
    stringValue(entry.frontmatter.anchor)
    ?? stringValue(entry.frontmatter.source_anchor)
    ?? stringValue(entry.frontmatter.sourceAnchor)
    ?? htmlAnchorFromBody(entry.body)
    ?? slugify(title)
  );
}

function memoryTextFromBody(body: string, title: string): string {
  const withoutAnchors = body.replace(/<a\s+[^>]*id=["'][^"']+["'][^>]*>\s*<\/a>/giu, "");
  const lines = withoutAnchors.split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstContentIndex >= 0 && lines[firstContentIndex]?.trim().replace(/^#+\s*/, "") === title) {
    lines.splice(firstContentIndex, 1);
  }

  return lines.join("\n").trim() || title;
}

function titleFromBody(body: string): string | undefined {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "))
    ?.replace(/^#+\s*/, "");
}

function titleFromPath(sourcePath: string): string {
  const parsed = path.posix.parse(sourcePath.replace(/\\/g, "/"));
  return parsed.name
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toLocaleUpperCase() + part.slice(1))
    .join(" ") || sourcePath;
}

function htmlAnchorFromBody(body: string): string | undefined {
  return body.match(/<a\s+[^>]*id=["']([^"']+)["'][^>]*>/iu)?.[1];
}

function arrayValue(value: MarkdownFrontmatterValue | undefined): MarkdownFrontmatterValue[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function maybeSingleValue(value: MarkdownFrontmatterValue | undefined): MarkdownFrontmatterValue[] | undefined {
  return value === undefined || Array.isArray(value) ? undefined : [value];
}

function stringValue(value: MarkdownFrontmatterValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: MarkdownFrontmatterValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function valueAsString(value: MarkdownFrontmatterValue | undefined): string | undefined {
  if (value === undefined || value === null || Array.isArray(value) || typeof value === "object") {
    return undefined;
  }

  return String(value);
}

function stableId(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
