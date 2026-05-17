import http from "node:http";
import { ActiveAgentHost, AutonomousRuntime, MemoryStore } from "../index.js";
import type { HeartbeatResult } from "../runtime/active-agent-host.js";
import type { RuntimeCycleResult } from "../runtime/autonomous-runtime.js";

const memory = new MemoryStore(process.env.PIANPIAN_MEMORY_PATH ?? "data/pianpian-memory.sqlite");
const runtime = new AutonomousRuntime(memory, undefined, {
  useConfiguredLlm: process.env.PIANPIAN_NO_LLM !== "1",
  useLlmForMemoryFormation: process.env.PIANPIAN_MEMORY_LLM !== "0",
  useLlmForCompanion: process.env.PIANPIAN_COMPANION_LLM !== "0",
  asyncMemoryFormation: process.env.PIANPIAN_SYNC_MEMORY !== "1",
  trustAutonomousActions: process.env.PIANPIAN_AUTONOMY_TRUST !== "0",
});
const activeHost = new ActiveAgentHost(runtime, memory, {
  heartbeatMs: parseHeartbeatMs(process.env.PIANPIAN_HEARTBEAT_MS),
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
