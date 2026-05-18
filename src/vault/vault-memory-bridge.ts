import type { MarkdownMemoryVault } from "./markdown-memory-vault.js";
import { createStableMarkdownFileName } from "./markdown-memory-vault.js";
import type { MarkdownFrontmatter, MarkdownFrontmatterValue } from "./types.js";
import type { MemoryFormationPlan, MemoryRecord, NewMemoryNode } from "../types.js";

export function annotateFormationWithVaultSources(plan: MemoryFormationPlan): MemoryFormationPlan {
  if (!plan.vaultWrites || plan.vaultWrites.length === 0) {
    return plan;
  }

  const sourceByLocalId = new Map<string, { path: string; anchor: string }>();
  for (const write of plan.vaultWrites) {
    const path = normalizeVaultSourcePath(write.path ?? createStableMarkdownFileName(write.title, write.body));
    const anchor = write.anchor ?? write.localId;
    for (const localId of write.memoryLocalIds) {
      sourceByLocalId.set(localId, { path, anchor });
    }
  }

  return {
    ...plan,
    nodes: plan.nodes.map((node) => annotateVaultSource(node, sourceByLocalId.get(node.localId))),
  };
}

export async function writeFormationVaultDocuments(
  vault: MarkdownMemoryVault | undefined,
  plan: MemoryFormationPlan,
  localToMemory?: Map<string, MemoryRecord>,
): Promise<void> {
  if (!vault || !plan.vaultWrites || plan.vaultWrites.length === 0) {
    return;
  }

  for (const write of plan.vaultWrites) {
    await vault.write({
      path: write.path,
      title: write.title,
      body: write.body,
      overwrite: true,
      frontmatter: {
        vault_id: write.localId,
        memory_local_ids: write.memoryLocalIds,
        memory_ids: write.memoryLocalIds.flatMap((localId) => {
          const memory = localToMemory?.get(localId);
          return memory ? [memory.id] : [];
        }),
        kind: write.kind ?? "memory",
        importance: write.importance ?? 3,
        tags: write.tags ?? [],
        memory_status: "active",
      },
    });
  }
}

export async function syncVaultMemoryFrontmatter(
  vault: MarkdownMemoryVault | undefined,
  memories: MemoryRecord[],
): Promise<number> {
  if (!vault || memories.length === 0) {
    return 0;
  }

  let updated = 0;
  const memoriesByPath = groupMemoriesBySourcePath(memories);
  for (const [sourcePath, pathMemories] of memoriesByPath) {
    const entry = await vault.read(sourcePath);
    if (!entry) {
      continue;
    }

    const existingStates = frontmatterMemoryStates(entry.frontmatter);
    const nextStates = { ...existingStates };
    for (const memory of pathMemories) {
      nextStates[memory.id] = memoryStateFor(memory);
    }

    const memoryIds = mergeMemoryIds(entry.frontmatter, pathMemories);
    const frontmatter: MarkdownFrontmatter = {
      ...entry.frontmatter,
      updated_at: new Date().toISOString(),
      memory_ids: memoryIds,
      memory_status: documentStatus(nextStates),
      pinned: documentPinned(nextStates),
      memory_states: nextStates,
    };

    await vault.write({
      path: entry.path,
      title: typeof frontmatter.title === "string" ? frontmatter.title : undefined,
      body: entry.body,
      frontmatter,
      overwrite: true,
    });
    updated += 1;
  }

  return updated;
}

export function normalizeVaultSourcePath(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  return normalized.toLowerCase().endsWith(".md") ? normalized : `${normalized}.md`;
}

function annotateVaultSource(
  node: NewMemoryNode,
  source: { path: string; anchor: string } | undefined,
): NewMemoryNode {
  if (!source) {
    return node;
  }

  return {
    ...node,
    storageKind: "markdown",
    sourcePath: source.path,
    sourceAnchor: source.anchor,
  };
}

function frontmatterMemoryStates(frontmatter: MarkdownFrontmatter): Record<string, MarkdownFrontmatterValue> {
  const states = frontmatter.memory_states;
  return states && typeof states === "object" && !Array.isArray(states) && !(states instanceof Date)
    ? { ...states }
    : {};
}

function groupMemoriesBySourcePath(memories: MemoryRecord[]): Map<string, MemoryRecord[]> {
  const grouped = new Map<string, MemoryRecord[]>();
  for (const memory of memories) {
    if (!memory.sourcePath) {
      continue;
    }

    grouped.set(memory.sourcePath, [...(grouped.get(memory.sourcePath) ?? []), memory]);
  }
  return grouped;
}

function memoryStateFor(memory: MemoryRecord): Record<string, MarkdownFrontmatterValue> {
  return {
    id: memory.id,
    status: memory.status,
    pinned: memory.pinned,
    importance: memory.importance,
    confidence: memory.confidence,
    archived_at: memory.archivedAt ?? null,
    source_anchor: memory.sourceAnchor ?? null,
    synced_at: new Date().toISOString(),
  };
}

function mergeMemoryIds(frontmatter: MarkdownFrontmatter, memories: MemoryRecord[]): string[] {
  const existing = Array.isArray(frontmatter.memory_ids)
    ? frontmatter.memory_ids.map((id) => String(id))
    : [];
  return [...new Set([...existing, ...memories.map((memory) => memory.id)])];
}

function documentStatus(states: Record<string, MarkdownFrontmatterValue>): "active" | "archived" {
  const values = Object.values(states).filter(isMemoryState);
  if (values.length > 0 && values.every((state) => state.status === "archived")) {
    return "archived";
  }

  return "active";
}

function documentPinned(states: Record<string, MarkdownFrontmatterValue>): boolean {
  return Object.values(states).filter(isMemoryState).some((state) => state.pinned === true);
}

function isMemoryState(value: MarkdownFrontmatterValue): value is {
  status?: MarkdownFrontmatterValue;
  pinned?: MarkdownFrontmatterValue;
} {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}
