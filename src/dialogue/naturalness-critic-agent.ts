import type { DialoguePlan } from "./dialogue-act-planner.js";

export interface NaturalnessReview {
  score: number;
  issues: string[];
  text: string;
}

const stageDirectionPattern = /^\s*[（(][^）)]{1,80}[）)]\s*$/;
const ornateTerms = [
  "命里",
  "薄雾",
  "身体里",
  "灵魂",
  "宿命",
  "真心",
  "接住",
  "放在心上",
  "升华",
  "永远这个词太重",
  "愿意替我",
];

export class NaturalnessCriticAgent {
  readonly id = "naturalness-critic" as const;
  readonly role = "Reviews user-facing replies for human conversational naturalness.";

  reviewAndRepair(text: string, plan: DialoguePlan): NaturalnessReview {
    const issues: string[] = [];
    let repaired = stripStageDirections(text, issues);
    repaired = removeOverusedOrnateLines(repaired, issues);
    repaired = trimToSentenceBudget(repaired, plan.maxSentences, issues);
    repaired = removeTrailingQuestionIfUnwanted(repaired, plan, issues);
    repaired = normalizeBlankLines(repaired);

    const score = naturalnessScore(text, repaired, issues);
    return {
      score,
      issues,
      text: repaired || text.trim(),
    };
  }
}

function stripStageDirections(text: string, issues: string[]): string {
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((line) => {
    if (stageDirectionPattern.test(line)) {
      issues.push("Removed parenthetical stage direction.");
      return false;
    }
    return true;
  });
  return kept.join("\n");
}

function removeOverusedOrnateLines(text: string, issues: string[]): string {
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((line) => {
    const hits = ornateTerms.filter((term) => line.includes(term)).length;
    if (hits >= 2 && line.length > 18) {
      issues.push("Removed ornate emotional over-explanation.");
      return false;
    }
    return true;
  });
  return kept.join("\n");
}

function trimToSentenceBudget(text: string, maxSentences: number, issues: string[]): string {
  const sentences = splitSentences(text);
  if (sentences.length <= maxSentences) {
    return text;
  }

  issues.push(`Trimmed from ${sentences.length} to ${maxSentences} sentences.`);
  return sentences.slice(0, maxSentences).join("");
}

function removeTrailingQuestionIfUnwanted(text: string, plan: DialoguePlan, issues: string[]): string {
  if (plan.shouldAskQuestion) {
    return text;
  }

  const trimmed = text.trim();
  const sentences = splitSentences(trimmed);
  if (sentences.length <= 1) {
    return text;
  }

  const last = sentences[sentences.length - 1]?.trim() ?? "";
  if (!/[?？]$/.test(last)) {
    return text;
  }

  issues.push("Removed an unnecessary trailing question.");
  return sentences.slice(0, -1).join("").trim();
}

function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s*\n+\s*/g, "\n");
  const matches = normalized.match(/[^。！？!?；;\n]+[。！？!?；;]?|\n+/g) ?? [];
  return matches
    .map((part) => part)
    .filter((part) => part.trim().length > 0 && part !== "\n");
}

function normalizeBlankLines(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function naturalnessScore(original: string, repaired: string, issues: string[]): number {
  let score = 1;
  score -= issues.length * 0.08;
  if (original.length > 420) {
    score -= 0.12;
  }
  if (repaired.length < original.length * 0.65) {
    score -= 0.08;
  }
  return Math.max(0.25, Math.min(1, score));
}
