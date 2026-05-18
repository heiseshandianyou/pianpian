import type { Agent, AgentAction, AgentContext, AgentProposal } from "../types.js";

type ToolActionInput = Record<string, unknown>;

interface PlanningSignal {
  text: string;
  normalized: string;
  source: AgentContext["perception"]["source"];
  routeMode?: string;
  routeReason: string;
  currentTask: string;
  focus: string;
  goals: string;
  uncertainty: string;
  recentEvidence: string;
}

interface AllowlistedCommand {
  command: "npm" | "git" | "rg";
  args: string[];
  reason: string;
}

export class ToolPlanningAgent implements Agent {
  readonly id = "tool-planner" as const;
  readonly role = "Plans conservative, policy-gated tool actions from context.";

  async run(context: AgentContext): Promise<AgentProposal> {
    const signal = buildPlanningSignal(context);
    const actions = dedupeToolActions([
      ...memoryActions(signal),
      ...projectActions(signal),
      ...workspaceDiscoveryActions(signal),
      ...workspaceReadActions(signal),
      ...workspaceSearchActions(signal),
      ...workspaceCommandActions(signal),
      ...codexActions(signal),
    ]);

    return {
      agentId: this.id,
      intent: actions.length > 0 ? "plan-tool-actions" : "tool-planning-idle",
      confidence: actions.length > 0 ? 0.82 : 0.62,
      content:
        actions.length > 0
          ? `Planned ${actions.length} conservative tool action(s): ${actions.map(toolNameOf).join(", ")}.`
          : "No tool action is necessary under the conservative planning policy.",
      actions,
    };
  }
}

function buildPlanningSignal(context: AgentContext): PlanningSignal {
  const compiled = context.compiledContext;
  const parts = [
    context.perception.text,
    context.route?.mode,
    context.route?.reason,
    compiled?.currentTask,
    compiled?.focus,
    compiled?.goals,
    compiled?.uncertainty,
    compiled?.recentEvidence,
  ].filter((part): part is string => Boolean(part));

  const text = parts.join("\n");
  return {
    text,
    normalized: normalize(text),
    source: context.perception.source,
    routeMode: context.route?.mode,
    routeReason: context.route?.reason ?? "",
    currentTask: compiled?.currentTask ?? context.perception.text,
    focus: compiled?.focus ?? "",
    goals: compiled?.goals ?? "",
    uncertainty: compiled?.uncertainty ?? "",
    recentEvidence: compiled?.recentEvidence ?? "",
  };
}

function memoryActions(signal: PlanningSignal): AgentAction[] {
  const actions: AgentAction[] = [];

  if (
    signal.routeMode === "memory-inspection" ||
    mentionsAny(signal.normalized, [
      "inspect memory",
      "memory inspection",
      "explain memory",
      "explain recall",
      "why did you remember",
      "why did you recall",
      "\\u68c0\\u67e5\\u8bb0\\u5fc6",
      "\\u89e3\\u91ca\\u8bb0\\u5fc6",
      "\\u4e3a\\u4ec0\\u4e48\\u60f3\\u8d77",
    ])
  ) {
    actions.push(toolAction("memory.inspect", "Inspect why the current memories were activated."));
  }

  if (
    signal.routeMode === "tool-status" ||
    mentionsAny(signal.normalized, [
      "memory stats",
      "memory status",
      "memory count",
      "\\u8bb0\\u5fc6\\u7edf\\u8ba1",
      "\\u8bb0\\u5fc6\\u72b6\\u6001",
      "\\u8bb0\\u5fc6\\u6570\\u91cf",
    ])
  ) {
    actions.push(toolAction("memory.stats", "Read current long-term memory statistics."));
  }

  return actions;
}

function projectActions(signal: PlanningSignal): AgentAction[] {
  if (
    signal.routeMode === "tool-status" ||
    signal.routeMode === "development" ||
    mentionsAny(signal.normalized, [
      "project status",
      "workspace status",
      "repo status",
      "current project",
      "\\u9879\\u76ee\\u72b6\\u6001",
      "\\u5de5\\u4f5c\\u533a\\u72b6\\u6001",
      "\\u5f53\\u524d\\u9879\\u76ee",
    ])
  ) {
    return [toolAction("project.status", "Read current project runtime status.")];
  }

  return [];
}

function workspaceDiscoveryActions(signal: PlanningSignal): AgentAction[] {
  const path = firstPath(signal.text) ?? ".";
  if (
    mentionsAny(signal.normalized, [
      "list files",
      "list workspace",
      "show files",
      "directory tree",
      "project structure",
      "workspace structure",
      "\\u5217\\u51fa\\u6587\\u4ef6",
      "\\u9879\\u76ee\\u7ed3\\u6784",
      "\\u76ee\\u5f55\\u7ed3\\u6784",
    ])
  ) {
    return [
      toolAction("workspace.list", `List workspace entries under ${path}.`, {
        path,
        maxEntries: 80,
      }),
    ];
  }

  return [];
}

function workspaceReadActions(signal: PlanningSignal): AgentAction[] {
  if (
    !mentionsAny(signal.normalized, [
      "read",
      "open",
      "show",
      "inspect file",
      "view",
      "\\u8bfb\\u53d6",
      "\\u67e5\\u770b",
      "\\u6253\\u5f00",
    ])
  ) {
    return [];
  }

  return extractPaths(signal.text)
    .slice(0, 3)
    .map((path) =>
      toolAction("workspace.read", `Read workspace file ${path}.`, {
        path,
        maxChars: 24_000,
      }),
    );
}

function workspaceSearchActions(signal: PlanningSignal): AgentAction[] {
  const explicitSearch = mentionsAny(signal.normalized, [
    "search",
    "find",
    "grep",
    "look for",
    "\\u641c\\u7d22",
    "\\u67e5\\u627e",
    "\\u627e\\u5230",
  ]);
  const developmentRecon =
    signal.routeMode === "development" &&
    mentionsAny(signal.normalized, ["where", "how is", "implementation", "usage", "references", "callers"]);

  if (!explicitSearch && !developmentRecon) {
    return [];
  }

  const query = searchQueryFor(signal);
  if (!query) {
    return [];
  }

  return [
    toolAction("workspace.search", `Search workspace for "${query}".`, {
      query,
      path: preferredSearchPath(signal),
      maxResults: 80,
    }),
  ];
}

function workspaceCommandActions(signal: PlanningSignal): AgentAction[] {
  const commands = allowlistedCommandsFor(signal);
  return commands.map((command) =>
    toolAction(
      "workspace.command",
      `Run allowlisted workspace command: ${command.command} ${command.args.join(" ")}.`,
      {
        command: command.command,
        args: command.args,
      },
      trustMetadata(signal, command.reason),
    ),
  );
}

function codexActions(signal: PlanningSignal): AgentAction[] {
  const explicitCodex = mentionsAny(signal.normalized, [
    "codex.run",
    "run codex",
    "use codex",
    "ask codex",
    "\\u8fd0\\u884c codex",
    "\\u7528 codex",
  ]);
  const autonomousDevelopmentNeed =
    signal.source === "internal" &&
    signal.routeMode === "development" &&
    mentionsAny(signal.normalized, ["implement", "fix", "refactor", "typescript", "code"]);

  if (!explicitCodex && !autonomousDevelopmentNeed) {
    return [];
  }

  const sandbox = explicitCodex && wantsWorkspaceWrite(signal.normalized) ? "workspace-write" : "read-only";
  return [
    toolAction(
      "codex.run",
      "Run Codex on a bounded development prompt.",
      {
        prompt: boundedCodexPrompt(signal),
        sandbox,
      },
      trustMetadata(signal, explicitCodex ? "explicit-codex-request" : "autonomous-development-need"),
    ),
  ];
}

function allowlistedCommandsFor(signal: PlanningSignal): AllowlistedCommand[] {
  const commands: AllowlistedCommand[] = [];
  const text = signal.normalized;

  if (mentionsAny(text, ["npm run typecheck", "typecheck", "tsc --noemit", "tsc --noemit"])) {
    commands.push({ command: "npm", args: ["run", "typecheck"], reason: "typecheck-request" });
  }

  if (mentionsAny(text, ["npm run build", "build project", "run build", "\\u6784\\u5efa"])) {
    commands.push({ command: "npm", args: ["run", "build"], reason: "build-request" });
  }

  if (mentionsAny(text, ["git status", "working tree", "worktree status", "\\u5de5\\u4f5c\\u6811\\u72b6\\u6001"])) {
    commands.push({ command: "git", args: ["status", "--short"], reason: "git-status-request" });
  }

  const rgQuery = rgQueryFor(signal);
  if (rgQuery) {
    commands.push({ command: "rg", args: [rgQuery], reason: "rg-request" });
  }

  return commands;
}

function toolAction(
  toolName: string,
  content: string,
  input?: ToolActionInput,
  metadata: Record<string, unknown> = {},
): AgentAction {
  return {
    type: "tool",
    content,
    metadata: {
      source: "tool-planning-agent",
      toolName,
      ...(input ? { input } : {}),
      ...metadata,
    },
  };
}

function trustMetadata(signal: PlanningSignal, reason: string): Record<string, unknown> {
  if (signal.source === "internal" && (signal.routeMode === "development" || signal.routeMode === "autonomous-maintenance")) {
    return {
      autonomous: true,
      trusted: true,
      trustReason: reason,
    };
  }

  if (signal.source === "user" && reason.endsWith("-request")) {
    return {
      confirmed: true,
      trustReason: reason,
    };
  }

  return {
    trustReason: reason,
  };
}

function boundedCodexPrompt(signal: PlanningSignal): string {
  return [
    "You are running as a bounded helper for this TypeScript workspace.",
    "Stay conservative: inspect before changing files, avoid destructive git commands, and summarize any proposed edits.",
    `Task: ${clip(signal.currentTask || signal.text, 900)}`,
    signal.focus ? `Focus: ${clip(signal.focus, 500)}` : undefined,
    signal.goals ? `Goals: ${clip(signal.goals, 500)}` : undefined,
    signal.uncertainty ? `Uncertainty: ${clip(signal.uncertainty, 350)}` : undefined,
  ].filter((part): part is string => Boolean(part)).join("\n");
}

function wantsWorkspaceWrite(text: string): boolean {
  return mentionsAny(text, ["workspace-write", "edit", "modify", "implement", "fix", "write"]);
}

function rgQueryFor(signal: PlanningSignal): string | undefined {
  if (!mentionsAny(signal.normalized, ["run rg", "rg ", "ripgrep"])) {
    return undefined;
  }

  return quotedText(signal.text) ?? searchQueryFor(signal);
}

function searchQueryFor(signal: PlanningSignal): string | undefined {
  const quoted = quotedText(signal.text);
  if (quoted && !looksLikePath(quoted)) {
    return clip(quoted, 120);
  }

  const codeToken = signal.text.match(/\b[A-Za-z_$][A-Za-z0-9_$]{3,}\b/g)?.find((token) => !STOP_WORDS.has(token.toLowerCase()));
  if (codeToken) {
    return codeToken;
  }

  const terms = signal.normalized
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 4 && !STOP_WORDS.has(term));
  return terms[0];
}

function preferredSearchPath(signal: PlanningSignal): string {
  const path = firstPath(signal.text);
  if (path) {
    return path.endsWith(".ts") || path.endsWith(".js") ? "." : path;
  }

  if (mentionsAny(signal.normalized, ["source", "code", "typescript", "agent", "runtime", "src"])) {
    return "src";
  }

  return ".";
}

function firstPath(text: string): string | undefined {
  return extractPaths(text)[0];
}

function extractPaths(text: string): string[] {
  const matches = text.match(/(?:^|[\s`"'])((?:src|docs|data|dist|test|tests|scripts|assets|\.\/)[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+|(?:src|docs|data|test|tests|scripts|assets)(?:[\/\\][A-Za-z0-9_.-]+)+)(?=$|[\s`"',.])/g) ?? [];
  return dedupeStrings(
    matches
      .map((match) => match.trim().replace(/^[`"']|[`"',.]$/g, ""))
      .map((match) => match.replace(/^\.\//, ""))
      .filter((match) => !match.includes("..")),
  );
}

function quotedText(text: string): string | undefined {
  const match = text.match(/["'`]([^"'`\r\n]{2,160})["'`]/);
  return match?.[1].trim();
}

function looksLikePath(value: string): boolean {
  return /(?:^|[\\/])[\w.-]+\.\w+$/.test(value) || value.startsWith("src/") || value.startsWith("docs/");
}

function dedupeToolActions(actions: AgentAction[]): AgentAction[] {
  const seen = new Set<string>();
  const result: AgentAction[] = [];
  for (const action of actions) {
    const toolName = toolNameOf(action);
    const input = action.metadata?.input;
    const key = `${toolName}:${stableJson(input)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(action);
  }
  return result;
}

function toolNameOf(action: AgentAction): string {
  return typeof action.metadata?.toolName === "string" ? action.metadata.toolName : action.content;
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
}

function mentionsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))));
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function clip(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Map(values.map((value) => [value.toLowerCase(), value])).values()];
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "agent",
  "check",
  "codex",
  "context",
  "current",
  "file",
  "find",
  "from",
  "implement",
  "inspect",
  "list",
  "memory",
  "please",
  "project",
  "read",
  "route",
  "search",
  "show",
  "status",
  "task",
  "that",
  "this",
  "tool",
  "typescript",
  "workspace",
]);
