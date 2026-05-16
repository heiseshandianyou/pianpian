import type { Agent, AgentAction, AgentContext, AgentProposal } from "../types.js";

export class ActorAgent implements Agent {
  readonly id = "actor" as const;
  readonly role = "Executes policy-approved low-risk actions and reports results.";

  async run(context: AgentContext): Promise<AgentProposal> {
    const toolActions = proposeSafeToolActions(context.perception.text);

    return {
      agentId: this.id,
      intent: toolActions.length > 0 ? "propose-safe-tool-use" : "actor-ready",
      confidence: toolActions.length > 0 ? 0.88 : 0.86,
      content:
        toolActions.length > 0
          ? `Actor proposed ${toolActions.length} safe read-only tool action(s).`
          : "Actor execution layer is ready for policy-approved low-risk actions.",
      actions: toolActions,
    };
  }
}

function proposeSafeToolActions(input: string): AgentAction[] {
  const normalized = input.toLowerCase();
  const actions: AgentAction[] = [];

  if (isMemoryCorrectionRequest(normalized) || isAskingAboutPastToolResults(normalized)) {
    return actions;
  }

  if (isMemoryInspectionRequest(normalized)) {
    return [
      {
        type: "tool",
        content: "Inspect why the current memories were activated.",
        metadata: {
          toolName: "memory.inspect",
        },
      },
    ];
  }

  if (mentionsAny(normalized, ["memory stats", "memory status", "记忆统计", "记忆状态", "记忆数量"])) {
    actions.push({
      type: "tool",
      content: "Read current long-term memory statistics.",
      metadata: {
        toolName: "memory.stats",
      },
    });
  }

  if (mentionsAny(normalized, ["project status", "workspace status", "项目状态", "工程状态", "当前项目", "当前进度"])) {
    actions.push({
      type: "tool",
      content: "Read current project runtime status.",
      metadata: {
        toolName: "project.status",
      },
    });
  }

  if (
    actions.length === 0 &&
    mentionsAny(normalized, ["status", "状态", "progress", "进度", "检查一下", "看一下"])
  ) {
    actions.push(
      {
        type: "tool",
        content: "Read current long-term memory statistics.",
        metadata: {
          toolName: "memory.stats",
        },
      },
      {
        type: "tool",
        content: "Read current project runtime status.",
        metadata: {
          toolName: "project.status",
        },
      },
    );
  }

  return dedupeToolActions(actions);
}

function mentionsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function isAskingAboutPastToolResults(text: string): boolean {
  return mentionsAny(text, [
    "latest tool execution results",
    "tool execution results",
    "previous tool results",
    "last tool results",
    "刚才工具结果",
    "刚才的工具结果",
    "工具执行结果",
    "上次工具结果",
  ]);
}

function isMemoryInspectionRequest(text: string): boolean {
  return mentionsAny(text, [
    "why did you remember",
    "why did you recall",
    "why was this memory activated",
    "inspect memory",
    "memory inspection",
    "explain memory",
    "explain recall",
    "why this memory",
    "为什么想起",
    "为什么召回",
    "解释记忆",
    "检查记忆",
  ]);
}

function isMemoryCorrectionRequest(text: string): boolean {
  return mentionsAny(text, [
    "不要再记",
    "别记",
    "删除这条记忆",
    "归档",
    "不对",
    "错了",
    "错误",
    "wrong",
    "incorrect",
    "forget this",
    "archive this",
    "设为重要",
    "固定这条",
    "pin this",
    "取消固定",
    "unpin",
    "降权",
    "不重要",
    "downgrade",
  ]);
}

function dedupeToolActions(actions: AgentAction[]): AgentAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const toolName = typeof action.metadata?.toolName === "string" ? action.metadata.toolName : action.content;
    if (seen.has(toolName)) {
      return false;
    }
    seen.add(toolName);
    return true;
  });
}
