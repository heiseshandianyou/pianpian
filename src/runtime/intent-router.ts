import type { AgentId, IntentRoute, Perception, TaskMode } from "../types.js";

export class IntentRouter {
  route(perception: Perception): IntentRoute {
    const mode = inferMode(perception);
    return {
      mode,
      confidence: confidenceForMode(mode),
      reason: reasonForMode(mode),
      selectedAgentIds: agentsForMode(mode),
    };
  }
}

function inferMode(perception: Perception): TaskMode {
  const text = perception.text.toLowerCase();

  if (perception.source === "internal") {
    return "autonomous-maintenance";
  }

  if (mentionsAny(text, correctionTerms)) {
    return "memory-correction";
  }

  if (mentionsAny(text, inspectionTerms)) {
    return "memory-inspection";
  }

  if (mentionsAny(text, pastToolResultTerms)) {
    return "tool-result-recall";
  }

  if (mentionsAny(text, developmentTerms)) {
    return "development";
  }

  if (mentionsAny(text, statusTerms)) {
    return "tool-status";
  }

  return "conversation";
}

function agentsForMode(mode: TaskMode): AgentId[] {
  const memoryAndCompanion: AgentId[] = ["memory-curator", "episode-archivist", "companion"];

  if (mode === "memory-correction") {
    return ["memory-corrector", "companion"];
  }

  if (mode === "memory-inspection") {
    return ["tool-planner", "actor", "companion"];
  }

  if (mode === "tool-status") {
    return ["memory-curator", "tool-planner", "actor", "companion"];
  }

  if (mode === "tool-result-recall") {
    return ["memory-curator", "companion"];
  }

  if (mode === "development") {
    return ["memory-curator", "tool-planner", "planner", "companion"];
  }

  if (mode === "autonomous-maintenance") {
    return ["memory-curator", "memory-reviewer", "episode-archivist", "self-model", "associator", "inner-life", "desire-habit", "proactive-intent", "proactive-scheduler", "tool-planner", "planner", "reflector", "companion"];
  }

  return memoryAndCompanion;
}

function confidenceForMode(mode: TaskMode): number {
  if (mode === "conversation") {
    return 0.65;
  }
  if (mode === "development") {
    return 0.74;
  }
  return 0.86;
}

function reasonForMode(mode: TaskMode): string {
  const reasons: Record<TaskMode, string> = {
    conversation: "No specialized intent was detected; use memory formation and response composition.",
    "memory-correction": "The input contains explicit memory correction or reweighting language.",
    "memory-inspection": "The input asks why a memory was recalled or requests memory explanation.",
    "tool-status": "The input asks for current project, workspace, progress, or memory status.",
    "tool-result-recall": "The input asks about previous tool execution results rather than requesting a new tool run.",
    development: "The input appears to ask for implementation or project-planning work.",
    "autonomous-maintenance": "Internal perception should run maintenance-oriented agents.",
  };
  return reasons[mode];
}

function mentionsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

const correctionTerms = [
  "不要再记",
  "别记",
  "删除这条记忆",
  "归档",
  "不对",
  "错了",
  "错误",
  "设为重要",
  "固定这条",
  "取消固定",
  "降权",
  "不重要",
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
];

const inspectionTerms = [
  "为什么想起",
  "为什么召回",
  "解释记忆",
  "检查记忆",
  "记忆检查",
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
];

const pastToolResultTerms = [
  "刚才工具结果",
  "刚才的工具结果",
  "工具执行结果",
  "上次工具结果",
  "latest tool execution results",
  "tool execution results",
  "previous tool results",
  "last tool results",
  "刚才工具结果",
  "刚才的工具结果",
  "工具执行结果",
  "上次工具结果",
];

const statusTerms = [
  "记忆统计",
  "记忆状态",
  "记忆数量",
  "项目状态",
  "工程状态",
  "当前项目",
  "当前进度",
  "状态",
  "进度",
  "检查一下",
  "看一下",
  "memory stats",
  "memory status",
  "project status",
  "workspace status",
  "status",
  "progress",
  "记忆统计",
  "记忆状态",
  "记忆数量",
  "项目状态",
  "工程状态",
  "当前项目",
  "当前进度",
  "状态",
  "进度",
  "检查一下",
  "看一下",
];

const developmentTerms = [
  "开发",
  "实现",
  "修复",
  "重构",
  "下一阶段",
  "启动下一阶段",
  "检查",
  "构建",
  "运行",
  "代码",
  "implement",
  "build",
  "fix",
  "refactor",
  "typescript",
  "code",
  "开发",
  "实现",
  "修复",
  "重构",
  "下一阶段",
  "启动下一阶段",
];
