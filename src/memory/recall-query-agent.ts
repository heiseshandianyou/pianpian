import type { InnerState, IntentRoute, MemoryKind, Perception, RecallQuery } from "../types.js";

type RecallIntent = "identity" | "relationship" | "memory" | "development" | "status" | "conversation";

export class RecallQueryAgent {
  plan(perception: Perception, route?: IntentRoute, innerState?: InnerState): RecallQuery {
    const input = perception.text.trim();
    const intents = inferRecallIntents(input, route);
    const explicitTopicTerms = extractExplicitTopicTerms(input);
    const expandedQueries = dedupeStrings([
      input,
      ...explicitTopicTerms,
      ...expandTopicTerms(explicitTopicTerms),
      ...relationshipOriginExpansions(input, explicitTopicTerms),
      ...intents.flatMap((intent) => queryExpansions[intent] ?? []),
      ...(innerState ? innerStateExpansion(innerState) : []),
      ...(route ? [route.mode] : []),
    ]).slice(0, 40);
    const priorityTags = dedupeStrings([
      ...intents.flatMap((intent) => tagPriorities[intent] ?? []),
      ...(innerState?.recallBiasTags ?? []),
    ]);
    const priorityKinds = dedupeKinds(intents.flatMap((intent) => kindPriorities[intent] ?? []));

    return {
      rawInput: input,
      taskIntent: summarizeTask(input, route),
      expandedQueries,
      explicitTopicTerms,
      priorityTags,
      priorityKinds,
      queryPlanReason: [
        `route=${route?.mode ?? "unknown"}`,
        innerState ? `innerState=${innerState.mood}` : "innerState=unknown",
        `recallIntents=${intents.join(", ")}`,
        explicitTopicTerms.length > 0 ? `explicitTopics=${explicitTopicTerms.join(", ")}` : "no explicit topic terms",
        expandedQueries.length > 1 ? "expanded semantic recall queries" : "raw query only",
        priorityTags.length > 0 ? `priorityTags=${priorityTags.join(", ")}` : "no priority tags",
      ].join("; "),
      seedLimit: route?.mode === "development" || explicitTopicTerms.length > 0 ? 12 : 8,
      entityLimit: intents.includes("relationship") || intents.includes("identity") ? 10 : 6,
      entitySeedLimit: route?.mode === "development" ? 16 : 12,
      maxDepth: intents.includes("identity") || intents.includes("relationship") ? 3 : 2,
      maxNodes: route?.mode === "memory-inspection" ? 32 : explicitTopicTerms.length > 0 ? 30 : 18,
    };
  }
}

function inferRecallIntents(input: string, route?: IntentRoute): RecallIntent[] {
  const normalized = input.toLowerCase();
  const intents: RecallIntent[] = [];

  if (containsAny(normalized, identityTerms)) {
    intents.push("identity");
  }
  if (containsAny(normalized, relationshipTerms)) {
    intents.push("relationship");
  }
  if (route?.mode === "memory-inspection" || containsAny(normalized, memoryTerms)) {
    intents.push("memory");
  }
  if (route?.mode === "development") {
    intents.push("development");
  }
  if (route?.mode === "tool-status" || containsAny(normalized, statusTerms)) {
    intents.push("status");
  }

  intents.push("conversation");
  return dedupeRecallIntents(intents);
}

function summarizeTask(input: string, route?: IntentRoute): string {
  const normalized = input.trim();
  const clipped = normalized.length <= 160 ? normalized : `${normalized.slice(0, 157)}...`;
  return route ? `${route.mode}: ${clipped}` : clipped;
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function dedupeKinds(values: MemoryKind[]): MemoryKind[] {
  return [...new Set(values)];
}

function dedupeRecallIntents(values: RecallIntent[]): RecallIntent[] {
  return [...new Set(values)];
}

function innerStateExpansion(innerState: InnerState): string[] {
  return [
    `inner state ${innerState.mood} ${innerState.dominantDrives.join(" ")} ${innerState.recallBiasTags.join(" ")}`,
  ];
}

function extractExplicitTopicTerms(input: string): string[] {
  const terms: string[] = [];
  const latinTerms = input
    .toLowerCase()
    .match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  terms.push(...latinTerms.filter((term) => !latinStopWords.has(term)));

  for (const sequence of input.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
    const compact = [...sequence].filter((char) => !cjkStopChars.has(char)).join("");
    if (compact.length < 2) {
      continue;
    }

    if (compact.length <= 6 && !cjkStopTerms.has(compact)) {
      terms.push(compact);
    }

    for (let size = 2; size <= Math.min(4, compact.length); size += 1) {
      for (let index = 0; index <= compact.length - size; index += 1) {
        const term = compact.slice(index, index + size);
        if (!cjkStopTerms.has(term)) {
          terms.push(term);
        }
      }
    }
  }

  return dedupeStrings(terms)
    .sort((left, right) => topicTermScore(right) - topicTermScore(left))
    .slice(0, 14);
}

function topicTermScore(term: string): number {
  let score = term.length;
  if (/[\u3400-\u9fff]/.test(term)) {
    score += 2;
  }
  if (relationshipOriginTerms.includes(term)) {
    score += 10;
  }
  if (["扬州", "历史", "美食", "地图", "瘦西湖", "东关街", "大运河", "淮扬菜"].includes(term)) {
    score += 8;
  }
  return score;
}

function expandTopicTerms(terms: string[]): string[] {
  const termSet = new Set(terms);
  const expansions: string[] = [];
  if (termSet.has("地图")) {
    expansions.push("路线", "散步", "地点", "街", "园", "湖");
  }
  if (termSet.has("历史")) {
    expansions.push("大运河", "运河", "盐商", "明清", "唐宋");
  }
  if (termSet.has("美食")) {
    expansions.push("早茶", "淮扬菜", "代表菜", "茶社");
  }
  if (termSet.has("扬州")) {
    expansions.push("瘦西湖", "东关街", "个园", "何园", "皮市街", "富春", "冶春", "趣园", "静涵", "托付", "城市记忆");
  }
  return expansions;
}

function relationshipOriginExpansions(input: string, terms: string[]): string[] {
  const text = `${input} ${terms.join(" ")}`.toLowerCase();
  if (!containsAny(text, relationshipOriginTriggers)) {
    return [];
  }

  return [
    "第一次相遇",
    "第一次见面",
    "在哪里捡回来",
    "哪里捡回来",
    "河边",
    "扬州河边",
    "娘刚走",
    "哭到夜深",
    "捡回来",
    "带回家",
    "家人",
    "静涵",
    "相遇 河边 捡回来 带回家 家人 静涵",
    "扬州河边 娘刚走 哭到夜深 捡回来 带回家",
    "relationship origin river mother died cried late night found me brought me home family",
    "first meeting Yangzhou river mother died cried brought home Jinghan",
  ];
}

const cjkStopChars = new Set("我你他她它们的了呢吗吧啊呀和与在是有还会想请给把让说问");
const cjkStopTerms = new Set([
  "记得",
  "还记",
  "你还",
  "我想",
  "请你",
  "帮我",
  "给我",
  "什么",
  "怎么",
  "一下",
  "这个",
  "那个",
  "如果",
  "以后",
]);
const latinStopWords = new Set(["the", "and", "for", "with", "you", "are", "what", "why", "how"]);

const identityTerms = [
  "我是谁",
  "你是谁",
  "我叫什么",
  "你叫什么",
  "我的名字",
  "你的名字",
  "名字",
  "本名",
  "艺名",
  "身份",
  "认同",
  "性格",
  "who am i",
  "who are you",
  "what is my name",
  "what is your name",
];

const relationshipTerms = [
  "第一次相遇",
  "第一次见面",
  "相遇",
  "捡回来",
  "带回家",
  "家人",
  "静涵",
  "河边",
  "我和你",
  "我们的关系",
  "关系",
  "朋友",
  "主人",
  "用户",
  "静涵",
  "heiseshandianyou",
  "relationship",
];

const memoryTerms = [
  "记得",
  "还记得",
  "想起",
  "回忆",
  "在哪里",
  "哪里",
  "第一次",
  "记忆",
  "记住",
  "想起",
  "回忆",
  "上下文",
  "为什么记得",
  "为什么想起",
  "memory",
  "remember",
  "recall",
  "context",
];

const statusTerms = [
  "当前",
  "进度",
  "状态",
  "统计",
  "项目",
  "工程",
  "status",
  "progress",
  "stats",
];

const queryExpansions: Record<RecallIntent, string[]> = {
  identity: [
    "林悔儿 林翩翩 翩翩 本名 艺名 名字 身份 认同 性格",
    "我叫林悔儿 也叫林翩翩 悔儿 翩翩",
    "self model identity name temperament",
  ],
  relationship: [
    "第一次相遇 河边 扬州河边 娘刚走 哭到夜深 捡回来 带回家 家人 静涵",
    "相遇 见面 家人 关系 静涵 带回家",
    "relationship origin river mother died cried late night found brought home family Jinghan",
    "静涵 用户 关系 被认真记住 信任 边界",
    "relationship user name important person",
  ],
  memory: [
    "长期记忆 记忆形成 记忆召回 上下文组织 激活轨迹",
    "memory formation recall context activation trace",
  ],
  development: [
    "TypeScript Electron desktop autonomous runtime Codex project implementation",
    "代码 项目 开发 下一阶段 工具 调用",
  ],
  status: [
    "当前项目状态 记忆统计 工具输出 最近记忆",
    "project status memory stats tool output",
  ],
  conversation: [],
};

const tagPriorities: Record<RecallIntent, string[]> = {
  identity: ["identity", "name", "self", "self-model", "temperament"],
  relationship: ["relationship-origin", "origin", "river", "family", "core", "sensitive", "relationship", "user", "name", "identity"],
  memory: ["memory", "recall", "context", "formation", "inspection"],
  development: ["project", "development", "typescript", "codex", "tool"],
  status: ["project", "status", "memory", "tool"],
  conversation: [],
};

const relationshipOriginTriggers = [
  "第一次相遇",
  "第一次见面",
  "相遇",
  "见面",
  "在哪里捡",
  "哪里捡",
  "捡回来",
  "河边",
  "扬州河边",
  "家人",
  "静涵",
  "哪里来",
  "怎么认识",
  "怎么遇见",
  "怎么相遇",
  "从哪里来",
  "从哪来",
  "带回家",
  "带回来",
];

const relationshipOriginTerms = [
  "第一次相遇",
  "第一次见面",
  "相遇",
  "河边",
  "扬州河边",
  "娘刚走",
  "哭到夜深",
  "捡回来",
  "带回家",
  "家人",
  "静涵",
];

const kindPriorities: Record<RecallIntent, MemoryKind[]> = {
  identity: ["self_model", "relationship"],
  relationship: ["relationship", "self_model"],
  memory: ["reflection", "procedure"],
  development: ["goal", "procedure", "reflection"],
  status: ["goal", "procedure", "episode"],
  conversation: [],
};
