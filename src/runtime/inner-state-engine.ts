import { nowIso } from "../utils/id.js";
import type { InnerMood, InnerState, IntentRoute, Perception } from "../types.js";

export class InnerStateEngine {
  private state: InnerState = {
    mood: "quiet",
    arousal: 0.28,
    socialNeed: 0.45,
    curiosity: 0.5,
    continuityNeed: 0.55,
    dominantDrives: ["continuity"],
    recallBiasTags: ["identity", "relationship", "memory"],
    note: "A quiet baseline state focused on continuity.",
    updatedAt: nowIso(),
  };

  update(perception: Perception, route?: IntentRoute): InnerState {
    const text = perception.text.toLowerCase();
    const isInternal = perception.source === "internal";
    const isDevelopment = route?.mode === "development";
    const asksIdentity = containsAny(text, ["我是谁", "你是谁", "名字", "身份", "认同", "who am i", "who are you"]);
    const asksMemory = containsAny(text, ["记忆", "想起", "回忆", "上下文", "memory", "recall", "context"]);
    const asksRelationship = containsAny(text, ["关系", "朋友", "静涵", "relationship"]);

    const socialNeed = clamp01(this.state.socialNeed + (isInternal ? 0.05 : -0.12) + (asksRelationship ? 0.12 : 0));
    const curiosity = clamp01(this.state.curiosity + (isDevelopment || asksMemory ? 0.14 : -0.03) + (isInternal ? 0.04 : 0));
    const continuityNeed = clamp01(this.state.continuityNeed + (asksIdentity ? 0.2 : 0.02) + (isInternal ? 0.06 : -0.02));
    const arousal = clamp01(
      this.state.arousal * 0.72 +
        (isDevelopment ? 0.26 : 0) +
        (asksMemory ? 0.18 : 0) +
        (asksIdentity ? 0.16 : 0) +
        (isInternal ? 0.08 : 0.12),
    );
    const mood = chooseMood({ isInternal, isDevelopment, asksIdentity, asksRelationship, socialNeed, curiosity, continuityNeed, arousal });
    const dominantDrives = dominantDrivesFor({ mood, socialNeed, curiosity, continuityNeed, isDevelopment, asksMemory });
    const recallBiasTags = recallBiasTagsFor(dominantDrives, mood);

    this.state = {
      mood,
      arousal,
      socialNeed,
      curiosity,
      continuityNeed,
      dominantDrives,
      recallBiasTags,
      note: noteFor(mood, dominantDrives),
      updatedAt: nowIso(),
    };

    return this.snapshot();
  }

  snapshot(): InnerState {
    return {
      ...this.state,
      dominantDrives: [...this.state.dominantDrives],
      recallBiasTags: [...this.state.recallBiasTags],
    };
  }
}

function chooseMood(input: {
  isInternal: boolean;
  isDevelopment: boolean;
  asksIdentity: boolean;
  asksRelationship: boolean;
  socialNeed: number;
  curiosity: number;
  continuityNeed: number;
  arousal: number;
}): InnerMood {
  if (input.asksIdentity || input.continuityNeed > 0.76) {
    return "protective";
  }
  if (input.asksRelationship || input.socialNeed > 0.68) {
    return "tender";
  }
  if (input.isDevelopment || input.curiosity > 0.68) {
    return "focused";
  }
  if (input.isInternal && input.arousal > 0.58) {
    return "restless";
  }
  if (input.curiosity > 0.56) {
    return "curious";
  }
  return "quiet";
}

function dominantDrivesFor(input: {
  mood: InnerMood;
  socialNeed: number;
  curiosity: number;
  continuityNeed: number;
  isDevelopment: boolean;
  asksMemory: boolean;
}): string[] {
  const drives: Array<{ id: string; score: number }> = [
    { id: "continuity", score: input.continuityNeed },
    { id: "connection", score: input.socialNeed },
    { id: "curiosity", score: input.curiosity },
    { id: "craft", score: input.isDevelopment ? 0.82 : 0.32 },
    { id: "memory-integration", score: input.asksMemory ? 0.82 : input.mood === "restless" ? 0.62 : 0.42 },
  ];

  return drives
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((drive) => drive.id);
}

function recallBiasTagsFor(drives: string[], mood: InnerMood): string[] {
  const tags = new Set<string>(["inner-state", mood]);
  for (const drive of drives) {
    if (drive === "continuity") {
      ["identity", "self", "self-model", "name"].forEach((tag) => tags.add(tag));
    } else if (drive === "connection") {
      ["relationship", "user"].forEach((tag) => tags.add(tag));
    } else if (drive === "curiosity") {
      ["reflection", "question", "learning"].forEach((tag) => tags.add(tag));
    } else if (drive === "craft") {
      ["project", "development", "tool", "codex"].forEach((tag) => tags.add(tag));
    } else if (drive === "memory-integration") {
      ["memory", "context", "recall", "association"].forEach((tag) => tags.add(tag));
    }
  }
  return [...tags];
}

function noteFor(mood: InnerMood, drives: string[]): string {
  return `Current inner state is ${mood}; dominant drives: ${drives.join(", ")}.`;
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
