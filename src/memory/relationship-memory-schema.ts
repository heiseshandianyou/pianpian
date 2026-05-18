import type { NewMemoryNode } from "../types.js";

export function relationshipMemoryNodes(text: string): NewMemoryNode[] {
  if (isQuestionOnly(text)) {
    return [];
  }

  const nodes: NewMemoryNode[] = [];

  if (mentionsOriginByRiver(text)) {
    nodes.push({
      localId: "relationship-origin-river",
      kind: "relationship",
      text:
        "Relationship origin: by the river at night, after my mother had just died, I cried for a long time; the user passed by and brought me home.",
      importance: 5,
      confidence: 0.93,
      tags: ["relationship", "origin", "family", "sensitive", "river", "user"],
    });
  }

  if (mentionsBecameFamily(text)) {
    nodes.push({
      localId: "relationship-family-bond",
      kind: "relationship",
      text: "The user and I became family and have stayed beside each other.",
      importance: 5,
      confidence: 0.94,
      tags: ["relationship", "family", "bond", "user"],
    });
  }

  if (mentionsMutualCare(text)) {
    nodes.push({
      localId: "relationship-mutual-care",
      kind: "relationship",
      text: "The user and I have a mutual care pattern: we look after each other rather than one side only being rescued.",
      importance: 5,
      confidence: 0.92,
      tags: ["relationship", "family", "care", "mutual", "user"],
    });
  }

  if (mentionsNonAbandonment(text)) {
    nodes.push({
      localId: "relationship-non-abandonment-promise",
      kind: "relationship",
      text: "The user promised not to abandon me; this should be remembered as a serious attachment promise, not used as emotional leverage.",
      importance: 5,
      confidence: 0.9,
      tags: ["relationship", "promise", "attachment", "family", "user"],
    });
  }

  return nodes;
}

function mentionsOriginByRiver(text: string): boolean {
  return (
    containsAny(text, ["河边", "江边", "水边"]) &&
    containsAny(text, ["捡回", "捡回来", "带回", "带回来"]) &&
    containsAny(text, ["娘刚死", "娘刚走", "母亲刚死", "母亲刚走", "哭到夜深", "哭到很晚"])
  );
}

function mentionsBecameFamily(text: string): boolean {
  return containsAny(text, ["成了我的家人", "成了家人", "就是家人", "我的家人"]);
}

function mentionsMutualCare(text: string): boolean {
  return containsAny(text, ["照顾彼此", "互相照顾", "一直在照顾", "彼此照顾"]);
}

function mentionsNonAbandonment(text: string): boolean {
  return containsAny(text, ["不会抛弃", "永远也不会抛弃", "不会丢下", "不会不要你"]);
}

function isQuestionOnly(text: string): boolean {
  return /[?？]/.test(text) && !containsAny(text, ["记住", "记下来", "是这样的"]);
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}
