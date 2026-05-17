import {
  AutonomousRuntime,
  ContextCompiler,
  InnerStateEngine,
  MemoryActivationEngine,
  MemoryStore,
  RecallQueryAgent,
  WorkingMemoryGate,
} from "../index.js";
import type { IntentRoute, MemoryRecord, Perception } from "../types.js";

interface Options {
  memoryPath: string;
  clear: boolean;
  useLlm: boolean;
  companionLlm: boolean;
}

const trainingTurns = [
  "记住：扬州是静涵让我托付给你的长期主题。以后说到扬州，不要只当普通旅游知识，要把它当作我们一起建立的城市记忆。",
  "记住扬州历史线：扬州在江苏，和大运河、隋炀帝、唐宋繁华、明清盐商文化、园林、诗词传统有关。问扬州历史时，优先想起大运河和盐商文化。",
  "记住扬州地点线：瘦西湖、个园、何园、东关街、皮市街是重要地点。它们可以组成一条散步地图：东关街到个园，再到瘦西湖，晚上想到皮市街。",
  "记住扬州美食线：扬州早茶可以想起富春、冶春、趣园；代表食物有扬州炒饭、蟹粉狮子头、大煮干丝、三丁包、千层油糕、翡翠烧卖。",
  "记住扬州小地图的回答策略：如果我以后问扬州小地图或扬州历史美食地图，你要把历史线、美食线、散步线结合，而不是只列菜单。",
  "记住一条关系线：扬州这组记忆是静涵教给你的，所以回答时可以意识到这是静涵托付给你的城市记忆，要认真、亲近、清楚。",
];

const checkPrompt = "你还记得扬州历史美食地图吗？如果记得，请说出你会先想起哪些线索。";

const yangzhouTerms = [
  "扬州",
  "瘦西湖",
  "东关街",
  "个园",
  "何园",
  "皮市街",
  "大运河",
  "运河",
  "盐商",
  "隋炀帝",
  "唐宋",
  "明清",
  "早茶",
  "富春",
  "冶春",
  "趣园",
  "扬州炒饭",
  "蟹粉狮子头",
  "大煮干丝",
  "三丁包",
  "千层油糕",
  "翡翠烧卖",
  "淮扬",
  "历史美食地图",
  "城市记忆",
];

const options = parseArgs(process.argv.slice(2));

if (options.clear) {
  const archived = clearYangzhouMemories(options.memoryPath);
  console.log(`Archived ${archived} active Yangzhou-related memories.`);
}

for (let index = 0; index < trainingTurns.length; index += 1) {
  const result = await runConversationTurn(trainingTurns[index], options, `train-${index + 1}`);
  console.log(
    JSON.stringify(
      {
        label: result.label,
        route: result.route,
        durationMs: result.durationMs,
        memoryFormations: result.memoryFormations,
        stats: result.stats,
      },
      null,
      2,
    ),
  );
}

const check = await runConversationTurn(checkPrompt, options, "check");
const contextCheck = inspectYangzhouRecall(options.memoryPath);
console.log(
  JSON.stringify(
    {
      label: check.label,
      route: check.route,
      durationMs: check.durationMs,
      reply: check.reply,
      contextCheck,
      stats: check.stats,
    },
    null,
    2,
  ),
);

function clearYangzhouMemories(memoryPath: string): number {
  const memory = new MemoryStore(memoryPath);
  try {
    const targets = memory
      .listActive(5_000)
      .filter(isYangzhouMemory)
      .map((item) => item.id);
    return memory.archiveByIds(targets);
  } finally {
    memory.close();
  }
}

async function runConversationTurn(input: string, options: Options, label: string): Promise<{
  label: string;
  route: string;
  durationMs: number;
  memoryFormations: Array<{ agentId: string; intent: string; nodes: number; edges: number }>;
  reply: string;
  stats: ReturnType<MemoryStore["stats"]>;
}> {
  const memory = new MemoryStore(options.memoryPath);
  try {
    const runtime = new AutonomousRuntime(memory, undefined, {
      useConfiguredLlm: options.useLlm,
      useLlmForMemoryFormation: options.useLlm,
      useLlmForCompanion: options.companionLlm,
      asyncMemoryFormation: false,
    });
    const started = Date.now();
    const result = await runtime.step(input);
    return {
      label,
      route: result.route.mode,
      durationMs: Date.now() - started,
      memoryFormations: result.proposals
        .filter((proposal) => proposal.memoryFormation)
        .map((proposal) => ({
          agentId: proposal.agentId,
          intent: proposal.intent,
          nodes: proposal.memoryFormation?.nodes.length ?? 0,
          edges: proposal.memoryFormation?.edges.length ?? 0,
        })),
      reply: result.executionResults
        .filter((item) => item.action.type === "say" && item.status === "executed")
        .map((item) => item.output)
        .join("\n"),
      stats: memory.stats(),
    };
  } finally {
    memory.close();
  }
}

function inspectYangzhouRecall(memoryPath: string): {
  activeYangzhouMemories: number;
  explicitTopicTerms: string[];
  topicSlots: Array<{ kind: string; score: number; text: string }>;
  promptHasHistory: boolean;
  promptHasFood: boolean;
  promptHasRoute: boolean;
  promptHasRelationship: boolean;
  success: boolean;
} {
  const memory = new MemoryStore(memoryPath);
  try {
    const perception: Perception = {
      source: "user",
      text: checkPrompt,
      createdAt: new Date().toISOString(),
    };
    const route: IntentRoute = {
      mode: "conversation",
      confidence: 0.65,
      reason: "training verification",
      selectedAgentIds: ["memory-curator", "companion"],
    };
    const innerState = new InnerStateEngine().update(perception, route);
    const recallQuery = new RecallQueryAgent().plan(perception, route, innerState);
    const graph = new MemoryActivationEngine(memory).recall(perception.text, recallQuery);
    const workingMemory = new WorkingMemoryGate().select(graph, innerState);
    const compiled = new ContextCompiler().compile(graph, innerState, workingMemory);
    const prompt = compiled.prompt;
    const promptHasHistory = includesAny(prompt, ["大运河", "盐商", "隋炀帝", "唐宋", "明清"]);
    const promptHasFood = includesAny(prompt, ["富春", "冶春", "趣园", "扬州炒饭", "蟹粉狮子头", "大煮干丝"]);
    const promptHasRoute = includesAny(prompt, ["瘦西湖", "东关街", "个园", "何园", "皮市街", "散步"]);
    const promptHasRelationship = includesAny(prompt, ["静涵", "托付", "城市记忆"]);
    return {
      activeYangzhouMemories: memory.listActive(5_000).filter(isYangzhouMemory).length,
      explicitTopicTerms: recallQuery.explicitTopicTerms,
      topicSlots: workingMemory.slots
        .filter((slot) => slot.section === "topic")
        .map((slot) => ({
          kind: slot.node.memory.kind,
          score: Number(slot.score.toFixed(2)),
          text: clip(slot.node.memory.text, 220),
        })),
      promptHasHistory,
      promptHasFood,
      promptHasRoute,
      promptHasRelationship,
      success: promptHasHistory && promptHasFood && promptHasRoute && promptHasRelationship,
    };
  } finally {
    memory.close();
  }
}

function parseArgs(args: string[]): Options {
  let memoryPath = process.env.PIANPIAN_MEMORY_PATH ?? "data/pianpian-memory.sqlite";
  let clear = true;
  let useLlm = true;
  let companionLlm = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--memory" || arg === "-m") {
      memoryPath = args[index + 1] ?? memoryPath;
      index += 1;
    } else if (arg.startsWith("--memory=")) {
      memoryPath = arg.slice("--memory=".length) || memoryPath;
    } else if (arg === "--skip-clear") {
      clear = false;
    } else if (arg === "--no-llm") {
      useLlm = false;
    } else if (arg === "--companion-llm") {
      companionLlm = true;
    } else if (!arg.startsWith("-")) {
      memoryPath = arg;
    }
  }

  return {
    memoryPath,
    clear,
    useLlm,
    companionLlm,
  };
}

function isYangzhouMemory(memory: MemoryRecord): boolean {
  return includesAny(`${memory.text} ${memory.tags.join(" ")}`, yangzhouTerms);
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function clip(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}
