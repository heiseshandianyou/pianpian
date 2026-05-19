import type { Importance, MemoryKind, MemoryRelation } from "../types.js";
import { MarkdownMemoryVault } from "./markdown-memory-vault.js";
import type {
  MarkdownFrontmatter,
  MarkdownFrontmatterValue,
  MarkdownVaultEntry,
} from "./types.js";

export type MarkdownGraphNodeKind = "document" | "section";

export type MarkdownGraphEdgeRelation =
  | MemoryRelation
  | "contains"
  | "frontmatter_link"
  | "wiki_link"
  | "next_section";

export type MarkdownGraphEdgeSource = "frontmatter" | "wiki" | "structure";

export interface MarkdownGraphCompileOptions {
  prefix?: string;
  recursive?: boolean;
}

export interface MarkdownGraphSection {
  id: string;
  documentId: string;
  path: string;
  anchor: string;
  title: string;
  headingDepth: number;
  text: string;
  startLine: number;
  endLine: number;
  wikiLinks: MarkdownWikiLink[];
}

export interface MarkdownGraphNode {
  id: string;
  kind: MarkdownGraphNodeKind;
  title: string;
  text: string;
  path: string;
  anchor?: string;
  tags: string[];
  topics: string[];
  memoryKind?: MemoryKind;
  importance: Importance;
  confidence: number;
  pinned: boolean;
  frontmatter: MarkdownFrontmatter;
  sectionId?: string;
}

export interface MarkdownGraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relation: MarkdownGraphEdgeRelation;
  strength: number;
  confidence: number;
  source: MarkdownGraphEdgeSource;
  label?: string;
  rawTarget?: string;
}

export interface MarkdownGraphUnresolvedLink {
  fromNodeId: string;
  path: string;
  rawTarget: string;
  source: MarkdownGraphEdgeSource;
  label?: string;
}

export interface MarkdownMemoryGraph {
  nodes: MarkdownGraphNode[];
  edges: MarkdownGraphEdge[];
  sections: MarkdownGraphSection[];
  unresolvedLinks: MarkdownGraphUnresolvedLink[];
  compiledAt: string;
}

export interface MarkdownGraphRecallQuery {
  rawInput: string;
  expandedQueries?: string[];
  explicitTopicTerms?: string[];
  priorityTags?: string[];
  priorityKinds?: MemoryKind[];
}

export interface MarkdownGraphRecallOptions extends MarkdownGraphCompileOptions {
  graph?: MarkdownMemoryGraph;
  seedLimit?: number;
  maxDepth?: number;
  maxNodes?: number;
  minSeedScore?: number;
  topicTerms?: string[];
  enableTopicGate?: boolean;
  includeDocuments?: boolean;
  includeSections?: boolean;
}

export interface MarkdownGraphActivatedNode {
  node: MarkdownGraphNode;
  activation: number;
  depth: number;
  reasons: string[];
}

export interface MarkdownGraphActivationTrace {
  fromNodeId?: string;
  toNodeId: string;
  relation?: MarkdownGraphEdgeRelation;
  amount: number;
  reason: string;
}

export interface MarkdownGraphRecallResult {
  query: Required<MarkdownGraphRecallQuery>;
  graph: MarkdownMemoryGraph;
  focusNodes: MarkdownGraphActivatedNode[];
  supportNodes: MarkdownGraphActivatedNode[];
  activationTrace: MarkdownGraphActivationTrace[];
}

export interface MarkdownGraphMemoryCoreOptions {
  vaultPath: string;
}

export interface MarkdownGraphActivatedSection {
  nodeId: string;
  path: string;
  anchor?: string;
  heading: string;
  text: string;
  activation: number;
  depth: number;
  reasons: string[];
}

export interface MarkdownGraphMemoryCoreRecallResult extends MarkdownGraphRecallResult {
  activatedSections: MarkdownGraphActivatedSection[];
  focusSections: MarkdownGraphActivatedSection[];
  supportSections: MarkdownGraphActivatedSection[];
}

interface CompiledDocument {
  entry: MarkdownVaultEntry;
  node: MarkdownGraphNode;
  sections: MarkdownGraphSection[];
  sectionNodes: MarkdownGraphNode[];
  frontmatterLinks: ParsedLink[];
}

interface ParsedLink {
  rawTarget: string;
  targetPath?: string;
  targetAnchor?: string;
  relation?: MarkdownGraphEdgeRelation;
  strength?: number;
  confidence?: number;
  label?: string;
}

export interface MarkdownWikiLink extends ParsedLink {
  raw: string;
}

const DEFAULT_IMPORTANCE: Importance = 3;
const DEFAULT_CONFIDENCE = 0.75;
const VALID_MEMORY_KINDS: readonly MemoryKind[] = [
  "episode",
  "semantic",
  "goal",
  "preference",
  "reflection",
  "self_model",
  "procedure",
  "relationship",
];
const VALID_MEMORY_RELATIONS: readonly MemoryRelation[] = [
  "supports",
  "contradicts",
  "elaborates",
  "same_goal",
  "same_entity",
  "temporal_neighbor",
  "derived_from",
  "reinforces",
  "supersedes",
];

export class MarkdownGraphMemory {
  constructor(private readonly vault: MarkdownMemoryVault) {}

  async compile(
    options: MarkdownGraphCompileOptions = {},
  ): Promise<MarkdownMemoryGraph> {
    const entries = await this.readVaultEntries(options);
    const documents = entries.map(compileDocument);
    const aliasIndex = buildAliasIndex(documents);
    const edgesById = new Map<string, MarkdownGraphEdge>();
    const unresolvedLinks: MarkdownGraphUnresolvedLink[] = [];

    for (const document of documents) {
      for (const sectionNode of document.sectionNodes) {
        addEdge(edgesById, {
          fromNodeId: document.node.id,
          toNodeId: sectionNode.id,
          relation: "contains",
          strength: 0.9,
          confidence: 1,
          source: "structure",
        });
      }

      for (let index = 1; index < document.sectionNodes.length; index += 1) {
        addEdge(edgesById, {
          fromNodeId: document.sectionNodes[index - 1]?.id ?? document.node.id,
          toNodeId: document.sectionNodes[index]?.id ?? document.node.id,
          relation: "next_section",
          strength: 0.52,
          confidence: 0.9,
          source: "structure",
        });
      }

      for (const link of document.frontmatterLinks) {
        connectLink({
          aliasIndex,
          documents,
          edgesById,
          unresolvedLinks,
          fromNodeId: document.node.id,
          sourcePath: document.entry.path,
          source: "frontmatter",
          link,
          fallbackRelation: "frontmatter_link",
          fallbackStrength: 0.82,
          fallbackConfidence: 0.86,
        });
      }

      for (const section of document.sections) {
        for (const link of section.wikiLinks) {
          connectLink({
            aliasIndex,
            documents,
            edgesById,
            unresolvedLinks,
            fromNodeId: section.id,
            sourcePath: document.entry.path,
            source: "wiki",
            link,
            fallbackRelation: "wiki_link",
            fallbackStrength: 0.72,
            fallbackConfidence: 0.8,
          });
        }
      }
    }

    return {
      nodes: documents.flatMap((document) => [
        document.node,
        ...document.sectionNodes,
      ]),
      edges: [...edgesById.values()].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
      sections: documents.flatMap((document) => document.sections),
      unresolvedLinks,
      compiledAt: new Date().toISOString(),
    };
  }

  async recall(
    input: string | MarkdownGraphRecallQuery,
    options: MarkdownGraphRecallOptions = {},
  ): Promise<MarkdownGraphRecallResult> {
    const query = normalizeRecallQuery(input);
    const graph = options.graph ?? (await this.compile(options));
    const maxDepth = options.maxDepth ?? 2;
    const maxNodes = options.maxNodes ?? 16;
    const seedLimit = options.seedLimit ?? 8;
    const includeDocuments = options.includeDocuments ?? true;
    const includeSections = options.includeSections ?? true;
    const topicTerms = normalizeTerms([
      ...(options.topicTerms ?? []),
      ...query.explicitTopicTerms,
    ]);
    const recallTerms = normalizeTerms([
      query.rawInput,
      ...query.expandedQueries,
      ...topicTerms,
    ]);
    const enableTopicGate = options.enableTopicGate ?? true;
    const candidateNodes = graph.nodes.filter((node) => {
      if (node.kind === "document") {
        return includeDocuments;
      }
      return includeSections;
    });
    const topicGatedSeeds = rankSeedCandidates(
      candidateNodes,
      query,
      recallTerms,
      topicTerms,
      enableTopicGate,
    );
    const ungatedSeeds =
      topicGatedSeeds.length > 0
        ? topicGatedSeeds
        : rankSeedCandidates(candidateNodes, query, recallTerms, [], false);
    const minSeedScore = options.minSeedScore ?? 0.08;
    const seeds = ungatedSeeds
      .filter((seed) => seed.score >= minSeedScore)
      .slice(0, seedLimit);
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    const edgesByNodeId = groupEdgesByNodeId(graph.edges);
    const activation = new Map<string, MarkdownGraphActivatedNode>();
    const trace: MarkdownGraphActivationTrace[] = [];

    for (const seed of seeds) {
      const amount = seedActivation(seed.node, seed.score);
      addActivation(activation, seed.node, amount, 0, seed.reason);
      trace.push({
        toNodeId: seed.node.id,
        amount,
        reason: seed.reason,
      });
    }

    let frontier = seeds.map((seed) => seed.node.id);
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      if (frontier.length === 0) {
        break;
      }

      const nextFrontier = new Set<string>();

      for (const fromNodeId of frontier) {
        const fromActive = activation.get(fromNodeId);
        if (!fromActive) {
          continue;
        }

        for (const edge of edgesByNodeId.get(fromNodeId) ?? []) {
          const toNodeId =
            edge.fromNodeId === fromNodeId ? edge.toNodeId : edge.fromNodeId;
          const target = nodesById.get(toNodeId);
          if (!target || !nodeKindIncluded(target, includeDocuments, includeSections)) {
            continue;
          }

          if (
            enableTopicGate &&
            topicTerms.length > 0 &&
            !passesTopicGate(target, topicTerms, query, edge, fromActive)
          ) {
            continue;
          }

          const amount =
            fromActive.activation *
            edge.strength *
            edge.confidence *
            relationWeight(edge.relation) *
            depthDecay(depth);

          if (amount < 0.035) {
            continue;
          }

          addActivation(
            activation,
            target,
            amount,
            depth,
            `activated through ${edge.relation}`,
          );
          nextFrontier.add(target.id);
          trace.push({
            fromNodeId,
            toNodeId: target.id,
            relation: edge.relation,
            amount,
            reason: `Activation propagated through ${edge.relation}.`,
          });
        }
      }

      frontier = [...nextFrontier];
    }

    const ranked = [...activation.values()]
      .sort((left, right) => right.activation - left.activation)
      .slice(0, maxNodes);
    const focusLimit = Math.min(6, ranked.length);

    return {
      query,
      graph,
      focusNodes: ranked.slice(0, focusLimit),
      supportNodes: ranked.slice(focusLimit),
      activationTrace: trace
        .sort((left, right) => right.amount - left.amount)
        .slice(0, 50),
    };
  }

  private async readVaultEntries(
    options: MarkdownGraphCompileOptions,
  ): Promise<MarkdownVaultEntry[]> {
    const items = await this.vault.list({
      prefix: options.prefix,
      recursive: options.recursive ?? true,
    });
    const entries = await Promise.all(
      items.map((item) => this.vault.read(item.path)),
    );

    return entries
      .filter((entry): entry is MarkdownVaultEntry => entry !== null)
      .sort((left, right) => left.path.localeCompare(right.path));
  }
}

export class MarkdownGraphMemoryCore {
  private readonly graphMemory: MarkdownGraphMemory;

  constructor(options: MarkdownGraphMemoryCoreOptions) {
    this.graphMemory = new MarkdownGraphMemory(new MarkdownMemoryVault(options.vaultPath));
  }

  compile(options: MarkdownGraphCompileOptions = {}): Promise<MarkdownMemoryGraph> {
    return this.graphMemory.compile(options);
  }

  async recall(
    input: string | MarkdownGraphRecallQuery,
    options: MarkdownGraphRecallOptions = {},
  ): Promise<MarkdownGraphMemoryCoreRecallResult> {
    const result = await this.graphMemory.recall(input, {
      includeDocuments: false,
      ...options,
    });
    const focusSections = result.focusNodes.flatMap(activatedSectionFromNode);
    const supportSections = result.supportNodes.flatMap(activatedSectionFromNode);

    return {
      ...result,
      activatedSections: [...focusSections, ...supportSections],
      focusSections,
      supportSections,
    };
  }
}

export function createMarkdownGraphMemoryCore(
  options: MarkdownGraphMemoryCoreOptions,
): MarkdownGraphMemoryCore {
  return new MarkdownGraphMemoryCore(options);
}

function compileDocument(entry: MarkdownVaultEntry): CompiledDocument {
  const title =
    valueAsString(entry.frontmatter.title) ??
    firstHeadingTitle(entry.body) ??
    fileTitle(entry.path);
  const tags = uniqueStrings([
    ...valueAsStringArray(entry.frontmatter.tags),
    ...valueAsStringArray(entry.frontmatter.tag),
  ]);
  const topics = uniqueStrings([
    ...valueAsStringArray(entry.frontmatter.topics),
    ...valueAsStringArray(entry.frontmatter.topic),
    ...tags,
  ]);
  const memoryKind = parseMemoryKind(entry.frontmatter.kind);
  const importance = parseImportance(entry.frontmatter.importance);
  const confidence = clamp01(
    valueAsNumber(entry.frontmatter.confidence) ?? DEFAULT_CONFIDENCE,
  );
  const pinned = valueAsBoolean(entry.frontmatter.pinned) ?? false;
  const documentId = documentNodeId(entry.path);
  const sections = parseSections(entry.path, documentId, title, entry.body);
  const documentNode: MarkdownGraphNode = {
    id: documentId,
    kind: "document",
    title,
    text: entry.body.trim(),
    path: entry.path,
    tags,
    topics,
    memoryKind,
    importance,
    confidence,
    pinned,
    frontmatter: entry.frontmatter,
  };
  const sectionNodes = sections.map((section) => ({
    id: section.id,
    kind: "section" as const,
    title: section.title,
    text: section.text,
    path: section.path,
    anchor: section.anchor,
    tags,
    topics,
    memoryKind,
    importance,
    confidence,
    pinned,
    frontmatter: entry.frontmatter,
    sectionId: section.id,
  }));

  return {
    entry,
    node: documentNode,
    sections,
    sectionNodes,
    frontmatterLinks: parseFrontmatterLinks(entry.frontmatter.links),
  };
}

function activatedSectionFromNode(
  activated: MarkdownGraphActivatedNode,
): MarkdownGraphActivatedSection[] {
  const node = activated.node;
  if (node.kind !== "section") {
    return [];
  }

  return [
    {
      nodeId: node.id,
      path: node.path,
      anchor: node.anchor,
      heading: node.title,
      text: node.text,
      activation: activated.activation,
      depth: activated.depth,
      reasons: activated.reasons,
    },
  ];
}

function parseSections(
  path: string,
  documentId: string,
  documentTitle: string,
  body: string,
): MarkdownGraphSection[] {
  const lines = body.split(/\r?\n/);
  const headings = lines
    .map((line, index) => {
      const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/u);
      if (!match) {
        return undefined;
      }

      return {
        lineIndex: index,
        depth: match[1]?.length ?? 1,
        title: cleanHeadingTitle(match[2] ?? ""),
      };
    })
    .filter(
      (
        heading,
      ): heading is { lineIndex: number; depth: number; title: string } =>
        heading !== undefined,
    );

  if (headings.length === 0) {
    return [
      makeSection({
        path,
        documentId,
        title: documentTitle,
        headingDepth: 0,
        lines,
        startLineIndex: 0,
        endLineIndex: lines.length - 1,
        anchorCounts: new Map<string, number>(),
      }),
    ];
  }

  const sections: MarkdownGraphSection[] = [];
  const anchorCounts = new Map<string, number>();
  const preamble = lines.slice(0, headings[0]?.lineIndex ?? 0).join("\n").trim();
  if (preamble) {
    sections.push(
      makeSection({
        path,
        documentId,
        title: "Preamble",
        headingDepth: 0,
        lines,
        startLineIndex: 0,
        endLineIndex: (headings[0]?.lineIndex ?? 1) - 1,
        anchorCounts,
      }),
    );
  }

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    if (!heading) {
      continue;
    }

    sections.push(
      makeSection({
        path,
        documentId,
        title: heading.title,
        headingDepth: heading.depth,
        lines,
        startLineIndex: heading.lineIndex,
        endLineIndex:
          (headings[index + 1]?.lineIndex ?? lines.length) - 1,
        anchorCounts,
      }),
    );
  }

  return sections;
}

function makeSection(input: {
  path: string;
  documentId: string;
  title: string;
  headingDepth: number;
  lines: string[];
  startLineIndex: number;
  endLineIndex: number;
  anchorCounts: Map<string, number>;
}): MarkdownGraphSection {
  const baseAnchor = slugify(input.title) || "section";
  const currentCount = input.anchorCounts.get(baseAnchor) ?? 0;
  input.anchorCounts.set(baseAnchor, currentCount + 1);
  const anchor =
    currentCount === 0 ? baseAnchor : `${baseAnchor}-${currentCount + 1}`;
  const text = input.lines
    .slice(input.startLineIndex, input.endLineIndex + 1)
    .join("\n")
    .trim();

  return {
    id: sectionNodeId(input.path, anchor),
    documentId: input.documentId,
    path: input.path,
    anchor,
    title: input.title,
    headingDepth: input.headingDepth,
    text,
    startLine: input.startLineIndex + 1,
    endLine: input.endLineIndex + 1,
    wikiLinks: parseWikiLinks(text),
  };
}

function buildAliasIndex(documents: CompiledDocument[]): Map<string, string> {
  const index = new Map<string, string>();

  for (const document of documents) {
    for (const alias of documentAliases(document.entry, document.node.title)) {
      setAlias(index, alias, document.node.id);
    }

    for (const section of document.sections) {
      setAlias(index, `${document.entry.path}#${section.anchor}`, section.id);
      setAlias(index, `${withoutMarkdownExtension(document.entry.path)}#${section.anchor}`, section.id);
      setAlias(index, `${document.node.title}#${section.title}`, section.id);
    }
  }

  return index;
}

function documentAliases(entry: MarkdownVaultEntry, title: string): string[] {
  const withoutExtension = withoutMarkdownExtension(entry.path);
  const basename = withoutExtension.split("/").at(-1) ?? withoutExtension;
  return uniqueStrings([
    entry.path,
    withoutExtension,
    basename,
    title,
    ...valueAsStringArray(entry.frontmatter.id),
    ...valueAsStringArray(entry.frontmatter.graph_id),
    ...valueAsStringArray(entry.frontmatter.graphId),
    ...valueAsStringArray(entry.frontmatter.name),
    ...valueAsStringArray(entry.frontmatter.aliases),
    ...valueAsStringArray(entry.frontmatter.alias),
    ...valueAsStringArray(entry.frontmatter.people),
    ...valueAsStringArray(entry.frontmatter.places),
  ]);
}

function setAlias(index: Map<string, string>, alias: string, nodeId: string): void {
  const key = normalizeLookupKey(alias);
  if (key && !index.has(key)) {
    index.set(key, nodeId);
  }
}

function connectLink(input: {
  aliasIndex: Map<string, string>;
  documents: CompiledDocument[];
  edgesById: Map<string, MarkdownGraphEdge>;
  unresolvedLinks: MarkdownGraphUnresolvedLink[];
  fromNodeId: string;
  sourcePath: string;
  source: MarkdownGraphEdgeSource;
  link: ParsedLink;
  fallbackRelation: MarkdownGraphEdgeRelation;
  fallbackStrength: number;
  fallbackConfidence: number;
}): void {
  const toNodeId = resolveLinkTarget(
    input.aliasIndex,
    input.documents,
    input.sourcePath,
    input.link,
  );

  if (!toNodeId) {
    input.unresolvedLinks.push({
      fromNodeId: input.fromNodeId,
      path: input.sourcePath,
      rawTarget: input.link.rawTarget,
      source: input.source,
      label: input.link.label,
    });
    return;
  }

  if (toNodeId === input.fromNodeId) {
    return;
  }

  addEdge(input.edgesById, {
    fromNodeId: input.fromNodeId,
    toNodeId,
    relation: input.link.relation ?? input.fallbackRelation,
    strength: clamp01(input.link.strength ?? input.fallbackStrength),
    confidence: clamp01(input.link.confidence ?? input.fallbackConfidence),
    source: input.source,
    label: input.link.label,
    rawTarget: input.link.rawTarget,
  });
}

function resolveLinkTarget(
  aliasIndex: Map<string, string>,
  documents: CompiledDocument[],
  sourcePath: string,
  link: ParsedLink,
): string | undefined {
  const targetPath = link.targetPath?.trim();
  const targetAnchor = link.targetAnchor?.trim();

  if (targetPath && targetAnchor) {
    return aliasIndex.get(normalizeLookupKey(`${targetPath}#${targetAnchor}`));
  }

  if (!targetPath && targetAnchor) {
    return aliasIndex.get(normalizeLookupKey(`${sourcePath}#${targetAnchor}`));
  }

  if (targetPath) {
    return aliasIndex.get(normalizeLookupKey(targetPath));
  }

  if (targetAnchor) {
    return aliasIndex.get(normalizeLookupKey(`${sourcePath}#${targetAnchor}`));
  }

  const raw = link.rawTarget.trim();
  const direct = aliasIndex.get(normalizeLookupKey(raw));
  if (direct) {
    return direct;
  }

  const matchingSection = documents
    .flatMap((document) => document.sections)
    .find((section) => normalizeLookupKey(section.title) === normalizeLookupKey(raw));
  return matchingSection?.id;
}

function addEdge(
  edgesById: Map<string, MarkdownGraphEdge>,
  edge: Omit<MarkdownGraphEdge, "id">,
): void {
  const id = edgeId(edge);
  const existing = edgesById.get(id);
  if (!existing) {
    edgesById.set(id, { id, ...edge });
    return;
  }

  existing.strength = Math.max(existing.strength, edge.strength);
  existing.confidence = Math.max(existing.confidence, edge.confidence);
}

function rankSeedCandidates(
  nodes: MarkdownGraphNode[],
  query: Required<MarkdownGraphRecallQuery>,
  recallTerms: string[],
  topicTerms: string[],
  enableTopicGate: boolean,
): Array<{ node: MarkdownGraphNode; score: number; reason: string }> {
  const priorityTags = new Set(
    query.priorityTags.map((tag) => tag.toLocaleLowerCase()),
  );

  return nodes
    .map((node) => {
      const lexicalScore = lexicalMatchScore(node, recallTerms);
      const topicScore = lexicalMatchScore(node, topicTerms);
      const tagScore = node.tags.reduce(
        (score, tag) =>
          score + (priorityTags.has(tag.toLocaleLowerCase()) ? 0.35 : 0),
        0,
      );
      const kindScore =
        node.memoryKind && query.priorityKinds.includes(node.memoryKind)
          ? 0.28
          : 0;
      const pinnedScore = node.pinned ? 0.16 : 0;
      const score =
        lexicalScore +
        topicScore * 0.65 +
        tagScore +
        kindScore +
        pinnedScore +
        node.importance * 0.025;

      return {
        node,
        score,
        topicScore,
        reason:
          topicScore > 0
            ? "Seed matched recall text and topic terms."
            : "Seed matched recall text.",
      };
    })
    .filter((candidate) => {
      if (!enableTopicGate || topicTerms.length === 0) {
        return true;
      }

      return (
        candidate.topicScore > 0 ||
        candidate.node.tags.some((tag) => priorityTags.has(tag.toLocaleLowerCase())) ||
        (candidate.node.memoryKind !== undefined &&
          query.priorityKinds.includes(candidate.node.memoryKind))
      );
    })
    .sort((left, right) => right.score - left.score)
    .map(({ node, score, reason }) => ({ node, score, reason }));
}

function normalizeRecallQuery(
  input: string | MarkdownGraphRecallQuery,
): Required<MarkdownGraphRecallQuery> {
  if (typeof input === "string") {
    return {
      rawInput: input,
      expandedQueries: [input],
      explicitTopicTerms: [],
      priorityTags: [],
      priorityKinds: [],
    };
  }

  return {
    rawInput: input.rawInput,
    expandedQueries: input.expandedQueries ?? [input.rawInput],
    explicitTopicTerms: input.explicitTopicTerms ?? [],
    priorityTags: input.priorityTags ?? [],
    priorityKinds: input.priorityKinds ?? [],
  };
}

function seedActivation(node: MarkdownGraphNode, score: number): number {
  return clamp01(
    0.28 +
      Math.min(score, 1.2) * 0.42 +
      node.importance * 0.045 +
      node.confidence * 0.12 +
      (node.pinned ? 0.12 : 0),
  );
}

function addActivation(
  activation: Map<string, MarkdownGraphActivatedNode>,
  node: MarkdownGraphNode,
  amount: number,
  depth: number,
  reason: string,
): void {
  const existing = activation.get(node.id);
  if (!existing) {
    activation.set(node.id, {
      node,
      activation: clamp01(amount),
      depth,
      reasons: [reason],
    });
    return;
  }

  existing.activation = clamp01(existing.activation + amount);
  existing.depth = Math.min(existing.depth, depth);
  if (!existing.reasons.includes(reason)) {
    existing.reasons.push(reason);
  }
}

function passesTopicGate(
  target: MarkdownGraphNode,
  topicTerms: string[],
  query: Required<MarkdownGraphRecallQuery>,
  edge: MarkdownGraphEdge,
  source: MarkdownGraphActivatedNode,
): boolean {
  if (lexicalMatchScore(target, topicTerms) > 0) {
    return true;
  }

  const priorityTags = new Set(
    query.priorityTags.map((tag) => tag.toLocaleLowerCase()),
  );
  if (target.tags.some((tag) => priorityTags.has(tag.toLocaleLowerCase()))) {
    return true;
  }

  if (target.memoryKind && query.priorityKinds.includes(target.memoryKind)) {
    return true;
  }

  return source.activation >= 0.58 && edge.strength >= 0.72;
}

function lexicalMatchScore(node: MarkdownGraphNode, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }

  const haystack = normalizeText(
    [
      node.title,
      node.text,
      node.path,
      node.anchor ?? "",
      node.tags.join(" "),
      node.topics.join(" "),
      node.memoryKind ?? "",
    ].join(" "),
  );
  let score = 0;

  for (const term of terms) {
    if (!term || !haystack.includes(term)) {
      continue;
    }

    score += Math.min(0.4, 0.08 + term.length / 60);
  }

  return score;
}

function groupEdgesByNodeId(
  edges: MarkdownGraphEdge[],
): Map<string, MarkdownGraphEdge[]> {
  const grouped = new Map<string, MarkdownGraphEdge[]>();

  for (const edge of edges) {
    grouped.set(edge.fromNodeId, [...(grouped.get(edge.fromNodeId) ?? []), edge]);
    grouped.set(edge.toNodeId, [...(grouped.get(edge.toNodeId) ?? []), edge]);
  }

  return grouped;
}

function nodeKindIncluded(
  node: MarkdownGraphNode,
  includeDocuments: boolean,
  includeSections: boolean,
): boolean {
  return node.kind === "document" ? includeDocuments : includeSections;
}

function parseWikiLinks(text: string): MarkdownWikiLink[] {
  const links: MarkdownWikiLink[] = [];
  const pattern = /!?\[\[([^\]]+)\]\]/gu;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const raw = match[0] ?? "";
    const inner = (match[1] ?? "").trim();
    if (!inner) {
      continue;
    }

    const [target = "", label] = inner.split("|", 2);
    links.push({
      raw,
      ...parseLinkTarget(target.trim()),
      label: label?.trim(),
    });
  }

  return links;
}

function parseFrontmatterLinks(
  value: MarkdownFrontmatterValue | undefined,
  fallbackRelation: MarkdownGraphEdgeRelation = "frontmatter_link",
): ParsedLink[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => parseFrontmatterLinks(item, fallbackRelation));
  }

  if (typeof value === "string") {
    return [{ ...parseLinkTarget(value), relation: fallbackRelation }];
  }

  if (!isPlainRecord(value)) {
    return [];
  }

  const directTarget = firstPresentString(value, [
    "target",
    "to",
    "path",
    "href",
    "url",
    "id",
    "title",
  ]);
  if (directTarget) {
    return [
      {
        ...parseLinkTarget(directTarget),
        relation: parseEdgeRelation(value.relation) ?? fallbackRelation,
        strength: valueAsNumber(value.strength),
        confidence: valueAsNumber(value.confidence),
        label: firstPresentString(value, ["label", "name"]),
      },
    ];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) =>
    parseFrontmatterLinks(
      nestedValue,
      parseEdgeRelation(key) ?? fallbackRelation,
    ),
  );
}

function parseLinkTarget(rawTarget: string): ParsedLink {
  const withoutAlias = rawTarget.split("|", 1)[0]?.trim() ?? rawTarget.trim();
  const hashIndex = withoutAlias.indexOf("#");

  if (hashIndex < 0) {
    return { rawTarget: withoutAlias, targetPath: withoutAlias };
  }

  const targetPath = withoutAlias.slice(0, hashIndex).trim();
  const targetAnchor = withoutAlias.slice(hashIndex + 1).trim();
  return {
    rawTarget: withoutAlias,
    targetPath: targetPath || undefined,
    targetAnchor: targetAnchor || undefined,
  };
}

function parseEdgeRelation(
  value: MarkdownFrontmatterValue | string | undefined,
): MarkdownGraphEdgeRelation | undefined {
  const relation = typeof value === "string" ? value : valueAsString(value);
  if (!relation) {
    return undefined;
  }

  if (VALID_MEMORY_RELATIONS.includes(relation as MemoryRelation)) {
    return relation as MemoryRelation;
  }

  if (
    relation === "contains" ||
    relation === "frontmatter_link" ||
    relation === "wiki_link" ||
    relation === "next_section"
  ) {
    return relation;
  }

  return undefined;
}

function parseMemoryKind(
  value: MarkdownFrontmatterValue | undefined,
): MemoryKind | undefined {
  const kind = valueAsString(value);
  if (kind && VALID_MEMORY_KINDS.includes(kind as MemoryKind)) {
    return kind as MemoryKind;
  }
  return undefined;
}

function parseImportance(
  value: MarkdownFrontmatterValue | undefined,
): Importance {
  const raw = Math.round(valueAsNumber(value) ?? DEFAULT_IMPORTANCE);
  if (raw <= 1) {
    return 1;
  }
  if (raw >= 5) {
    return 5;
  }
  return raw as Importance;
}

function firstPresentString(
  record: Record<string, MarkdownFrontmatterValue>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = valueAsString(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function valueAsString(
  value: MarkdownFrontmatterValue | undefined,
): string | undefined {
  if (
    value === undefined ||
    value === null ||
    Array.isArray(value) ||
    value instanceof Date ||
    typeof value === "object"
  ) {
    return value instanceof Date ? value.toISOString() : undefined;
  }

  return String(value);
}

function valueAsStringArray(
  value: MarkdownFrontmatterValue | undefined,
): string[] {
  if (Array.isArray(value)) {
    return value
      .map(valueAsString)
      .filter((item): item is string => item !== undefined && item.trim() !== "");
  }

  const single = valueAsString(value);
  if (!single) {
    return [];
  }

  return single
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function valueAsNumber(
  value: MarkdownFrontmatterValue | undefined,
): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function valueAsBoolean(
  value: MarkdownFrontmatterValue | undefined,
): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.toLocaleLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return undefined;
}

function isPlainRecord(
  value: MarkdownFrontmatterValue,
): value is Record<string, MarkdownFrontmatterValue> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function normalizeTerms(values: string[]): string[] {
  const terms = new Set<string>();

  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized.length >= 2) {
      terms.add(normalized);
    }

    for (const token of normalized.match(/[\p{L}\p{N}_-]{2,}/gu) ?? []) {
      terms.add(token);
    }

    for (const token of chineseNgrams(normalized)) {
      terms.add(token);
    }
  }

  return [...terms];
}

function chineseNgrams(value: string): string[] {
  const grams = new Set<string>();
  for (const sequence of value.match(/[\u3400-\u9fff]+/gu) ?? []) {
    for (let size = 2; size <= 4; size += 1) {
      if (sequence.length < size) {
        continue;
      }

      for (let index = 0; index <= sequence.length - size; index += 1) {
        grams.add(sequence.slice(index, index + size));
      }
    }
  }
  return [...grams];
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeLookupKey(value: string): string {
  return normalizeText(
    value
      .replace(/\\/g, "/")
      .replace(/^\.\//u, "")
      .replace(/\.md(?=#|$)/iu, ""),
  );
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLocaleLowerCase();
    if (!trimmed || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(trimmed);
  }

  return unique;
}

function documentNodeId(path: string): string {
  return `markdown:${path}`;
}

function sectionNodeId(path: string, anchor: string): string {
  return `markdown:${path}#${anchor}`;
}

function edgeId(edge: Omit<MarkdownGraphEdge, "id">): string {
  return [
    "edge",
    edge.fromNodeId,
    edge.toNodeId,
    edge.relation,
    edge.source,
    edge.rawTarget ?? "",
  ].join(":");
}

function withoutMarkdownExtension(path: string): string {
  return path.replace(/\.md$/iu, "");
}

function fileTitle(path: string): string {
  const withoutExtension = withoutMarkdownExtension(path);
  return withoutExtension.split("/").at(-1) ?? withoutExtension;
}

function firstHeadingTitle(body: string): string | undefined {
  const heading = body.match(/^#{1,6}\s+(.+?)\s*#*\s*$/mu);
  return heading ? cleanHeadingTitle(heading[1] ?? "") : undefined;
}

function cleanHeadingTitle(value: string): string {
  return value.replace(/\s+#*$/u, "").trim();
}

function relationWeight(relation: MarkdownGraphEdgeRelation): number {
  switch (relation) {
    case "contains":
      return 0.84;
    case "wiki_link":
      return 0.78;
    case "frontmatter_link":
      return 0.86;
    case "next_section":
      return 0.56;
    case "supports":
      return 0.82;
    case "contradicts":
      return 0.74;
    case "elaborates":
      return 0.72;
    case "same_goal":
      return 0.86;
    case "same_entity":
      return 0.84;
    case "temporal_neighbor":
      return 0.58;
    case "derived_from":
      return 0.76;
    case "reinforces":
      return 0.8;
    case "supersedes":
      return 0.28;
  }
}

function depthDecay(depth: number): number {
  return 0.72 ** depth;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-");
}
