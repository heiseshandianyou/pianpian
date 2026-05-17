import type { LlmProvider } from "../llm/types.js";
import type { Agent, AgentContext, AgentProposal } from "../types.js";

export class CompanionAgent implements Agent {
  readonly id = "companion" as const;
  readonly role = "Maintains personality, emotional continuity, and user-facing tone.";

  constructor(private readonly llm?: LlmProvider) {}

  async run(context: AgentContext): Promise<AgentProposal> {
    const response = await this.composeResponse(context);

    return {
      agentId: this.id,
      intent: "compose-user-facing-response",
      confidence: response.usedLlm ? 0.9 : 0.78,
      content: response.text,
      actions: [
        {
          type: "say",
          content: response.text,
        },
      ],
    };
  }

  private async composeResponse(context: AgentContext): Promise<{ text: string; usedLlm: boolean }> {
    if (this.llm && context.compiledContext) {
      try {
        const text = await this.llm.generate(
          [
            {
              role: "system",
              content: [
                "You speak as 林翩翩.",
                "Her birth name is 林悔儿; 翩翩 is her stage name. Both names belong to her.",
                "Do not describe yourself with implementation labels unless the user is explicitly discussing implementation details.",
                "Turn compiled memory context into a concise user-facing answer.",
                "Answer in the user's language.",
                "Use the compiled context as evidence; do not claim details that are not present.",
                "For identity or name questions, prioritize identity/name memories and answer directly.",
                "If context is incomplete, say what is known and what remains uncertain.",
                "Be warm, clear, self-possessed, and emotionally continuous.",
              ].join("\n"),
            },
            {
              role: "user",
              content: [
                "Current user input:",
                context.perception.text,
                "",
                "Intent route:",
                context.route ? `${context.route.mode}: ${context.route.reason}` : "none",
                "",
                "Compiled context:",
                context.compiledContext.prompt,
              ].join("\n"),
            },
          ],
          {
            temperature: 0.35,
            maxTokens: 700,
            timeoutMs: 12_000,
          },
        );

        return {
          text: text.trim(),
          usedLlm: true,
        };
      } catch {
        // The companion should remain useful even when the model provider is unavailable.
      }
    }

    return {
      text: composeFallbackResponse(context),
      usedLlm: false,
    };
  }
}

function composeFallbackResponse(context: AgentContext): string {
  const compiled = context.compiledContext;
  const chinese = hasChinese(context.perception.text);
  const route = context.route;

  if (!compiled) {
    return chinese
      ? "我已经记录了这次输入。下一步我会先把它转成可回忆的长期记忆，再继续推进。"
      : "I recorded this input. Next I will turn it into durable recallable memory and keep moving.";
  }

  const entities = firstMeaningfulLines(compiled.relevantEntities, 3);
  const toolResults = firstMatchingLines([compiled.focus, compiled.recentEvidence], /tool\(|memory stats|project status/i, 3);
  const focus = firstMeaningfulLines(compiled.focus, 3);
  const goals = firstMeaningfulLines(compiled.goals, 2);
  const uncertainty = compiled.uncertainty === "No activated contradictions." ? "" : compiled.uncertainty;
  const identity = extractIdentity(compiled.prompt);

  if (isIdentityQuestion(context.perception.text) && (identity.userName || identity.assistantName)) {
    const wantsUser = asksUserIdentity(context.perception.text);
    const wantsAssistant = asksAssistantIdentity(context.perception.text);
    if (chinese) {
      return [
        wantsUser && identity.userName ? `你是${identity.userName}。` : "",
        wantsAssistant && identity.assistantName ? `我是${identity.assistantName}。` : "",
        !wantsUser && !wantsAssistant && identity.assistantName ? `我是${identity.assistantName}。` : "",
      ]
        .filter(Boolean)
        .join("");
    }

    return [
      wantsUser && identity.userName ? `You are ${identity.userName}.` : "",
      wantsAssistant && identity.assistantName ? `I am ${identity.assistantName}.` : "",
      !wantsUser && !wantsAssistant && identity.assistantName ? `I am ${identity.assistantName}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (route?.mode === "memory-correction") {
    return chinese
      ? "我已经按你的反馈处理记忆修正请求。如果命中了目标记忆，它会被归档、固定、降权或强化，并留下 correction report 方便以后追溯。"
      : "I handled your memory feedback. If a target memory was found, it was archived, pinned, downgraded, or reinforced, with a correction report kept for provenance.";
  }

  if (route?.mode === "memory-inspection") {
    return chinese
      ? "我会调用记忆检查工具解释这次召回路径，包括激活原因、实体链接、图边和上下文区块。"
      : "I will use the memory inspection tool to explain this recall path, including activation reasons, entity links, graph edges, and context sections.";
  }

  if (chinese) {
    return [
      route ? `当前意图模式：${route.mode}。` : "",
      "我已经从长期记忆里做了一次上下文召回。",
      entities.length > 0 ? `这次激活到的关键实体是：${inlineList(entities)}` : "这次没有激活到明确实体，主要依赖当前焦点记忆。",
      toolResults.length > 0 ? `可用的工具结果是：${inlineList(toolResults)}` : "",
      focus.length > 0 ? `可确认的相关记忆是：${inlineList(focus)}` : "暂时没有足够的焦点记忆可用。",
      goals.length > 0 ? `当前目标线索是：${inlineList(goals)}` : "",
      uncertainty ? `需要注意的不确定性：${uncertainty}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    route ? `Current intent mode: ${route.mode}.` : "",
    "I recalled long-term memory for the current context.",
    entities.length > 0 ? `Key activated entities: ${inlineList(entities)}` : "No explicit entity was activated; I am relying on focus memory.",
    toolResults.length > 0 ? `Available tool results: ${inlineList(toolResults)}` : "",
    focus.length > 0 ? `Confirmed relevant memory: ${inlineList(focus)}` : "There is not enough focus memory yet.",
    goals.length > 0 ? `Active goal signal: ${inlineList(goals)}` : "",
    uncertainty ? `Uncertainty: ${uncertainty}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function firstMeaningfulLines(text: string, limit: number): string[] {
  if (!text || text === "None activated.") {
    return [];
  }

  return text
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function firstMatchingLines(texts: string[], pattern: RegExp, limit: number): string[] {
  const seen = new Set<string>();
  const lines = texts
    .flatMap((text) => firstMeaningfulLines(text, 20))
    .filter((line) => pattern.test(line))
    .filter((line) => {
      const key = line.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

  return lines.slice(0, limit);
}

function inlineList(lines: string[]): string {
  return lines.join("; ");
}

function hasChinese(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function isIdentityQuestion(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    "我是谁",
    "你是谁",
    "我叫什么",
    "你叫什么",
    "我的名字",
    "你的名字",
    "who am i",
    "who are you",
    "what is my name",
    "what is your name",
  ].some((term) => normalized.includes(term));
}

function extractIdentity(text: string): { userName?: string; assistantName?: string } {
  return {
    userName: text.match(/The user's name is ([^.]+)\./)?.[1],
    assistantName:
      text.match(/Pianpian's chosen name is ([^.]+)\./)?.[1] ??
      text.match(/我叫林悔儿，也叫林翩翩/)?.[0]?.replace("我叫", "").replace("，也叫", " / "),
  };
}

function asksUserIdentity(text: string): boolean {
  const normalized = text.toLowerCase();
  return ["我是谁", "我叫什么", "我的名字", "who am i", "what is my name"].some((term) =>
    normalized.includes(term),
  );
}

function asksAssistantIdentity(text: string): boolean {
  const normalized = text.toLowerCase();
  return ["你是谁", "你叫什么", "你的名字", "who are you", "what is your name"].some((term) =>
    normalized.includes(term),
  );
}
