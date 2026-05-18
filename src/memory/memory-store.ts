import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createId, nowIso } from "../utils/id.js";
import type {
  EntityKind,
  EntityRecord,
  ForgettingPolicy,
  ForgettingReport,
  MemoryEdgeRecord,
  MemoryEntityLink,
  MemoryCorrectionPlan,
  MemoryCorrectionReport,
  MemoryFormationPlan,
  MemoryKind,
  MemoryRecord,
  MemoryRelation,
  NewMemory,
  NewEntity,
  NewMemoryEdge,
  NewMemoryEntityLink,
  ToolContext,
} from "../types.js";

interface MemoryRow {
  id: string;
  kind: MemoryKind;
  text: string;
  importance: number;
  confidence: number;
  tags_json: string;
  created_at: string;
  last_accessed_at: string;
  access_count: number;
  pinned: number;
  status: "active" | "archived";
  storage_kind: "sqlite" | "markdown";
  source_path: string | null;
  source_anchor: string | null;
  archived_at: string | null;
}

interface MemoryEdgeRow {
  id: string;
  from_memory_id: string;
  to_memory_id: string;
  relation: MemoryRelation;
  strength: number;
  confidence: number;
  created_at: string;
  last_reinforced_at: string;
}

interface EntityRow {
  id: string;
  kind: EntityKind;
  name: string;
  aliases_json: string;
  created_at: string;
  last_seen_at: string;
  confidence: number;
}

interface MemoryEntityRow {
  memory_id: string;
  entity_id: string;
  relation: MemoryEntityLink["relation"];
  confidence: number;
}

export class MemoryStore {
  private readonly db: Database.Database;

  constructor(path = "data/pianpian-memory.sqlite") {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    try {
      this.db.pragma("journal_mode = WAL");
    } catch {
      this.db.pragma("journal_mode = DELETE");
    }
    this.db.exec(`
      create table if not exists memories (
        id text primary key,
        kind text not null,
        text text not null,
        importance integer not null,
        confidence real not null default 1.0,
        tags_json text not null,
        created_at text not null,
        last_accessed_at text not null,
        access_count integer not null default 0,
        pinned integer not null default 0,
        status text not null default 'active',
        storage_kind text not null default 'sqlite',
        source_path text,
        source_anchor text,
        archived_at text
      );

      create virtual table if not exists memory_fts using fts5(
        id unindexed,
        text,
        tags
      );

      create table if not exists memory_edges (
        id text primary key,
        from_memory_id text not null,
        to_memory_id text not null,
        relation text not null,
        strength real not null,
        confidence real not null default 1.0,
        created_at text not null,
        last_reinforced_at text not null,
        unique(from_memory_id, to_memory_id, relation)
      );

      create table if not exists entities (
        id text primary key,
        kind text not null,
        name text not null,
        aliases_json text not null,
        created_at text not null,
        last_seen_at text not null,
        confidence real not null default 1.0,
        unique(kind, name)
      );

      create table if not exists memory_entities (
        memory_id text not null,
        entity_id text not null,
        relation text not null,
        confidence real not null default 1.0,
        primary key(memory_id, entity_id, relation)
      );
    `);
    this.migrate();
  }

  add(memory: NewMemory): MemoryRecord {
    const id = createId("mem");
    const createdAt = nowIso();
    const tags = memory.tags ?? [];

    this.db
      .prepare(
        `insert into memories
          (id, kind, text, importance, confidence, tags_json, created_at, last_accessed_at, access_count, pinned, status, storage_kind, source_path, source_anchor)
         values
          (@id, @kind, @text, @importance, @confidence, @tagsJson, @createdAt, @createdAt, 0, @pinned, 'active', @storageKind, @sourcePath, @sourceAnchor)`,
      )
      .run({
        id,
        kind: memory.kind,
        text: memory.text,
        importance: memory.importance,
        confidence: memory.confidence ?? 1,
        tagsJson: JSON.stringify(tags),
        createdAt,
        pinned: memory.pinned ? 1 : 0,
        storageKind: memory.storageKind ?? "sqlite",
        sourcePath: memory.sourcePath ?? null,
        sourceAnchor: memory.sourceAnchor ?? null,
      });

    this.db
      .prepare("insert into memory_fts (id, text, tags) values (?, ?, ?)")
      .run(id, memory.text, tags.join(" "));

    return {
      id,
      kind: memory.kind,
      text: memory.text,
      importance: memory.importance,
      confidence: memory.confidence ?? 1,
      tags,
      createdAt,
      lastAccessedAt: createdAt,
      accessCount: 0,
      pinned: memory.pinned ?? false,
      status: "active",
      storageKind: memory.storageKind ?? "sqlite",
      sourcePath: memory.sourcePath,
      sourceAnchor: memory.sourceAnchor,
    };
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

    const transaction = this.db.transaction(() => {
      for (const node of plan.nodes) {
        localToMemory.set(node.localId, this.add(node));
      }

      for (const entity of plan.entities ?? []) {
        localToEntity.set(entity.localId, this.upsertEntity(entity));
      }

      for (const edge of plan.edges) {
        const resolved = this.resolveFormationEdge(edge, localToMemory);
        if (!resolved) {
          continue;
        }
        edges.push(this.addEdge(resolved));
      }

      for (const link of plan.memoryEntityLinks ?? []) {
        const resolved = this.resolveMemoryEntityLink(link, localToMemory, localToEntity);
        if (!resolved) {
          continue;
        }
        memoryEntityLinks.push(this.addMemoryEntityLink(resolved));
      }
    });

    transaction();
    return {
      nodes: [...localToMemory.values()],
      edges,
      entities: [...localToEntity.values()],
      memoryEntityLinks,
    };
  }

  upsertEntity(entity: NewEntity): EntityRecord {
    const now = nowIso();
    const existing = this.db
      .prepare("select * from entities where kind = ? and name = ?")
      .get(entity.kind, entity.name) as EntityRow | undefined;

    if (existing) {
      const aliases = mergeAliases(JSON.parse(existing.aliases_json) as string[], entity.aliases ?? []);
      const confidence = Math.max(existing.confidence, entity.confidence ?? 1);
      this.db
        .prepare(
          `update entities
           set aliases_json = ?, last_seen_at = ?, confidence = ?
           where id = ?`,
        )
        .run(JSON.stringify(aliases), now, confidence, existing.id);
      return toEntityRecord({
        ...existing,
        aliases_json: JSON.stringify(aliases),
        last_seen_at: now,
        confidence,
      });
    }

    const id = createId("ent");
    const aliases = entity.aliases ?? [];
    this.db
      .prepare(
        `insert into entities
          (id, kind, name, aliases_json, created_at, last_seen_at, confidence)
         values
          (@id, @kind, @name, @aliasesJson, @now, @now, @confidence)`,
      )
      .run({
        id,
        kind: entity.kind,
        name: entity.name,
        aliasesJson: JSON.stringify(aliases),
        now,
        confidence: entity.confidence ?? 1,
      });

    return {
      id,
      kind: entity.kind,
      name: entity.name,
      aliases,
      createdAt: now,
      lastSeenAt: now,
      confidence: entity.confidence ?? 1,
    };
  }

  addMemoryEntityLink(link: MemoryEntityLink): MemoryEntityLink {
    this.db
      .prepare(
        `insert into memory_entities
          (memory_id, entity_id, relation, confidence)
         values (?, ?, ?, ?)
         on conflict(memory_id, entity_id, relation)
         do update set confidence = max(confidence, excluded.confidence)`,
      )
      .run(link.memoryId, link.entityId, link.relation, link.confidence);
    return link;
  }

  listEntities(limit = 100): EntityRecord[] {
    const rows = this.db
      .prepare("select * from entities order by last_seen_at desc limit ?")
      .all(limit) as EntityRow[];
    return rows.map(toEntityRecord);
  }

  listMemoryEntityLinks(limit = 100): MemoryEntityLink[] {
    const rows = this.db
      .prepare("select * from memory_entities limit ?")
      .all(limit) as MemoryEntityRow[];
    return rows.map(toMemoryEntityLink);
  }

  findEntitiesMentionedInText(text: string, limit = 8): EntityRecord[] {
    const normalized = normalizeForMatch(text);
    if (normalized.length === 0) {
      return [];
    }

    const matches = this.listEntities(1_000)
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
      .slice(0, limit);

    return matches.map((match) => match.entity);
  }

  listActiveMemoriesForEntityIds(entityIds: string[], limit = 12): MemoryRecord[] {
    if (entityIds.length === 0) {
      return [];
    }

    const placeholders = entityIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `select distinct memories.*
         from memory_entities
         join memories on memories.id = memory_entities.memory_id
         where memory_entities.entity_id in (${placeholders})
           and memories.status = 'active'
         order by memory_entities.confidence desc,
                  memories.importance desc,
                  memories.last_accessed_at desc
         limit ?`,
      )
      .all(...entityIds, limit) as MemoryRow[];
    const memories = rows.map(toMemoryRecord);
    if (memories.length > 0) {
      this.touch(memories.map((memory) => memory.id));
    }
    return memories;
  }

  listMemoryEntityLinksForEntityIds(entityIds: string[], limit = 100): MemoryEntityLink[] {
    if (entityIds.length === 0) {
      return [];
    }

    const placeholders = entityIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `select *
         from memory_entities
         where entity_id in (${placeholders})
         order by confidence desc
         limit ?`,
      )
      .all(...entityIds, limit) as MemoryEntityRow[];
    return rows.map(toMemoryEntityLink);
  }

  listMemoryEntityLinksForMemoryIds(memoryIds: string[], limit = 100): MemoryEntityLink[] {
    if (memoryIds.length === 0) {
      return [];
    }

    const placeholders = memoryIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `select *
         from memory_entities
         where memory_id in (${placeholders})
         order by confidence desc
         limit ?`,
      )
      .all(...memoryIds, limit) as MemoryEntityRow[];
    return rows.map(toMemoryEntityLink);
  }

  getEntitiesByIds(entityIds: string[]): EntityRecord[] {
    if (entityIds.length === 0) {
      return [];
    }

    const placeholders = entityIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`select * from entities where id in (${placeholders})`)
      .all(...entityIds) as EntityRow[];
    return rows.map(toEntityRecord);
  }

  addEdge(edge: {
    fromMemoryId: string;
    toMemoryId: string;
    relation: MemoryRelation;
    strength: number;
    confidence?: number;
  }): MemoryEdgeRecord {
    const now = nowIso();
    const existing = this.db
      .prepare(
        `select * from memory_edges
         where from_memory_id = ?
           and to_memory_id = ?
           and relation = ?`,
      )
      .get(edge.fromMemoryId, edge.toMemoryId, edge.relation) as MemoryEdgeRow | undefined;

    if (existing) {
      const reinforcedStrength = Math.min(1, existing.strength + edge.strength * 0.2);
      this.db
        .prepare(
          `update memory_edges
           set strength = ?, confidence = max(confidence, ?), last_reinforced_at = ?
           where id = ?`,
        )
        .run(reinforcedStrength, edge.confidence ?? 1, now, existing.id);
      return toMemoryEdgeRecord({
        ...existing,
        strength: reinforcedStrength,
        confidence: Math.max(existing.confidence, edge.confidence ?? 1),
        last_reinforced_at: now,
      });
    }

    const id = createId("edge");
    this.db
      .prepare(
        `insert into memory_edges
          (id, from_memory_id, to_memory_id, relation, strength, confidence, created_at, last_reinforced_at)
         values
          (@id, @fromMemoryId, @toMemoryId, @relation, @strength, @confidence, @now, @now)`,
      )
      .run({
        id,
        fromMemoryId: edge.fromMemoryId,
        toMemoryId: edge.toMemoryId,
        relation: edge.relation,
        strength: edge.strength,
        confidence: edge.confidence ?? 1,
        now,
      });

    return {
      id,
      fromMemoryId: edge.fromMemoryId,
      toMemoryId: edge.toMemoryId,
      relation: edge.relation,
      strength: edge.strength,
      confidence: edge.confidence ?? 1,
      createdAt: now,
      lastReinforcedAt: now,
    };
  }

  listEdges(limit = 100): MemoryEdgeRecord[] {
    const rows = this.db
      .prepare("select * from memory_edges order by last_reinforced_at desc limit ?")
      .all(limit) as MemoryEdgeRow[];
    return rows.map(toMemoryEdgeRecord);
  }

  retrieve(query: string, limit = 8): MemoryRecord[] {
    const normalized = query.trim();
    const rows =
      normalized.length === 0
        ? this.db
            .prepare(
              `select * from memories
               where status = 'active'
               order by importance desc, created_at desc
               limit ?`,
            )
            .all(limit)
        : this.db
            .prepare(
              `select memories.*
               from memory_fts
               join memories on memories.id = memory_fts.id
               where memory_fts match ?
                 and memories.status = 'active'
               order by bm25(memory_fts), memories.importance desc
               limit ?`,
            )
            .all(toFtsQuery(normalized), limit);

    const memories = (rows as MemoryRow[]).map(toMemoryRecord);
    if (memories.length > 0) {
      this.touch(memories.map((memory) => memory.id));
    }
    return memories;
  }

  getByIds(ids: string[]): MemoryRecord[] {
    if (ids.length === 0) {
      return [];
    }

    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`select * from memories where id in (${placeholders}) and status = 'active'`)
      .all(...ids) as MemoryRow[];
    return rows.map(toMemoryRecord);
  }

  listEdgesForMemoryIds(ids: string[]): MemoryEdgeRecord[] {
    if (ids.length === 0) {
      return [];
    }

    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `select * from memory_edges
         where from_memory_id in (${placeholders})
            or to_memory_id in (${placeholders})
         order by strength desc, last_reinforced_at desc`,
      )
      .all(...ids, ...ids) as MemoryEdgeRow[];
    return rows.map(toMemoryEdgeRecord);
  }

  list(limit = 50): MemoryRecord[] {
    const rows = this.db
      .prepare("select * from memories order by created_at desc limit ?")
      .all(limit) as MemoryRow[];
    return rows.map(toMemoryRecord);
  }

  listActive(limit = 1_000): MemoryRecord[] {
    const rows = this.db
      .prepare("select * from memories where status = 'active' order by created_at desc limit ?")
      .all(limit) as MemoryRow[];
    return rows.map(toMemoryRecord);
  }

  listPinnedActive(limit = 50): MemoryRecord[] {
    const rows = this.db
      .prepare(
        `select * from memories
         where status = 'active' and pinned = 1
         order by importance desc, last_accessed_at desc
         limit ?`,
      )
      .all(limit) as MemoryRow[];
    return rows.map(toMemoryRecord);
  }

  stats(): NonNullable<ToolContext["memory"]> {
    const rows = this.db
      .prepare(
        `select
          count(*) as total,
          sum(case when status = 'active' then 1 else 0 end) as active,
          sum(case when status = 'archived' then 1 else 0 end) as archived,
          sum(case when pinned = 1 and status = 'active' then 1 else 0 end) as pinned
         from memories`,
      )
      .get() as {
      total: number;
      active: number | null;
      archived: number | null;
      pinned: number | null;
    };

    return {
      total: rows.total,
      active: rows.active ?? 0,
      archived: rows.archived ?? 0,
      pinned: rows.pinned ?? 0,
    };
  }

  archiveByIds(ids: string[], archivedAt = nowIso()): number {
    return this.archiveByIdsDetailed(ids, archivedAt).changed;
  }

  archiveByIdsDetailed(ids: string[], archivedAt = nowIso()): { changed: number; memories: MemoryRecord[] } {
    if (ids.length === 0) {
      return { changed: 0, memories: [] };
    }

    const beforeById = new Map(this.getByIds(ids).map((memory) => [memory.id, memory]));
    const update = this.db.prepare(
      "update memories set status = 'archived', archived_at = ? where id = ? and status = 'active'",
    );
    let archived = 0;
    const changedIds: string[] = [];
    const transaction = this.db.transaction((memoryIds: string[]) => {
      for (const id of memoryIds) {
        const result = update.run(archivedAt, id) as { changes?: number };
        const changes = result.changes ?? 0;
        archived += changes;
        if (changes > 0) {
          changedIds.push(id);
        }
      }
    });

    transaction(ids);
    return {
      changed: archived,
      memories: changedIds.flatMap((id) => {
        const memory = beforeById.get(id);
        return memory
          ? [
              {
                ...memory,
                status: "archived" as const,
                archivedAt,
              },
            ]
          : [];
      }),
    };
  }

  applyCorrection(plan: MemoryCorrectionPlan): MemoryCorrectionReport {
    return this.applyCorrectionDetailed(plan).report;
  }

  applyCorrectionDetailed(plan: MemoryCorrectionPlan): { report: MemoryCorrectionReport; memories: MemoryRecord[] } {
    const ids = [...new Set(plan.targetMemoryIds)];
    if (ids.length === 0) {
      return {
        report: {
          operation: plan.operation,
          requested: 0,
          changed: 0,
          changedMemoryIds: [],
          reason: plan.reason,
        },
        memories: [],
      };
    }

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
    const rows = this.db
      .prepare("select * from memories where status = 'active'")
      .all() as MemoryRow[];
    const archive = this.db.prepare(
      "update memories set status = 'archived', archived_at = ? where id = ?",
    );
    const archivedAt = nowIso();
    let archived = 0;
    let preserved = 0;
    const archivedMemories: MemoryRecord[] = [];

    const transaction = this.db.transaction((memories: MemoryRow[]) => {
      for (const row of memories) {
        const memory = toMemoryRecord(row);
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

        archive.run(archivedAt, memory.id);
        archived += 1;
        archivedMemories.push({
          ...memory,
          status: "archived",
          archivedAt,
        });
      }
    });

    transaction(rows);
    return {
      report: {
        scanned: rows.length,
        archived,
        preserved,
        archivedMemoryIds: archivedMemories.map((memory) => memory.id),
      },
      archivedMemories,
    };
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const migrations = [
      "alter table memories add column confidence real not null default 1.0",
      "alter table memories add column pinned integer not null default 0",
      "alter table memories add column status text not null default 'active'",
      "alter table memories add column storage_kind text not null default 'sqlite'",
      "alter table memories add column source_path text",
      "alter table memories add column source_anchor text",
      "alter table memories add column archived_at text",
    ];

    for (const migration of migrations) {
      try {
        this.db.exec(migration);
      } catch {
        // SQLite has no simple "add column if not exists"; duplicate-column errors are harmless.
      }
    }
  }

  private resolveFormationEdge(
    edge: NewMemoryEdge,
    localToMemory: Map<string, MemoryRecord>,
  ):
    | {
        fromMemoryId: string;
        toMemoryId: string;
        relation: MemoryRelation;
        strength: number;
        confidence?: number;
      }
    | undefined {
    const fromMemoryId = edge.fromMemoryId ?? localToMemory.get(edge.fromLocalId ?? "")?.id;
    const toMemoryId = edge.toMemoryId ?? localToMemory.get(edge.toLocalId ?? "")?.id;

    if (!fromMemoryId || !toMemoryId) {
      return undefined;
    }

    return {
      fromMemoryId,
      toMemoryId,
      relation: edge.relation,
      strength: edge.strength,
      confidence: edge.confidence,
    };
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

    return {
      memoryId,
      entityId,
      relation: link.relation,
      confidence: link.confidence ?? 1,
    };
  }

  private touch(ids: string[]): void {
    const update = this.db.prepare(
      `update memories
       set last_accessed_at = ?, access_count = access_count + 1
       where id = ?`,
    );
    const touchedAt = nowIso();
    const transaction = this.db.transaction((memoryIds: string[]) => {
      for (const id of memoryIds) {
        update.run(touchedAt, id);
      }
    });
    transaction(ids);
  }

  private updatePinned(ids: string[], pinned: boolean): number {
    return this.updatePinnedDetailed(ids, pinned).changed;
  }

  private updatePinnedDetailed(ids: string[], pinned: boolean): { changed: number; memories: MemoryRecord[] } {
    const update = this.db.prepare(
      "update memories set pinned = ? where id = ? and status = 'active'",
    );
    let changed = 0;
    const changedIds: string[] = [];
    const transaction = this.db.transaction((memoryIds: string[]) => {
      for (const id of memoryIds) {
        const result = update.run(pinned ? 1 : 0, id) as { changes?: number };
        const changes = result.changes ?? 0;
        changed += changes;
        if (changes > 0) {
          changedIds.push(id);
        }
      }
    });
    transaction(ids);
    const memoriesById = new Map(this.getByIds(changedIds).map((memory) => [memory.id, memory]));
    return {
      changed,
      memories: changedIds.flatMap((id) => {
        const memory = memoriesById.get(id);
        return memory ? [memory] : [];
      }),
    };
  }

  private adjustMemoryStrength(ids: string[], importanceDelta: number, confidenceDelta: number): number {
    return this.adjustMemoryStrengthDetailed(ids, importanceDelta, confidenceDelta).changed;
  }

  private adjustMemoryStrengthDetailed(
    ids: string[],
    importanceDelta: number,
    confidenceDelta: number,
  ): { changed: number; memories: MemoryRecord[] } {
    const update = this.db.prepare(
      `update memories
       set importance = max(1, min(5, importance + ?)),
           confidence = max(0.05, min(1.0, confidence + ?))
       where id = ? and status = 'active'`,
    );
    let changed = 0;
    const changedIds: string[] = [];
    const transaction = this.db.transaction((memoryIds: string[]) => {
      for (const id of memoryIds) {
        const result = update.run(importanceDelta, confidenceDelta, id) as { changes?: number };
        const changes = result.changes ?? 0;
        changed += changes;
        if (changes > 0) {
          changedIds.push(id);
        }
      }
    });
    transaction(ids);
    return {
      changed,
      memories: this.getByIds(changedIds),
    };
  }
}

function toMemoryRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    importance: row.importance as MemoryRecord["importance"],
    confidence: row.confidence,
    tags: JSON.parse(row.tags_json) as string[],
    createdAt: row.created_at,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
    pinned: row.pinned === 1,
    status: row.status,
    storageKind: row.storage_kind ?? "sqlite",
    sourcePath: row.source_path ?? undefined,
    sourceAnchor: row.source_anchor ?? undefined,
    archivedAt: row.archived_at ?? undefined,
  };
}

function toMemoryEdgeRecord(row: MemoryEdgeRow): MemoryEdgeRecord {
  return {
    id: row.id,
    fromMemoryId: row.from_memory_id,
    toMemoryId: row.to_memory_id,
    relation: row.relation,
    strength: row.strength,
    confidence: row.confidence,
    createdAt: row.created_at,
    lastReinforcedAt: row.last_reinforced_at,
  };
}

function toEntityRecord(row: EntityRow): EntityRecord {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    aliases: JSON.parse(row.aliases_json) as string[],
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    confidence: row.confidence,
  };
}

function toMemoryEntityLink(row: MemoryEntityRow): MemoryEntityLink {
  return {
    memoryId: row.memory_id,
    entityId: row.entity_id,
    relation: row.relation,
    confidence: row.confidence,
  };
}

function mergeAliases(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming])];
}

function normalizeForMatch(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
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

function toFtsQuery(input: string): string {
  return input
    .split(/\s+/)
    .map((part) => `"${part.replaceAll('"', '""')}"`)
    .join(" OR ");
}
