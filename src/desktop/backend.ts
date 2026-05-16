import http from "node:http";
import { AutonomousRuntime, MemoryStore } from "../index.js";
import type { RuntimeCycleResult } from "../runtime/autonomous-runtime.js";

const memory = new MemoryStore(process.env.PIANPIAN_MEMORY_PATH ?? "data/pianpian-memory.sqlite");
const runtime = new AutonomousRuntime(memory, undefined, {
  useConfiguredLlm: process.env.PIANPIAN_NO_LLM !== "1",
  useLlmForMemoryFormation: process.env.PIANPIAN_MEMORY_LLM !== "0",
  useLlmForCompanion: process.env.PIANPIAN_COMPANION_LLM !== "0",
  asyncMemoryFormation: process.env.PIANPIAN_SYNC_MEMORY !== "1",
});

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

    if (request.method === "POST" && request.url === "/step") {
      const body = (await readJson(request)) as { input?: unknown };
      const input = typeof body.input === "string" ? body.input.trim() : "";
      if (!input) {
        return sendJson(response, { error: "Input cannot be empty." }, 400);
      }

      const startedAt = Date.now();
      const result = await runtime.step(input);
      return sendJson(response, {
        ...toDesktopCycle(result),
        durationMs: Date.now() - startedAt,
      });
    }

    if (request.method === "POST" && request.url === "/shutdown") {
      sendJson(response, { ok: true });
      shutdown();
      return;
    }

    sendJson(response, { error: "Not found." }, 404);
  } catch (error) {
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
    })),
    proposals: result.proposals.map((proposal) => ({
      agentId: proposal.agentId,
      intent: proposal.intent,
      confidence: proposal.confidence,
    })),
    backgroundJobs: result.backgroundJobs,
    stats: memory.stats(),
    memories: memory.list(12),
  };
}

function sendJson(response: http.ServerResponse, payload: unknown, status = 200): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function clampLimit(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    return 12;
  }
  return Math.min(value, 50);
}

function shutdown(): void {
  server.close(() => {
    memory.close();
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(0);
  }, 1_000).unref();
}
