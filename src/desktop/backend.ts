import http from "node:http";
import {
  ActiveAgentHost,
  AutonomousRuntime,
  MarkdownMemoryVault,
  MemoryStore,
  rebuildMarkdownVaultIndex,
  suggestMemoryImportsFromVaultPath,
} from "../index.js";
import type { HeartbeatResult } from "../runtime/active-agent-host.js";
import type { RuntimeCycleResult } from "../runtime/autonomous-runtime.js";
import { parseMarkdown } from "../vault/markdown-memory-vault.js";

const memory = new MemoryStore(process.env.PIANPIAN_MEMORY_PATH ?? "data/pianpian-memory.sqlite");
const vault = new MarkdownMemoryVault(process.env.PIANPIAN_MEMORY_VAULT_PATH ?? "data/memory-vault");
const vaultRebuildConfirmText = "REBUILD VAULT";
const maxJsonBodyBytes = 1_000_000;
const runtime = new AutonomousRuntime(memory, undefined, {
  useConfiguredLlm: process.env.PIANPIAN_NO_LLM !== "1",
  useLlmForMemoryFormation: process.env.PIANPIAN_MEMORY_LLM !== "0",
  useLlmForCompanion: process.env.PIANPIAN_COMPANION_LLM !== "0",
  asyncMemoryFormation: process.env.PIANPIAN_SYNC_MEMORY !== "1",
  trustAutonomousActions: process.env.PIANPIAN_AUTONOMY_TRUST !== "0",
  memoryVaultPath: process.env.PIANPIAN_MEMORY_VAULT_PATH,
  useMarkdownVault: process.env.PIANPIAN_MEMORY_VAULT !== "0",
});
const activeHost = new ActiveAgentHost(runtime, memory, {
  heartbeatMs: parseHeartbeatMs(process.env.PIANPIAN_HEARTBEAT_MS),
  memoryVaultPath: process.env.PIANPIAN_MEMORY_VAULT_PATH,
  useMarkdownVault: process.env.PIANPIAN_MEMORY_VAULT !== "0",
});
let lastHeartbeat: HeartbeatResult | undefined;

if (process.env.PIANPIAN_AUTONOMY !== "0") {
  activeHost.start((result) => {
    lastHeartbeat = result;
  });
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/stats") {
      return sendJson(response, memory.stats());
    }

    if (request.method === "GET" && request.url?.startsWith("/memories")) {
      const url = new URL(request.url, "http://127.0.0.1");
      const limit = clampLimit(Number(url.searchParams.get("limit") ?? 12));
      return sendJson(response, memory.list(limit));
    }

    if (request.method === "GET" && request.url === "/vault") {
      const items = await vault.list();
      return sendJson(
        response,
        items.map((item) => ({
          path: item.path,
          sizeBytes: item.sizeBytes,
          updatedAt: item.updatedAt,
        })),
      );
    }

    if (request.method === "GET" && request.url?.startsWith("/vault/search")) {
      const url = new URL(request.url, "http://127.0.0.1");
      const query = url.searchParams.get("q")?.trim() ?? "";
      if (!query) {
        return sendJson(response, { query, results: [], totalFiles: 0, totalMatches: 0 });
      }

      const limit = clampLimit(Number(url.searchParams.get("limit") ?? 20));
      const results = await vault.search(query, { limit });
      return sendJson(response, {
        query,
        totalFiles: results.length,
        totalMatches: results.reduce((sum, item) => sum + item.matches.length, 0),
        results: results.map((item) => ({
          path: item.path,
          sizeBytes: item.sizeBytes,
          updatedAt: item.updatedAt,
          matches: item.matches.slice(0, 8),
          omittedMatches: Math.max(0, item.matches.length - 8),
        })),
      });
    }

    if (request.method === "GET" && request.url?.startsWith("/vault/read")) {
      const url = new URL(request.url, "http://127.0.0.1");
      const path = url.searchParams.get("path")?.trim() ?? "";
      if (!path) {
        return sendJson(response, { error: "Vault path is required." }, 400);
      }

      const entry = await vault.read(path);
      if (!entry) {
        return sendJson(response, { error: "Vault entry not found." }, 404);
      }

      return sendJson(response, {
        path: entry.path,
        body: entry.body,
        markdown: entry.markdown,
        frontmatter: entry.frontmatter,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      });
    }

    if (request.method === "POST" && request.url === "/vault/write") {
      const body = (await readJson(request)) as { path?: unknown; markdown?: unknown };
      const path = typeof body.path === "string" ? body.path.trim() : "";
      if (!path) {
        return sendJson(response, { error: "Vault path is required." }, 400);
      }
      if (typeof body.markdown !== "string") {
        return sendJson(response, { error: "Vault markdown must be a string." }, 400);
      }

      const markdown = body.markdown;
      let existing;
      try {
        existing = await vault.read(path);
      } catch (error) {
        if (isVaultInputError(error)) {
          return sendJson(response, { error: errorMessage(error) }, 400);
        }
        throw error;
      }
      if (!existing) {
        return sendJson(response, { error: "Vault entry not found." }, 404);
      }

      const parsed = parseMarkdown(markdown);
      const now = new Date().toISOString();
      const frontmatter = {
        ...parsed.frontmatter,
        created_at: parsed.frontmatter.created_at ?? existing.frontmatter.created_at ?? existing.createdAt ?? now,
        updated_at: now,
      };
      const frontmatterTitle = (frontmatter as Record<string, unknown>).title;
      let entry;
      try {
        entry = await vault.write({
          path: existing.path,
          body: parsed.body,
          frontmatter,
          title: typeof frontmatterTitle === "string" ? frontmatterTitle : undefined,
          overwrite: true,
        });
      } catch (error) {
        if (isVaultInputError(error)) {
          return sendJson(response, { error: errorMessage(error) }, 400);
        }
        throw error;
      }

      return sendJson(response, {
        path: entry.path,
        body: entry.body,
        markdown: entry.markdown,
        frontmatter: entry.frontmatter,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      });
    }

    if (request.method === "POST" && request.url === "/vault/rebuild/dry-run") {
      const rebuild = await rebuildMarkdownVaultIndex(vault, memory, {
        dryRun: true,
        rationale: "Dry-run only: preview Markdown vault memory imports without writing to MemoryStore.",
      });
      const items = await vault.list();
      const previews = await Promise.all(
        items.map(async (item) => {
          const suggestions = await suggestMemoryImportsFromVaultPath(vault, item.path, {
            rationale: "Dry-run only: preview Markdown vault memory imports without writing to MemoryStore.",
          });
          return {
            path: item.path,
            updatedAt: item.updatedAt,
            sizeBytes: item.sizeBytes,
            suggestions: suggestions.map((suggestion) => ({
              localId: suggestion.localId,
              title: "title" in suggestion && typeof suggestion.title === "string" ? suggestion.title : undefined,
              text: suggestion.text,
              anchor: suggestion.anchor,
              kind: suggestion.kind,
              importance: suggestion.importance,
              confidence: suggestion.confidence,
              tags: suggestion.tags,
              warnings: suggestion.warnings,
            })),
          };
        }),
      );
      const warnings = previews.flatMap((item) =>
        item.suggestions.flatMap((suggestion) => suggestion.warnings.map((warning) => `${item.path}: ${warning}`)),
      );

      return sendJson(response, {
        mode: "dry-run",
        readonly: true,
        filesScanned: rebuild.scanned,
        filesWithSuggestions: previews.filter((item) => item.suggestions.length > 0).length,
        suggestedMemories: rebuild.imported,
        skipped: rebuild.skipped,
        errors: rebuild.errors,
        warnings,
        items: previews,
      });
    }

    if (request.method === "POST" && request.url === "/vault/rebuild") {
      const body = (await readJson(request)) as { confirmText?: unknown };
      const confirmText = typeof body.confirmText === "string" ? body.confirmText.trim() : "";
      if (confirmText !== vaultRebuildConfirmText) {
        return sendJson(
          response,
          {
            error: `Type ${vaultRebuildConfirmText} to confirm a real Markdown vault rebuild.`,
            requiredConfirmText: vaultRebuildConfirmText,
          },
          400,
        );
      }

      const rebuild = await rebuildMarkdownVaultIndex(vault, memory, { dryRun: false });
      return sendJson(response, {
        mode: "rebuild",
        readonly: false,
        imported: rebuild.imported,
        skipped: rebuild.skipped,
        errors: rebuild.errors,
        filesScanned: rebuild.scanned,
        stats: memory.stats(),
        memories: memory.list(12),
      });
    }

    if (request.method === "POST" && request.url === "/step") {
      const body = (await readJson(request)) as { input?: unknown };
      const input = typeof body.input === "string" ? body.input.trim() : "";
      if (!input) {
        return sendJson(response, { error: "Input cannot be empty." }, 400);
      }

      activeHost.markUserActivity();
      const startedAt = Date.now();
      const result = await runtime.step(input);
      return sendJson(response, {
        ...toDesktopCycle(result),
        durationMs: Date.now() - startedAt,
      });
    }

    if (request.method === "GET" && request.url === "/autonomy") {
      return sendJson(response, autonomyPayload());
    }

    if (request.method === "POST" && request.url === "/autonomy/start") {
      activeHost.start((result) => {
        lastHeartbeat = result;
      });
      return sendJson(response, autonomyPayload());
    }

    if (request.method === "POST" && request.url === "/autonomy/stop") {
      activeHost.stop();
      return sendJson(response, autonomyPayload());
    }

    if (request.method === "POST" && request.url === "/autonomy/heartbeat") {
      const result = await activeHost.heartbeat();
      lastHeartbeat = result;
      return sendJson(response, autonomyPayload());
    }

    if (request.method === "POST" && request.url === "/shutdown") {
      sendJson(response, { ok: true });
      shutdown();
      return;
    }

    sendJson(response, { error: "Not found." }, 404);
  } catch (error) {
    if (error instanceof HttpRequestError) {
      return sendJson(response, { error: error.message }, error.status);
    }

    sendJson(
      response,
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine backend port.");
  }

  process.stdout.write(`${JSON.stringify({ event: "ready", port: address.port })}\n`);
});

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

function toDesktopCycle(result: RuntimeCycleResult) {
  return {
    route: result.route,
    tools: result.executionResults
      .filter((item) => item.action.type === "tool")
      .map((item) => ({
        toolName: typeof item.action.metadata?.toolName === "string" ? item.action.metadata.toolName : "unknown",
        status: item.status,
        output: item.output,
        error: item.error,
      })),
    replies: result.executionResults
      .filter((item) => item.action.type === "say" && item.status === "executed")
      .map((item) => item.output),
    focus: result.activatedMemory.focusNodes.map((node) => ({
      id: node.memory.id,
      kind: node.memory.kind,
      text: node.memory.text,
      activation: node.activation,
      depth: node.depth,
      pinned: node.memory.pinned,
      storageKind: node.memory.storageKind,
      sourcePath: node.memory.sourcePath,
      sourceAnchor: node.memory.sourceAnchor,
    })),
    proposals: result.proposals.map((proposal) => ({
      agentId: proposal.agentId,
      intent: proposal.intent,
      confidence: proposal.confidence,
      content: proposal.content,
    })),
    backgroundJobs: result.backgroundJobs,
    actions: result.actions.map((action) => ({
      type: action.type,
      content: action.content,
      metadata: action.metadata,
    })),
    executionResults: result.executionResults.map((item) => ({
      action: {
        type: item.action.type,
        content: item.action.content,
        metadata: item.action.metadata,
      },
      status: item.status,
      output: item.output,
      error: item.error,
      createdAt: item.createdAt,
      metadata: item.metadata,
    })),
    stats: memory.stats(),
    memories: memory.list(12),
    context: {
      currentTask: result.compiledContext.currentTask,
      innerState: result.compiledContext.innerState,
      workingMemory: result.compiledContext.workingMemory,
      relevantEntities: result.compiledContext.relevantEntities,
      selfModel: result.compiledContext.selfModel,
      focus: result.compiledContext.focus,
      goals: result.compiledContext.goals,
      preferences: result.compiledContext.preferences,
      longTermMemory: result.compiledContext.longTermMemory,
      uncertainty: result.compiledContext.uncertainty,
      recentEvidence: result.compiledContext.recentEvidence,
      prompt: result.compiledContext.prompt,
      trace: result.compiledContext.trace,
      recallQuery: result.activatedMemory.query,
      activationTrace: result.activatedMemory.activationTrace,
      workingMemoryFrame: result.workingMemory,
    },
  };
}

function autonomyPayload() {
  return {
    status: activeHost.status(),
    lastHeartbeat: lastHeartbeat
      ? {
          drive: lastHeartbeat.drive,
          cycle: toDesktopCycle(lastHeartbeat.cycle),
          maintenance: lastHeartbeat.maintenance,
          consolidation: lastHeartbeat.consolidation,
          forgetting: lastHeartbeat.forgetting,
        }
      : undefined,
  };
}

function sendJson(response: http.ServerResponse, payload: unknown, status = 200): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "null",
  });
  response.end(JSON.stringify(payload));
}

function isVaultInputError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("vault path");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class HttpRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let sizeBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += buffer.byteLength;
    if (sizeBytes > maxJsonBodyBytes) {
      throw new HttpRequestError("Request body is too large.", 413);
    }
    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpRequestError("Request body must be valid JSON.", 400);
  }
}

function clampLimit(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    return 12;
  }
  return Math.min(value, 50);
}

function parseHeartbeatMs(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 60_000;
  }
  return Math.max(10_000, Math.min(Math.trunc(parsed), 10 * 60_000));
}

function shutdown(): void {
  activeHost.stop();
  server.close(() => {
    memory.close();
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(0);
  }, 1_000).unref();
}
