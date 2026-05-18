import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  MarkdownFrontmatter,
  MarkdownFrontmatterValue,
  MarkdownVaultEntry,
  MarkdownVaultListItem,
  MarkdownVaultListOptions,
  MarkdownVaultSearchOptions,
  MarkdownVaultSearchResult,
  MarkdownVaultWriteInput,
} from "./types.js";

interface ResolvedVaultPath {
  relativePath: string;
  absolutePath: string;
}

export class MarkdownMemoryVault {
  private readonly root: string;

  constructor(rootPath: string) {
    if (!rootPath.trim()) {
      throw new Error("Vault root path is required.");
    }
    this.root = path.resolve(rootPath);
  }

  async write(input: MarkdownVaultWriteInput): Promise<MarkdownVaultEntry> {
    const now = new Date().toISOString();
    const target = this.resolveVaultPath(
      ensureMarkdownPath(
        input.path ?? createStableMarkdownFileName(input.title, input.body),
      ),
    );

    await mkdir(path.dirname(target.absolutePath), { recursive: true });

    if (!input.overwrite && (await pathExists(target.absolutePath))) {
      throw new Error(`Vault entry already exists: ${target.relativePath}`);
    }

    const frontmatter: MarkdownFrontmatter = {
      title: input.title ?? titleFromBody(input.body) ?? target.relativePath,
      created_at: now,
      updated_at: now,
      ...input.frontmatter,
    };
    const markdown = renderMarkdown(input.body, frontmatter);

    await writeFile(target.absolutePath, markdown, "utf8");

    return {
      path: target.relativePath,
      absolutePath: target.absolutePath,
      body: input.body,
      markdown,
      frontmatter,
      createdAt: valueAsString(frontmatter.created_at),
      updatedAt: valueAsString(frontmatter.updated_at),
    };
  }

  async read(vaultPath: string): Promise<MarkdownVaultEntry | null> {
    const target = this.resolveVaultPath(ensureMarkdownPath(vaultPath));

    if (!(await pathExists(target.absolutePath))) {
      return null;
    }

    const markdown = await readFile(target.absolutePath, "utf8");
    const parsed = parseMarkdown(markdown);

    return {
      path: target.relativePath,
      absolutePath: target.absolutePath,
      body: parsed.body,
      markdown,
      frontmatter: parsed.frontmatter,
      createdAt: valueAsString(parsed.frontmatter.created_at),
      updatedAt: valueAsString(parsed.frontmatter.updated_at),
    };
  }

  async list(
    options: MarkdownVaultListOptions = {},
  ): Promise<MarkdownVaultListItem[]> {
    const base = this.resolveVaultPath(options.prefix ?? ".");

    if (!(await pathExists(base.absolutePath))) {
      return [];
    }

    const baseStat = await stat(base.absolutePath);
    const files = baseStat.isDirectory()
      ? await collectMarkdownFiles(base.absolutePath, options.recursive ?? true)
      : [base.absolutePath];

    const items = await Promise.all(
      files.map(async (absolutePath) => {
        const fileStat = await stat(absolutePath);
        return {
          path: this.toVaultRelativePath(absolutePath),
          absolutePath,
          sizeBytes: fileStat.size,
          updatedAt: fileStat.mtime.toISOString(),
        };
      }),
    );

    return items.sort((a, b) => a.path.localeCompare(b.path));
  }

  async search(
    query: string,
    options: MarkdownVaultSearchOptions = {},
  ): Promise<MarkdownVaultSearchResult[]> {
    if (!query) {
      return [];
    }

    const needle = options.caseSensitive ? query : query.toLocaleLowerCase();
    const results: MarkdownVaultSearchResult[] = [];

    for (const item of await this.list(options)) {
      const markdown = await readFile(item.absolutePath, "utf8");
      const lines = markdown.split(/\r?\n/);
      const matches = lines
        .map((line, index) => ({ line: index + 1, text: line }))
        .filter((match) => {
          const haystack = options.caseSensitive
            ? match.text
            : match.text.toLocaleLowerCase();
          return haystack.includes(needle);
        });

      if (matches.length > 0) {
        results.push({ ...item, matches });
      }

      if (options.limit !== undefined && results.length >= options.limit) {
        return results.slice(0, options.limit);
      }
    }

    return results;
  }

  private resolveVaultPath(inputPath: string): ResolvedVaultPath {
    const normalized = normalizeVaultRelativePath(inputPath);
    const absolutePath = path.resolve(this.root, normalized);
    const relativeFromRoot = path.relative(this.root, absolutePath);

    if (
      relativeFromRoot === ".." ||
      relativeFromRoot.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeFromRoot)
    ) {
      throw new Error(`Vault path escapes root: ${inputPath}`);
    }

    return {
      relativePath: toPosixPath(relativeFromRoot || "."),
      absolutePath,
    };
  }

  private toVaultRelativePath(absolutePath: string): string {
    const relativePath = path.relative(this.root, absolutePath);
    return toPosixPath(relativePath);
  }
}

export function createStableMarkdownFileName(
  title: string | undefined,
  body: string,
): string {
  const readableBase = title ?? titleFromBody(body) ?? "memory";
  const slug = slugify(readableBase).slice(0, 72) || "memory";
  const hash = createHash("sha1")
    .update(`${title ?? ""}\n${body}`)
    .digest("hex")
    .slice(0, 10);

  return `${slug}-${hash}.md`;
}

export function renderMarkdown(
  body: string,
  frontmatter: MarkdownFrontmatter = {},
): string {
  return `---\n${renderFrontmatter(frontmatter)}---\n\n${body.trimEnd()}\n`;
}

function renderFrontmatter(frontmatter: MarkdownFrontmatter): string {
  return Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${renderFrontmatterValue(value)}`)
    .join("\n")
    .concat("\n");
}

function renderFrontmatterValue(value: MarkdownFrontmatterValue): string {
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(renderFrontmatterValue).join(", ")}]`;
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  return String(value);
}

export function parseMarkdown(markdown: string): {
  frontmatter: MarkdownFrontmatter;
  body: string;
} {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) {
    return { frontmatter: {}, body: markdown };
  }

  const frontmatterBlock = match[1] ?? "";
  const body = markdown.slice(match[0].length);

  return {
    frontmatter: parseFrontmatter(frontmatterBlock),
    body: body.replace(/^\r?\n/, ""),
  };
}

function parseFrontmatter(block: string): MarkdownFrontmatter {
  const result: MarkdownFrontmatter = {};
  const lines = block.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();

    if (rawValue === "") {
      const list = parseIndentedFrontmatterList(lines, index + 1);
      if (list) {
        result[key] = list.values;
        index = list.endIndex;
        continue;
      }
    }

    result[key] = parseFrontmatterValue(rawValue);
  }

  return result;
}

function parseIndentedFrontmatterList(
  lines: string[],
  startIndex: number,
): { values: MarkdownFrontmatterValue[]; endIndex: number } | undefined {
  const values: MarkdownFrontmatterValue[] = [];
  let index = startIndex;

  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      continue;
    }

    const item = line.match(/^\s+-\s*(.*)$/u);
    if (!item) {
      break;
    }

    values.push(parseFrontmatterValue(item[1]?.trim() ?? ""));
  }

  if (values.length === 0) {
    return undefined;
  }

  return { values, endIndex: index - 1 };
}

function parseFrontmatterValue(rawValue: string): MarkdownFrontmatterValue {
  if (rawValue === "null") {
    return null;
  }

  if (rawValue === "true") {
    return true;
  }

  if (rawValue === "false") {
    return false;
  }

  if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
    return Number(rawValue);
  }

  try {
    return JSON.parse(rawValue) as MarkdownFrontmatterValue;
  } catch {
    return rawValue;
  }
}

export function normalizeVaultRelativePath(inputPath: string): string {
  if (!inputPath.trim()) {
    throw new Error("Vault path is required.");
  }

  const cleanedPath = inputPath.replace(/\\/g, "/");

  if (path.isAbsolute(cleanedPath) || /^[a-zA-Z]:\//.test(cleanedPath)) {
    throw new Error(`Vault path must be relative: ${inputPath}`);
  }

  const normalized = path.posix.normalize(cleanedPath);

  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Vault path escapes root: ${inputPath}`);
  }

  return normalized === "." ? "." : normalized.replace(/^\/+/, "");
}

export function ensureMarkdownPath(inputPath: string): string {
  return inputPath.toLocaleLowerCase().endsWith(".md")
    ? inputPath
    : `${inputPath}.md`;
}

async function collectMarkdownFiles(
  directory: string,
  recursive: boolean,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory() && recursive) {
      files.push(...(await collectMarkdownFiles(absolutePath, recursive)));
      continue;
    }

    if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".md")) {
      files.push(absolutePath);
    }
  }

  return files;
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function titleFromBody(body: string): string | undefined {
  const firstLine = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine?.replace(/^#+\s*/, "");
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

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function valueAsString(value: MarkdownFrontmatterValue | undefined): string | undefined {
  if (value === undefined || value === null || Array.isArray(value)) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    return undefined;
  }

  return String(value);
}
