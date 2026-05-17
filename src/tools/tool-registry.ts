import { cwd } from "node:process";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
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
      name: "workspace.list",
      description: "List files and directories inside the project workspace.",
      risk: "safe",
      async execute(input, context) {
        const root = workspaceRoot(context);
        const target = resolveWorkspacePath(root, stringInput(input?.path, "."));
        if (!target.ok) {
          return target.result;
        }

        const maxEntries = clampInteger(input?.maxEntries, 1, 200, 60);
        const entries = (await readdir(target.path, { withFileTypes: true }))
          .map((entry) => ({
            name: entry.name,
            type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
          }))
          .sort((left, right) => `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`))
          .slice(0, maxEntries);

        return {
          toolName: "workspace.list",
          output: entries.map((entry) => `${entry.type}\t${entry.name}`).join("\n") || "No entries.",
          metadata: {
            path: target.path,
            count: entries.length,
          },
        };
      },
    },
    {
      name: "workspace.read",
      description: "Read a UTF-8 text file inside the project workspace.",
      risk: "safe",
      async execute(input, context) {
        const root = workspaceRoot(context);
        const target = resolveWorkspacePath(root, stringInput(input?.path, ""));
        if (!target.ok) {
          return target.result;
        }

        const maxChars = clampInteger(input?.maxChars, 256, 120_000, 16_000);
        const text = await readFile(target.path, "utf8");
        const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated ${text.length - maxChars} chars]` : text;
        return {
          toolName: "workspace.read",
          output: clipped,
          metadata: {
            path: target.path,
            chars: text.length,
            truncated: text.length > maxChars,
          },
        };
      },
    },
    {
      name: "workspace.search",
      description: "Search text inside the project workspace with ripgrep.",
      risk: "safe",
      async execute(input, context) {
        const root = workspaceRoot(context);
        const query = stringInput(input?.query, "").trim();
        if (!query) {
          return {
            toolName: "workspace.search",
            output: "Search query is required.",
          };
        }

        const target = resolveWorkspacePath(root, stringInput(input?.path, "."));
        if (!target.ok) {
          return target.result;
        }

        const maxResults = clampInteger(input?.maxResults, 1, 200, 80);
        try {
          const { stdout } = await execFileAsync("rg", ["-n", "--no-heading", "--color", "never", query, target.path], {
            cwd: root,
            timeout: 20_000,
            maxBuffer: 1024 * 1024,
          });
          const lines = stdout.trim().split(/\r?\n/).filter(Boolean).slice(0, maxResults);
          return {
            toolName: "workspace.search",
            output: lines.join("\n") || "No matches.",
            metadata: {
              query,
              path: target.path,
              count: lines.length,
            },
          };
        } catch (error) {
          const candidate = error as { code?: number; stdout?: string; message?: string };
          if (candidate.code === 1) {
            return {
              toolName: "workspace.search",
              output: "No matches.",
              metadata: {
                query,
                path: target.path,
                count: 0,
              },
            };
          }
          throw error;
        }
      },
    },
    {
      name: "workspace.write",
      description: "Write a UTF-8 text file inside the project workspace.",
      risk: "medium",
      async execute(input, context) {
        const root = workspaceRoot(context);
        const target = resolveWorkspacePath(root, stringInput(input?.path, ""));
        if (!target.ok) {
          return target.result;
        }

        const content = typeof input?.content === "string" ? input.content : "";
        await mkdir(dirname(target.path), { recursive: true });
        await writeFile(target.path, content, "utf8");
        return {
          toolName: "workspace.write",
          output: `Wrote file: ${target.path}`,
          metadata: {
            path: target.path,
            chars: content.length,
          },
        };
      },
    },
    {
      name: "workspace.command",
      description: "Run an allowlisted project command in the workspace.",
      risk: "medium",
      async execute(input, context) {
        const root = workspaceRoot(context);
        const command = stringInput(input?.command, "");
        const args = Array.isArray(input?.args) ? input.args.filter((item): item is string => typeof item === "string") : [];
        const parsed = parseWorkspaceCommand(command, args);
        if (!parsed) {
          return {
            toolName: "workspace.command",
            output: "Command is not allowlisted. Allowed: npm run typecheck, npm run build, git status --short, rg <query>.",
          };
        }

        const { stdout, stderr } = await execFileAsync(parsed.file, parsed.args, {
          cwd: root,
          timeout: 120_000,
          maxBuffer: 1024 * 1024,
        });
        return {
          toolName: "workspace.command",
          output: [stdout.trim(), stderr.trim()].filter(Boolean).join("\n") || "Command completed without output.",
          metadata: {
            command: [parsed.file, ...parsed.args].join(" "),
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

function workspaceRoot(context: ToolContext): string {
  return resolve(context.project?.cwd ?? cwd());
}

function resolveWorkspacePath(
  root: string,
  inputPath: string,
):
  | {
      ok: true;
      path: string;
    }
  | {
      ok: false;
      result: ToolResult;
    } {
  if (!inputPath) {
    return {
      ok: false,
      result: {
        toolName: "workspace.path",
        output: "Workspace path is required.",
      },
    };
  }

  const resolved = resolve(root, inputPath);
  const relation = relative(root, resolved);
  if (relation.startsWith("..") || isAbsolute(relation)) {
    return {
      ok: false,
      result: {
        toolName: "workspace.path",
        output: "Path must stay inside the project workspace.",
        metadata: {
          root,
          requested: inputPath,
        },
      },
    };
  }

  return {
    ok: true,
    path: resolved,
  };
}

function stringInput(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (!Number.isInteger(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value as number));
}

function parseWorkspaceCommand(command: string, args: string[]): { file: string; args: string[] } | undefined {
  if (command === "npm" && args[0] === "run" && (args[1] === "typecheck" || args[1] === "build") && args.length === 2) {
    return { file: "npm", args };
  }

  if (command === "git" && args.length === 2 && args[0] === "status" && args[1] === "--short") {
    return { file: "git", args };
  }

  if (command === "rg" && args.length >= 1 && args.length <= 3 && args.every((arg) => !arg.startsWith("-"))) {
    return { file: "rg", args };
  }

  return undefined;
}
