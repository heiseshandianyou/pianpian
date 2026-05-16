import { cwd } from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolContext, ToolResult, ToolRisk } from "../types.js";

const execFileAsync = promisify(execFile);

export interface ToolDefinition {
  name: string;
  description: string;
  risk: ToolRisk;
  execute(input: Record<string, unknown> | undefined, context: ToolContext): Promise<ToolResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(tools: ToolDefinition[] = defaultTools()) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  riskOf(name: string): ToolRisk | undefined {
    return this.tools.get(name)?.risk;
  }
}

export function defaultTools(): ToolDefinition[] {
  return [
    {
      name: "memory.stats",
      description: "Return read-only memory counts.",
      risk: "safe",
      async execute(_input, context) {
        const memory = context.memory;
        if (!memory) {
          return {
            toolName: "memory.stats",
            output: "Memory stats are unavailable.",
          };
        }

        return {
          toolName: "memory.stats",
          output: `Memory stats: total=${memory.total}, active=${memory.active}, archived=${memory.archived}, pinned=${memory.pinned}.`,
          metadata: memory,
        };
      },
    },
    {
      name: "project.status",
      description: "Return read-only project runtime status.",
      risk: "safe",
      async execute(_input, context) {
        return {
          toolName: "project.status",
          output: `Project status: cwd=${context.project?.cwd ?? cwd()}.`,
          metadata: {
            cwd: context.project?.cwd ?? cwd(),
          },
        };
      },
    },
    {
      name: "memory.inspect",
      description: "Return a read-only explanation of why memories were activated in the current cycle.",
      risk: "safe",
      async execute(_input, context) {
        const inspection = context.memoryInspection;
        if (!inspection) {
          return {
            toolName: "memory.inspect",
            output: "Memory inspection is unavailable for this cycle.",
          };
        }

        return {
          toolName: "memory.inspect",
          output: inspection.markdown,
          metadata: {
            query: inspection.query,
            summary: inspection.summary,
          },
        };
      },
    },
    {
      name: "codex.run",
      description: "Run Codex non-interactively on a bounded prompt. Requires explicit confirmation.",
      risk: "high",
      async execute(input, context) {
        const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
        if (!prompt) {
          return {
            toolName: "codex.run",
            output: "Codex prompt is required.",
          };
        }

        const sandbox = parseCodexSandbox(input?.sandbox);
        const model = typeof input?.model === "string" ? input.model.trim() : undefined;
        const args = [
          "exec",
          "--cd",
          context.project?.cwd ?? cwd(),
          "--sandbox",
          sandbox,
          "--skip-git-repo-check",
          "--ephemeral",
        ];

        if (model) {
          args.push("--model", model);
        }

        args.push(prompt);

        const { stdout, stderr } = await execFileAsync("codex", args, {
          timeout: 120_000,
          maxBuffer: 1024 * 1024,
        });
        const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");

        return {
          toolName: "codex.run",
          output: output || "Codex completed without output.",
          metadata: {
            sandbox,
            model,
          },
        };
      },
    },
  ];
}

function parseCodexSandbox(value: unknown): "read-only" | "workspace-write" {
  if (value === "workspace-write") {
    return "workspace-write";
  }
  return "read-only";
}
