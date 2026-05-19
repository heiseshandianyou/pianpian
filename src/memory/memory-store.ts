import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseMarkdown, renderMarkdown } from "../vault/markdown-memory-vault.js";
import type { MarkdownFrontmatter } from "../vault/types.js";
import { createId, nowIso } from "../utils/id.js";
import type {
  EntityKind,
  EntityRecord,
  ForgettingPolicy,
  ForgettingReport,
  MemoryCorrectionPlan,
  MemoryCorrectionReport,
  MemoryEdgeRecord,
  MemoryEntityLink,
  MemoryFormationPlan,
  MemoryRecord,
  MemoryRelation,
  NewEntity,
  NewMemory,
  NewMemoryEdge,
  NewMemoryEntityLink,
  ToolContext,
} from "../types.js";

interface GraphState {
  edges: MemoryEdgeRecord[];
  entities: EntityRecord[];
  memoryEntityLinks: MemoryEntityLink[];
}

interface MemoryFileEntry {
  record: MemoryRecord;
  path: string;
}

const graphStateFile = "graph/state.json";

export class MemoryStore {
  private readonly root: string;
  private readonly memories = new Map<string, MemoryFileEntry>();
  private graph: GraphState = {
    edges: [],
    entities: [],
    memoryEntityLinks: [],
  };

  constructor(inputPath = "data/memory-vault") {
    this.root = resolveMemoryRoot(inputPath);
    mkdirSync(this.root, { recursive: true });
    mkdirSync(path.join(this.root, "graph"), { recursive: true });
    this.loadFromDisk();
  }

  add(memory: NewMemory): MemoryRecord {
    const duplicate = this.findExactActiveDuplicate(memory);
    if (duplicate) {
      return this.reinforceExactDuplicate(duplicate, memory);
    }

    const id = createId("mem");
    const createdAt = nowIso();
    const sourcePath = memory.sourcePath ?? memoryPathFor(memory, id);
    const record: MemoryRecord = {
      id,
      kind: memory.kind,
      text: memory.text,
      importance: memory.importance,
      confidence: memory.confidence ?? 1,
      tags: memory.tags ?? [],
      createdAt,
      lastAccessedAt: createdAt,
      accessCount: 0,
      pinned: memory.pinned ?? false,
      status: "active",
      storageKind: "markdown",
      sourcePath,
      sourceAnchor: memory.sourceAnchor,
    };

    this.saveMemory(record, sourcePath);
    return record;
  }

  applyFormation(plan: MemoryFormationPlan): {
    nodes: MemoryRecord[];
    edges: MemoryEdgeRecord[];
    entities: EntityRecord[];
    memoryEntityLinks: MemoryEntityLink[];
  } {
    const localToMemory = new Map<string, MemoryRecord>();
    const localToEntity = new Map<string, EntityRecord>();
    const edges: MemoryEdgeRecord[] = [];
    const memoryEntityLinks: MemoryEntityLink[] = [];

    for (const node of plan.nodes) {
      localToMemory.set(node.localId, this.add(node));
    }

    for (const entity of plan.entities ?? []) {
      localToEntity.set(entity.localId, this.upsertEntity(entity));
    }

    for (const edge of plan.edges) {
      const resolved = this.resolveFormationEdge(edge, localToMemory);
      if (resolved) {
        edges.push(this.addEdge(resolved));
      }
    }

    for (const link of plan.memoryEntityLinks ?? []) {
      const resolved = this.resolveMemoryEntityLink(link, localToMemory, localToEntity);
      if (resolved) {
        memoryEntityLinks.push(this.addMemoryEntityLink(resolved));
      }
    }

    return {
      nodes: [...localToMemory.values()],
      edges,
      entities: [...localToEntity.values()],
      memoryEntityLinks,
    };
  }

  upsertEntity(entity: NewEntity): EntityRecord {
    const now = nowIso();
    const existing = this.graph.entities.find((item) => item.kind === entity.kind && item.name === entity.name);
    if (existing) {
      existing.aliases = mergeStrings(existing.aliases, entity.aliases ?? []);
      existing.lastSeenAt = now;
      existing.confidence = Math.max(existing.confidence, entity.confidence ?? 1);
      this.saveGraph();
      return { ...existing, aliases: [...existing.aliases] };
    }

    const record: EntityRecord = {
      id: createId("ent"),
      kind: entity.kind,
      name: entity.name,
      aliases: entity.aliases ?? [],
      createdAt: now,
      lastSeenAt: now,
      confidence: entity.confidence ?? 1,
    };
    this.graph.entities.push(record);
    this.saveGraph();
    return { ...record, aliases: [...record.aliases] };
  }

  addMemoryEntityLink(link: MemoryEntityLink): MemoryEntityLink {
    const existing = this.graph.memoryEntityLinks.find(
      (item) => item.memoryId === link.memoryId && item.entityId === link.entityId && item.relation === link.relation,
    );
    if (existing) {
      existing.confidence = Math.max(existing.confidence, link.confidence);
    } else {
      this.graph.memoryEntityLinks.push({ ...link });
    }
    this.saveGraph();
    return { ...link };
  }

  listEntities(limit = 100): EntityRecord[] {
    return this.graph.entities
      .slice()
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
      .slice(0, limit)
      .map(cloneEntity);
  }

  listMemoryEntityLinks(limit = 100): MemoryEntityLink[] {
    return this.graph.memoryEntityLinks.slice(0, limit).map((link) => ({ ...link }));
  }

  findEntitiesMentionedInText(text: string, limit = 8): EntityRecord[] {
    const normalized = normalizeForMatch(text);
    if (!normalized) {
      return [];
    }

    return this.graph.entities
      .map((entity) => {
        const terms = [entity.name, ...entity.aliases].map(normalizeForMatch).filter(Boolean);
        const bestTerm = terms.find((term) => normalized.includes(term));
        return {
          entity,
          score: bestTerm ? bestTerm.length + entity.confidence * 10 : 0,
        };
      })
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((match) => cloneEntity(match.entity));
  }

  listActiveMemoriesForEntityIds(entityIds: string[], limit = 12): MemoryRecord[] {
    const ids = new Set(entityIds);
    const memoryIds = this.graph.memoryEntityLinks
      .filter((link) => ids.has(link.entityId))
      .sort((left, right) => right.confidence - left.confidence)
      .map((link) => link.memoryId);
    const records = this.getByIds([...new Set(memoryIds)]).slice(0, limit);
    this.touch(records.map((memory) => memory.id));
    return records;
  }

  listMemoryEntityLinksForEntityIds(entityIds: string[], limit = 100): MemoryEntityLink[] {
    const ids = new Set(entityIds);
    return this.graph.memoryEntityLinks
      .filter((link) => ids.has(link.entityId))
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, limit)
      .map((link) => ({ ...link }));
  }

  listMemoryEntityLinksForMemoryIds(memoryIds: string[], limit = 100): MemoryEntityLink[] {
    const ids = new Set(memoryIds);
    return this.graph.memoryEntityLinks
      .filter((link) => ids.has(link.memoryId))
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, limit)
      .map((link) => ({ ...link }));
  }

  getEntitiesByIds(entityIds: string[]): EntityRecord[] {
    const ids = new Set(entityIds);
    return this.graph.entities.filter((entity) => ids.has(entity.id)).map(cloneEntity);
  }

  addEdge(edge: {
    fromMemoryId: string;
    toMemoryId: string;
    relation: MemoryRelation;
    strength: number;
    confidence?: number;
  }): MemoryEdgeRecord {
    const now = nowIso();
    const existing = this.graph.edges.find(
      (item) => item.fromMemoryId === edge.fromMemoryId && item.toMemoryId === edge.toMemoryId && item.relation === edge.relation,
    );
    if (existing) {
      existing.strength = Math.min(1, existing.strength + edge.strength * 0.2);
      existing.confidence = Math.max(existing.confidence, edge.confidence ?? 1);
      existing.lastReinforcedAt = now;
      this.saveGraph();
      return { ...existing };
    }

    const record: MemoryEdgeRecord = {
      id: createId("edge"),
      fromMemoryId: edge.fromMemoryId,
      toMemoryId: edge.toMemoryId,
      relation: edge.relation,
      strength: edge.strength,
      confidence: edge.confidence ?? 1,
      createdAt: now,
      lastReinforcedAt: now,
    };
    this.graph.edges.push(record);
    this.saveGraph();
    return { ...record };
  }

  listEdges(limit = 100): MemoryEdgeRecord[] {
    return this.graph.edges
      .slice()
      .sort((left, right) => right.lastReinforcedAt.localeCompare(left.lastReinforcedAt))
      .slice(0, limit)
      .map((edge) => ({ ...edge }));
  }

  retrieve(query: string, limit = 8): MemoryRecord[] {
    const terms = queryTerms(query);
    const scored = this.listActive(5_000)
      .map((memory) => ({ memory, score: memoryScore(memory, terms) }))
      .filter((item) => query.trim().length === 0 || item.score > 0)
      .sort((left, right) => right.score - left.score || memoryStrength(right.memory) - memoryStrength(left.memory))
      .slice(0, limit)
      .map((item) => item.memory);
    this.touch(scored.map((memory) => memory.id));
    return scored;
  }

  getByIds(ids: string[]): MemoryRecord[] {
    const wanted = new Set(ids);
    return [...this.memories.values()]
      .filter((entry) => wanted.has(entry.record.id) && entry.record.status === "active")
      .map((entry) => cloneMemory(entry.record));
  }

  listEdgesForMemoryIds(ids: string[]): MemoryEdgeRecord[] {
    const wanted = new Set(ids);
    return this.graph.edges
      .filter((edge) => wanted.has(edge.fromMemoryId) || wanted.has(edge.toMemoryId))
      .sort((left, right) => right.strength - left.strength || right.lastReinforcedAt.localeCompare(left.lastReinforcedAt))
      .map((edge) => ({ ...edge }));
  }

  list(limit = 50): MemoryRecord[] {
    return [...this.memories.values()]
      .map((entry) => entry.record)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map(cloneMemory);
  }

  listActive(limit = 1_000): MemoryRecord[] {
    return [...this.memories.values()]
      .map((entry) => entry.record)
      .filter((memory) => memory.status === "active")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map(cloneMemory);
  }

  listPinnedActive(limit = 50): MemoryRecord[] {
    return [...this.memories.values()]
      .map((entry) => entry.record)
      .filter((memory) => memory.status === "active" && memory.pinned)
      .sort((left, right) => memoryStrength(right) - memoryStrength(left))
      .slice(0, limit)
      .map(cloneMemory);
  }

  stats(): NonNullable<ToolContext["memory"]> {
    const records = [...this.memories.values()].map((entry) => entry.record);
    return {
      total: records.length,
      active: records.filter((memory) => memory.status === "active").length,
      archived: records.filter((memory) => memory.status === "archived").length,
      pinned: records.filter((memory) => memory.status === "active" && memory.pinned).length,
    };
  }

  archiveByIds(ids: string[], archivedAt = nowIso()): number {
    return this.archiveByIdsDetailed(ids, archivedAt).changed;
  }

  archiveByIdsDetailed(ids: string[], archivedAt = nowIso()): { changed: number; memories: MemoryRecord[] } {
    const wanted = new Set(ids);
    const changed: MemoryRecord[] = [];
    for (const entry of this.memories.values()) {
      if (!wanted.has(entry.record.id) || entry.record.status !== "active") {
        continue;
      }
      entry.record.status = "archived";
      entry.record.archivedAt = archivedAt;
      this.saveMemory(entry.record, entry.path);
      changed.push(cloneMemory(entry.record));
    }
    return { changed: changed.length, memories: changed };
  }

  applyCorrection(plan: MemoryCorrectionPlan): MemoryCorrectionReport {
    return this.applyCorrectionDetailed(plan).report;
  }

  applyCorrectionDetailed(plan: MemoryCorrectionPlan): { report: MemoryCorrectionReport; memories: MemoryRecord[] } {
    const ids = [...new Set(plan.targetMemoryIds)];
    let changed = 0;
    let memories: MemoryRecord[] = [];
    if (plan.operation === "archive") {
      const result = this.archiveByIdsDetailed(ids);
      changed = result.changed;
      memories = result.memories;
    } else if (plan.operation === "pin" || plan.operation === "unpin") {
      const result = this.updatePinnedDetailed(ids, plan.operation === "pin");
      changed = result.changed;
      memories = result.memories;
    } else if (plan.operation === "reinforce") {
      const result = this.adjustMemoryStrengthDetailed(ids, 1, 0.08);
      changed = result.changed;
      memories = result.memories;
    } else if (plan.operation === "downgrade") {
      const result = this.adjustMemoryStrengthDetailed(ids, -1, -0.18);
      changed = result.changed;
      memories = result.memories;
    }

    return {
      report: {
        operation: plan.operation,
        requested: ids.length,
        changed,
        changedMemoryIds: memories.map((memory) => memory.id),
        reason: plan.reason,
      },
      memories,
    };
  }

  applyForgetting(policy: ForgettingPolicy, now = new Date()): ForgettingReport {
    return this.applyForgettingDetailed(policy, now).report;
  }

  applyForgettingDetailed(policy: ForgettingPolicy, now = new Date()): { report: ForgettingReport; archivedMemories: MemoryRecord[] } {
    const active = this.listActive(5_000);
    const archived: MemoryRecord[] = [];
    let preserved = 0;
    for (const memory of active) {
      const score = forgettingScore(memory, policy, now);
      const shouldPreserve =
        memory.pinned ||
        policy.preserveKinds.includes(memory.kind) ||
        ageDays(memory.createdAt, now) < policy.minAgeDays ||
        score >= policy.archiveBelowScore;
      if (shouldPreserve) {
        preserved += 1;
        continue;
      }
      archived.push(...this.archiveByIdsDetailed([memory.id]).memories);
    }
    return {
      report: {
        scanned: active.length,
        archived: archived.length,
        preserved,
        archivedMemoryIds: archived.map((memory) => memory.id),
      },
      archivedMemories: archived,
    };
  }

  close(): void {
    this.saveGraph();
  }

  private loadFromDisk(): void {
    this.memories.clear();
    for (const filePath of collectMarkdownFiles(this.root)) {
      if (relativePosix(this.root, filePath).startsWith("graph/")) {
        continue;
      }
      const markdown = readFileSync(filePath, "utf8");
      const parsed = parseMarkdown(markdown);
      const record = memoryFromMarkdown(parsed.frontmatter, parsed.body, relativePosix(this.root, filePath));
      if (record) {
        this.memories.set(record.id, { record, path: relativePosix(this.root, filePath) });
      }
    }
    this.graph = loadGraphState(this.root);
  }

  private saveMemory(record: MemoryRecord, sourcePath: string): void {
    const safePath = normalizeRelativeMarkdownPath(sourcePath);
    const absolutePath = path.join(this.root, safePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    const body = record.text.includes("\n") ? record.text : `${record.text}\n`;
    writeFileSync(absolutePath, renderMarkdown(body, frontmatterForMemory(record)), "utf8");
    this.memories.set(record.id, { record: cloneMemory(record), path: safePath });
  }

  private saveGraph(): void {
    writeJson(path.join(this.root, graphStateFile), this.graph);
  }

  private findExactActiveDuplicate(memory: NewMemory): MemoryRecord | undefined {
    return [...this.memories.values()]
      .map((entry) => entry.record)
      .filter((record) => record.status === "active" && record.kind === memory.kind && record.text === memory.text)
      .sort((left, right) => memoryStrength(right) - memoryStrength(left))[0];
  }

  private reinforceExactDuplicate(existing: MemoryRecord, incoming: NewMemory): MemoryRecord {
    const entry = this.memories.get(existing.id);
    if (!entry) {
      return existing;
    }
    const now = nowIso();
    entry.record.importance = Math.max(existing.importance, incoming.importance) as MemoryRecord["importance"];
    entry.record.confidence = Math.max(existing.confidence, incoming.confidence ?? existing.confidence);
    entry.record.tags = mergeStrings(existing.tags, incoming.tags ?? []);
    entry.record.lastAccessedAt = now;
    entry.record.accessCount += 1;
    entry.record.pinned = existing.pinned || incoming.pinned === true;
    entry.record.sourceAnchor = existing.sourceAnchor ?? incoming.sourceAnchor;
    this.saveMemory(entry.record, entry.path);
    return cloneMemory(entry.record);
  }

  private resolveFormationEdge(
    edge: NewMemoryEdge,
    localToMemory: Map<string, MemoryRecord>,
  ): { fromMemoryId: string; toMemoryId: string; relation: MemoryRelation; strength: number; confidence?: number } | undefined {
    const fromMemoryId = edge.fromMemoryId ?? localToMemory.get(edge.fromLocalId ?? "")?.id;
    const toMemoryId = edge.toMemoryId ?? localToMemory.get(edge.toLocalId ?? "")?.id;
    if (!fromMemoryId || !toMemoryId) {
      return undefined;
    }
    return { fromMemoryId, toMemoryId, relation: edge.relation, strength: edge.strength, confidence: edge.confidence };
  }

  private resolveMemoryEntityLink(
    link: NewMemoryEntityLink,
    localToMemory: Map<string, MemoryRecord>,
    localToEntity: Map<string, EntityRecord>,
  ): MemoryEntityLink | undefined {
    const memoryId = link.memoryId ?? localToMemory.get(link.memoryLocalId ?? "")?.id;
    const entityId = link.entityId ?? localToEntity.get(link.entityLocalId ?? "")?.id;
    if (!memoryId || !entityId) {
      return undefined;
    }
    return { memoryId, entityId, relation: link.relation, confidence: link.confidence ?? 1 };
  }

  private touch(ids: string[]): void {
    for (const id of ids) {
      const entry = this.memories.get(id);
      if (!entry) {
        continue;
      }
      entry.record.lastAccessedAt = nowIso();
      entry.record.accessCount += 1;
      this.saveMemory(entry.record, entry.path);
    }
  }

  private updatePinnedDetailed(ids: string[], pinned: boolean): { changed: number; memories: MemoryRecord[] } {
    const wanted = new Set(ids);
    const changed: MemoryRecord[] = [];
    for (const entry of this.memories.values()) {
      if (!wanted.has(entry.record.id) || entry.record.status !== "active" || entry.record.pinned === pinned) {
        continue;
      }
      entry.record.pinned = pinned;
      this.saveMemory(entry.record, entry.path);
      changed.push(cloneMemory(entry.record));
    }
    return { changed: changed.length, memories: changed };
  }

  private adjustMemoryStrengthDetailed(
    ids: string[],
    importanceDelta: number,
    confidenceDelta: number,
  ): { changed: number; memories: MemoryRecord[] } {
    const wanted = new Set(ids);
    const changed: MemoryRecord[] = [];
    for (const entry of this.memories.values()) {
      if (!wanted.has(entry.record.id) || entry.record.status !== "active") {
        continue;
      }
      entry.record.importance = clampImportance(entry.record.importance + importanceDelta);
      entry.record.confidence = clamp(entry.record.confidence + confidenceDelta, 0.05, 1);
      this.saveMemory(entry.record, entry.path);
      changed.push(cloneMemory(entry.record));
    }
    return { changed: changed.length, memories: changed };
  }
}

function resolveMemoryRoot(inputPath: string): string {
  if (inputPath === ":memory:") {
    return mkdtempSync(path.join(tmpdir(), "pianpian-memory-vault-"));
  }
  const normalized = inputPath.replace(/\\/g, "/");
  if (normalized.endsWith("data/memory-vault")) {
    return path.resolve(process.env.PIANPIAN_MEMORY_VAULT_PATH ?? "data/memory-vault");
  }
  return path.resolve(inputPath);
}

function memoryPathFor(memory: NewMemory, id: string): string {
  const directory = directoryForKind(memory.kind);
  const title = titleForMemory(memory);
  return `${directory}/${slugify(title) || id}.md`;
}

function directoryForKind(kind: MemoryRecord["kind"]): string {
  if (kind === "relationship") return "relationships";
  if (kind === "preference") return "preferences";
  if (kind === "self_model") return "people";
  if (kind === "goal") return "goals";
  if (kind === "procedure") return "procedures";
  if (kind === "reflection") return "reflections";
  return "memories";
}

function titleForMemory(memory: NewMemory): string {
  return `${memory.kind}-${memory.tags?.[0] ?? "memory"}-${memory.text.slice(0, 42)}`;
}

function frontmatterForMemory(memory: MemoryRecord): MarkdownFrontmatter {
  return {
    id: memory.id,
    type: "memory",
    kind: memory.kind,
    importance: memory.importance,
    confidence: memory.confidence,
    tags: memory.tags,
    created_at: memory.createdAt,
    updated_at: memory.lastAccessedAt,
    access_count: memory.accessCount,
    pinned: memory.pinned,
    status: memory.status,
    storage_kind: "markdown",
    source_path: memory.sourcePath ?? null,
    source_anchor: memory.sourceAnchor ?? null,
    archived_at: memory.archivedAt ?? null,
  };
}

function memoryFromMarkdown(frontmatter: Record<string, unknown>, body: string, sourcePath: string): MemoryRecord | undefined {
  const id = stringValue(frontmatter.id) ?? firstString(frontmatter.memory_ids) ?? stringValue(frontmatter.vault_id);
  const kind = memoryKind(stringValue(frontmatter.kind));
  if (!id || !kind) {
    return undefined;
  }
  const createdAt = stringValue(frontmatter.created_at) ?? nowIso();
  const updatedAt = stringValue(frontmatter.updated_at) ?? createdAt;
  return {
    id,
    kind,
    text: cleanBodyText(body),
    importance: clampImportance(numberValue(frontmatter.importance) ?? 3),
    confidence: clamp(numberValue(frontmatter.confidence) ?? 0.85, 0, 1),
    tags: stringArray(frontmatter.tags),
    createdAt,
    lastAccessedAt: updatedAt,
    accessCount: numberValue(frontmatter.access_count) ?? 0,
    pinned: booleanValue(frontmatter.pinned) ?? false,
    status: statusValue(frontmatter.status) ?? statusValue(frontmatter.memory_status) ?? "active",
    storageKind: "markdown",
    sourcePath: stringValue(frontmatter.source_path) ?? sourcePath,
    sourceAnchor: stringValue(frontmatter.source_anchor) ?? stringValue(frontmatter.anchor),
    archivedAt: stringValue(frontmatter.archived_at),
  };
}

function cleanBodyText(body: string): string {
  return body
    .replace(/<a\s+[^>]*id=["'][^"']+["'][^>]*>\s*<\/a>/giu, "")
    .split(/\r?\n/)
    .filter((line) => !/^#+\s+/.test(line.trim()) && !/^Kind:\s/u.test(line.trim()))
    .join("\n")
    .trim();
}

function loadGraphState(root: string): GraphState {
  const target = path.join(root, graphStateFile);
  if (!existsSync(target)) {
    return { edges: [], entities: [], memoryEntityLinks: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(target, "utf8")) as Partial<GraphState>;
    return {
      edges: Array.isArray(parsed.edges) ? parsed.edges.filter(isMemoryEdgeRecord) : [],
      entities: Array.isArray(parsed.entities) ? parsed.entities.filter(isEntityRecord) : [],
      memoryEntityLinks: Array.isArray(parsed.memoryEntityLinks) ? parsed.memoryEntityLinks.filter(isMemoryEntityLink) : [],
    };
  } catch {
    return { edges: [], entities: [], memoryEntityLinks: [] };
  }
}

function collectMarkdownFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(absolutePath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(absolutePath);
    }
  }
  return files;
}

function writeJson(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeRelativeMarkdownPath(input: string): string {
  const normalized = input.replace(/\\/g, "/").replace(/^\/+/, "");
  const withExtension = normalized.toLowerCase().endsWith(".md") ? normalized : `${normalized}.md`;
  const safe = path.posix.normalize(withExtension);
  if (safe === ".." || safe.startsWith("../")) {
    throw new Error(`Memory path escapes vault root: ${input}`);
  }
  return safe;
}

function relativePosix(root: string, filePath: string): string {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function cloneMemory(memory: MemoryRecord): MemoryRecord {
  return { ...memory, tags: [...memory.tags] };
}

function cloneEntity(entity: EntityRecord): EntityRecord {
  return { ...entity, aliases: [...entity.aliases] };
}

function queryTerms(query: string): string[] {
  const normalized = normalizeForMatch(query);
  const terms = new Set<string>();
  if (normalized) terms.add(normalized);
  for (const token of normalized.match(/[\p{L}\p{N}_-]{2,}/gu) ?? []) {
    terms.add(token);
  }
  for (const sequence of normalized.match(/[\u3400-\u9fff]+/gu) ?? []) {
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= sequence.length - size; index += 1) {
        terms.add(sequence.slice(index, index + size));
      }
    }
  }
  return [...terms];
}

function memoryScore(memory: MemoryRecord, terms: string[]): number {
  if (terms.length === 0) {
    return memoryStrength(memory);
  }
  const haystack = normalizeForMatch(`${memory.text} ${memory.tags.join(" ")} ${memory.kind} ${memory.sourcePath ?? ""}`);
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += Math.min(0.5, 0.08 + term.length / 60);
    }
  }
  return score + memory.importance * 0.02 + (memory.pinned ? 0.2 : 0);
}

function memoryStrength(memory: MemoryRecord): number {
  return memory.importance * 0.35 + memory.confidence * 2 + Math.min(memory.accessCount, 10) * 0.1 + (memory.pinned ? 2 : 0);
}

function forgettingScore(memory: MemoryRecord, policy: ForgettingPolicy, now: Date): number {
  const lastUsedAge = ageDays(memory.lastAccessedAt, now);
  const decay = Math.pow(0.5, lastUsedAge / policy.halfLifeDays);
  const importance = memory.importance / 5;
  const reuse = Math.min(memory.accessCount / 10, 1);
  return 0.45 * importance + 0.25 * memory.confidence + 0.2 * decay + 0.1 * reuse;
}

function ageDays(iso: string, now: Date): number {
  return Math.max(0, (now.getTime() - new Date(iso).getTime()) / 86_400_000);
}

function mergeStrings(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming].filter(Boolean))];
}

function normalizeForMatch(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "")
    .slice(0, 88);
}

function memoryKind(value: string | undefined): MemoryRecord["kind"] | undefined {
  if (
    value === "episode" ||
    value === "semantic" ||
    value === "goal" ||
    value === "preference" ||
    value === "reflection" ||
    value === "self_model" ||
    value === "procedure" ||
    value === "relationship"
  ) {
    return value;
  }
  return undefined;
}

function statusValue(value: unknown): MemoryRecord["status"] | undefined {
  return value === "active" || value === "archived" ? value : undefined;
}

function clampImportance(value: number): MemoryRecord["importance"] {
  return Math.max(1, Math.min(5, Math.round(value))) as MemoryRecord["importance"];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function firstString(value: unknown): string | undefined {
  return Array.isArray(value) ? value.find((item): item is string => typeof item === "string") : undefined;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function isMemoryEdgeRecord(value: unknown): value is MemoryEdgeRecord {
  return Boolean(value) && typeof value === "object" && typeof (value as MemoryEdgeRecord).id === "string";
}

function isEntityRecord(value: unknown): value is EntityRecord {
  return Boolean(value) && typeof value === "object" && typeof (value as EntityRecord).id === "string";
}

function isMemoryEntityLink(value: unknown): value is MemoryEntityLink {
  return Boolean(value) && typeof value === "object" && typeof (value as MemoryEntityLink).memoryId === "string";
}
