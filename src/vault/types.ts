export type MarkdownFrontmatterValue =
  | string
  | number
  | boolean
  | null
  | Date
  | MarkdownFrontmatterValue[]
  | { [key: string]: MarkdownFrontmatterValue };

export type MarkdownFrontmatter = Record<string, MarkdownFrontmatterValue>;

export interface MarkdownVaultWriteInput {
  path?: string;
  title?: string;
  body: string;
  frontmatter?: MarkdownFrontmatter;
  overwrite?: boolean;
}

export interface MarkdownVaultEntry {
  path: string;
  absolutePath: string;
  body: string;
  markdown: string;
  frontmatter: MarkdownFrontmatter;
  createdAt?: string;
  updatedAt?: string;
}

export interface MarkdownVaultListOptions {
  prefix?: string;
  recursive?: boolean;
}

export interface MarkdownVaultListItem {
  path: string;
  absolutePath: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface MarkdownVaultSearchOptions extends MarkdownVaultListOptions {
  caseSensitive?: boolean;
  limit?: number;
}

export interface MarkdownVaultSearchResult extends MarkdownVaultListItem {
  matches: MarkdownVaultSearchMatch[];
}

export interface MarkdownVaultSearchMatch {
  line: number;
  text: string;
}

export interface MarkdownMemoryImportSuggestion {
  localId: string;
  title: string;
  text: string;
  path: string;
  anchor?: string;
  kind: string;
  importance: number;
  confidence: number;
  tags: string[];
  frontmatter: MarkdownFrontmatter;
  warnings: string[];
}

export interface MarkdownMemoryImportOptions {
  defaultKind?: string;
  defaultImportance?: number;
  defaultConfidence?: number;
  includeVaultWrite?: boolean;
  rationale?: string;
}
