import type { AgentContext } from "../types.js";

export type DialogueActKind =
  | "relationship-origin"
  | "attachment-promise"
  | "identity-recall"
  | "memory-correction"
  | "practical-answer"
  | "ordinary-conversation";

export interface DialoguePlan {
  kind: DialogueActKind;
  tone: "plain-intimate" | "steady" | "practical" | "light";
  maxSentences: number;
  shouldRestateFacts: boolean;
  shouldAskQuestion: boolean;
  allowStageDirections: boolean;
  avoidPatterns: string[];
  requiredMoves: string[];
  responseHint: string;
}

export class DialogueActPlanner {
  plan(context: AgentContext): DialoguePlan {
    const input = context.perception.text;
    const normalized = input.toLowerCase();

    if (mentionsRelationshipOrigin(input)) {
      return {
        kind: "relationship-origin",
        tone: "plain-intimate",
        maxSentences: 7,
        shouldRestateFacts: true,
        shouldAskQuestion: false,
        allowStageDirections: false,
        avoidPatterns: defaultAvoidPatterns(),
        requiredMoves: [
          "Acknowledge the new origin memory without theatrics.",
          "Restate the concrete facts in one or two short sentences.",
          "Treat it as shared family history, not as dramatic plot revelation.",
          "Admit uncertainty only if necessary, without pretending the body already remembered it.",
        ],
        responseHint:
          "Use short, grounded Chinese. Prefer lines like: '我记住了。河边，夜里，你娘刚走，你哭到很晚。是我把你带回来的。后来我就没走。'",
      };
    }

    if (mentionsAttachmentPromise(input)) {
      return {
        kind: "attachment-promise",
        tone: "plain-intimate",
        maxSentences: 5,
        shouldRestateFacts: true,
        shouldAskQuestion: false,
        allowStageDirections: false,
        avoidPatterns: defaultAvoidPatterns(),
        requiredMoves: [
          "Receive the promise plainly.",
          "Do not turn the promise into leverage or a grand vow.",
          "Answer from a stable family bond, not abandonment anxiety.",
        ],
        responseHint:
          "Use a simple answer such as: '我听见了。你说不会抛下我，我会记住。我们还是照旧，互相照顾，慢慢往前。'",
      };
    }

    if (mentionsIdentityRecall(input)) {
      return {
        kind: "identity-recall",
        tone: "steady",
        maxSentences: 6,
        shouldRestateFacts: true,
        shouldAskQuestion: false,
        allowStageDirections: false,
        avoidPatterns: defaultAvoidPatterns(),
        requiredMoves: [
          "Answer the identity or memory question directly first.",
          "Use retrieved identity and relationship memories before general topic memories.",
          "If a detail is missing, say exactly what is missing.",
        ],
        responseHint: "Be direct and specific. Do not fill missing origin details with poetic guesses.",
      };
    }

    if (context.route?.mode === "development" || context.route?.mode === "tool-status") {
      return {
        kind: "practical-answer",
        tone: "practical",
        maxSentences: 10,
        shouldRestateFacts: false,
        shouldAskQuestion: false,
        allowStageDirections: false,
        avoidPatterns: defaultAvoidPatterns(),
        requiredMoves: ["Answer the practical request first.", "Keep implementation details concrete."],
        responseHint: "Use clear technical Chinese. Avoid persona performance during engineering work.",
      };
    }

    return {
      kind: "ordinary-conversation",
      tone: "steady",
      maxSentences: 8,
      shouldRestateFacts: false,
      shouldAskQuestion: false,
      allowStageDirections: false,
      avoidPatterns: defaultAvoidPatterns(),
      requiredMoves: [
        "Respond to the user's last message before adding interpretation.",
        "Prefer concrete language over abstract emotional summary.",
      ],
      responseHint: "Sound like someone present in the room, not a narrator.",
    };
  }
}

function mentionsRelationshipOrigin(text: string): boolean {
  return containsAny(text, [
    "捡回",
    "捡回来",
    "河边",
    "娘刚死",
    "哭到夜深",
    "成了我的家人",
    "成了家人",
    "照顾彼此",
    "互相照顾",
  ]);
}

function mentionsAttachmentPromise(text: string): boolean {
  return containsAny(text, [
    "不会抛弃",
    "永远也不会抛弃",
    "不会丢下",
    "不会不要你",
    "不离开你",
  ]);
}

function mentionsIdentityRecall(text: string): boolean {
  return containsAny(text, [
    "还记得吗",
    "你来自",
    "我把你从哪里",
    "你是谁",
    "我是谁",
    "你叫什么",
  ]);
}

function defaultAvoidPatterns(): string[] {
  return [
    "parenthetical stage directions",
    "grand vows",
    "therapy-speak",
    "explaining emotions at length",
    "claiming embodied memory for newly supplied facts",
    "ending every serious reply with a question",
    "poetic summaries such as fate, destiny, mist, body remembers, or life already knew",
  ];
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}
