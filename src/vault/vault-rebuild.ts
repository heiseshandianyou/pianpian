import type { MemoryStore } from "../memory/memory-store.js";
import type { MemoryFormationPlan, MemoryRecord, NewMemoryNode } from "../types.js";
import type { MarkdownMemoryVault } from "./markdown-memory-vault.js";
import type { MarkdownMemoryImportOptions, MarkdownVaultListOptions } from "./types.js";
import { buildMemoryFormationPlanFromVaultPath } from "./vault-import.js";

export interface VaultRebuildOptions extends MarkdownMemoryImportOptions, MarkdownVaultListOptions {
  dryRun?: boolean;
}

export interface VaultRebuildError {
  path: string;
  error: string;
}

export interface VaultRebuildResult {
  scanned: number;
  imported: number;
  skipped: number;
  errors: VaultRebuildError[];
}

export async function rebuildMarkdownVaultIndex(
  vault: MarkdownMemoryVault,
  memory: Pick<MemoryStore, "applyFormation" | "listActive">,
  options: VaultRebuildOptions = {},
): Promise<VaultRebuildResult> {
  const items = await vault.list({
    prefix: options.prefix,
    recursive: options.recursive,
  });
  const result: VaultRebuildResult = {
    scanned: items.length,
    imported: 0,
    skipped: 0,
    errors: [],
  };
  const importedKeys = buildImportedMarkdownKeySet(memory.listActive());

  for (const item of items) {
    try {
      const plan = await buildMemoryFormationPlanFromVaultPath(vault, item.path, options);
      if (!plan || plan.nodes.length === 0) {
        result.skipped += 1;
        continue;
      }

      const filteredPlan = filterImportedNodes(plan, importedKeys);
      result.skipped += plan.nodes.length - filteredPlan.nodes.length;

      if (filteredPlan.nodes.length === 0) {
        continue;
      }

      if (options.dryRun) {
        result.imported += filteredPlan.nodes.length;
        for (const node of filteredPlan.nodes) {
          for (const key of markdownImportKeysForNode(node)) {
            importedKeys.add(key);
          }
        }
        continue;
      }

      const applied = memory.applyFormation(filteredPlan);
      result.imported += applied.nodes.length;
      for (const node of filteredPlan.nodes) {
        for (const key of markdownImportKeysForNode(node)) {
          importedKeys.add(key);
        }
      }
    } catch (error) {
      result.errors.push({
        path: item.path,
        error: errorMessage(error),
      });
    }
  }

  return result;
}

function filterImportedNodes(plan: MemoryFormationPlan, importedKeys: Set<string>): MemoryFormationPlan {
  const nodes = plan.nodes.filter((node) => !markdownImportKeysForNode(node).some((key) => importedKeys.has(key)));
  const nodeLocalIds = new Set(nodes.map((node) => node.localId));

  return {
    ...plan,
    nodes,
    edges: plan.edges.filter((edge) => {
      const fromKept = !edge.fromLocalId || nodeLocalIds.has(edge.fromLocalId);
      const toKept = !edge.toLocalId || nodeLocalIds.has(edge.toLocalId);
      return fromKept && toKept;
    }),
    memoryEntityLinks: plan.memoryEntityLinks?.filter((link) => !link.memoryLocalId || nodeLocalIds.has(link.memoryLocalId)),
  };
}

function buildImportedMarkdownKeySet(memories: MemoryRecord[]): Set<string> {
  const keys = new Set<string>();

  for (const memory of memories) {
    if (memory.storageKind !== "markdown" || !memory.sourcePath) {
      continue;
    }

    for (const key of markdownImportKeys(memory.sourcePath, memory.sourceAnchor)) {
      keys.add(key);
    }
  }

  return keys;
}

function markdownImportKeysForNode(node: NewMemoryNode): string[] {
  if (!node.sourcePath) {
    return [];
  }

  return [
    ...markdownImportKeys(node.sourcePath, node.sourceAnchor),
    ...markdownImportKeys(node.sourcePath, node.localId),
  ];
}

function markdownImportKeys(sourcePath: string, sourceAnchor: string | undefined): string[] {
  if (!sourceAnchor) {
    return [];
  }

  return [`${sourcePath}#${sourceAnchor}`];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
