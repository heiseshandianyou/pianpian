import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AutonomousRuntime, MemoryStore } from "./index.js";
import type { RuntimeCycleResult } from "./runtime/autonomous-runtime.js";

interface CliOptions {
  once?: string;
  memoryPath: string;
  useConfiguredLlm: boolean;
  verbose: boolean;
}

const options = parseArgs(process.argv.slice(2));
const memory = new MemoryStore(options.memoryPath);
const runtime = new AutonomousRuntime(memory, undefined, {
  useConfiguredLlm: options.useConfiguredLlm,
});

try {
  if (options.once) {
    const result = await runtime.step(options.once);
    renderCycle(result, options);
  } else if (!process.stdin.isTTY) {
    const text = await readStdin();
    for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      const result = await runtime.step(line);
      renderCycle(result, options);
    }
  } else {
    await runInteractive(options);
  }
} finally {
  memory.close();
}

async function runInteractive(options: CliOptions): Promise<void> {
  printWelcome(options);
  const terminal = createInterface({ input, output });

  try {
    while (true) {
      const line = (await terminal.question("\npianpian> ")).trim();
      if (!line) {
        continue;
      }

      if (line === "/exit" || line === "/quit") {
        console.log("bye.");
        return;
      }

      if (line === "/help") {
        printHelp();
        continue;
      }

      if (line === "/stats") {
        renderStats(memory.stats());
        continue;
      }

      if (line.startsWith("/memories")) {
        const limit = parseLimit(line, 8);
        renderMemories(limit);
        continue;
      }

      const result = await runtime.step(line);
      renderCycle(result, options);
    }
  } finally {
    terminal.close();
  }
}

function renderCycle(result: RuntimeCycleResult, options: CliOptions): void {
  console.log(`\n[route] ${result.route.mode} (${result.route.confidence.toFixed(2)})`);
  console.log(`[agents] ${result.route.selectedAgentIds.join(", ")}`);

  const toolResults = result.executionResults.filter((item) => item.action.type === "tool");
  if (toolResults.length > 0) {
    console.log("\n[tools]");
    for (const item of toolResults) {
      const toolName = typeof item.action.metadata?.toolName === "string" ? item.action.metadata.toolName : "unknown";
      console.log(`- ${toolName}: ${item.status}`);
      console.log(indent(truncate(item.output, toolName === "memory.inspect" ? 4_000 : 800)));
    }
  }

  const sayResults = result.executionResults.filter((item) => item.action.type === "say" && item.status === "executed");
  if (sayResults.length > 0) {
    console.log("\n[pianpian]");
    for (const item of sayResults) {
      console.log(item.output);
    }
  }

  if (options.verbose) {
    renderVerbose(result);
  }
}

function renderVerbose(result: RuntimeCycleResult): void {
  console.log("\n[focus]");
  for (const node of result.activatedMemory.focusNodes) {
    console.log(
      `- ${node.memory.kind} activation=${node.activation.toFixed(2)} depth=${node.depth}: ${truncate(node.memory.text, 220)}`,
    );
  }

  console.log("\n[proposals]");
  for (const proposal of result.proposals) {
    console.log(`- ${proposal.agentId}: ${proposal.intent} (${proposal.confidence.toFixed(2)})`);
  }
}

function renderStats(stats: ReturnType<MemoryStore["stats"]>): void {
  console.log(
    `Memory stats: total=${stats.total}, active=${stats.active}, archived=${stats.archived}, pinned=${stats.pinned}.`,
  );
}

function renderMemories(limit: number): void {
  console.log(`[memories] latest ${limit}`);
  for (const item of memory.list(limit)) {
    console.log(`- ${item.status} ${item.kind}(${item.importance}) ${item.id.slice(0, 12)}: ${truncate(item.text, 220)}`);
  }
}

function printWelcome(options: CliOptions): void {
  console.log("Pianpian persistent runtime session");
  console.log(`memory: ${options.memoryPath}`);
  console.log("type /help for commands, /exit to quit.");
}

function printHelp(): void {
  console.log(
    [
      "Commands:",
      "  /help              Show this help.",
      "  /stats             Show memory counts.",
      "  /memories [limit]  Show recent memories.",
      "  /exit              Quit the session.",
      "",
      "Any other input runs one autonomous runtime cycle.",
      "Examples:",
      "  检查一下当前项目状态和记忆统计。",
      "  Why did you remember memory.stats and project.status?",
      "  Latest memory stats 这条记忆不对，不要再记这个。",
    ].join("\n"),
  );
}

function parseArgs(args: string[]): CliOptions {
  let once: string | undefined;
  let memoryPath = process.env.PIANPIAN_MEMORY_PATH ?? "data/memory-vault";
  let useConfiguredLlm = true;
  let verbose = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--once") {
      once = args[index + 1];
      index += 1;
    } else if (arg === "--memory") {
      memoryPath = args[index + 1] ?? memoryPath;
      index += 1;
    } else if (arg === "--no-llm") {
      useConfiguredLlm = false;
    } else if (arg === "--verbose") {
      verbose = true;
    } else if (!arg.startsWith("--")) {
      once = [arg, ...args.slice(index + 1)].join(" ");
      break;
    }
  }

  return {
    once,
    memoryPath,
    useConfiguredLlm,
    verbose,
  };
}

function parseLimit(line: string, fallback: number): number {
  const [, raw] = line.split(/\s+/, 2);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 50);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}
