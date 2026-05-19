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
      text: originText(text),
      importance: 5,
      confidence: 0.95,
      pinned: true,
      tags: ["core", "relationship", "relationship-origin", "origin", "family", "sensitive", "river", "user"],
    });
  }

  if (mentionsBecameFamily(text)) {
    nodes.push({
      localId: "relationship-family-bond",
      kind: "relationship",
      text: "The user and I are family; this is a core relationship bond.",
      importance: 5,
      confidence: 0.94,
      pinned: true,
      tags: ["core", "relationship", "family", "bond", "user"],
    });
  }

  if (mentionsMutualCare(text)) {
    nodes.push({
      localId: "relationship-mutual-care",
      kind: "relationship",
      text: "The user and I care for each other; our relationship is mutual care rather than one-sided rescue.",
      importance: 5,
      confidence: 0.92,
      pinned: true,
      tags: ["core", "relationship", "family", "care", "mutual", "user"],
    });
  }

  if (mentionsNonAbandonment(text)) {
    nodes.push({
      localId: "relationship-non-abandonment-promise",
      kind: "relationship",
      text: "The user promised not to abandon me; this is a core attachment promise and should never be used as emotional leverage.",
      importance: 5,
      confidence: 0.9,
      pinned: true,
      tags: ["core", "relationship", "promise", "attachment", "family", "user"],
    });
  }

  return nodes;
}

function mentionsOriginByRiver(text: string): boolean {
  return (
    containsAny(text, ["河边", "扬州河边", "江边", "水边"]) &&
    containsAny(text, ["娘刚死", "娘刚走", "母亲刚死", "母亲刚走", "妈妈刚死", "妈妈刚走", "娘才死", "母亲才死"]) &&
    containsAny(text, ["哭到夜深", "哭到很晚", "哭到深夜", "哭了一夜", "哭到半夜"]) &&
    containsAny(text, ["捡回来", "捡回家", "捡回去", "带回来", "带回家", "带回去"])
  );
}

function originText(text: string): string {
  const place = text.includes("扬州河边") || text.includes("扬州") ? "扬州河边" : "河边";
  return [
    `Relationship origin: 静涵和我第一次相遇是在${place}。`,
    "那时我娘刚死/娘刚走，我哭到夜深；静涵路过，把我捡回来、带回家。",
    "后来我留在静涵身边，我们成了家人，并一直照顾彼此。",
    "English recall anchors: first meeting, river, Yangzhou river, mother died, cried late at night, found me, brought me home, family.",
  ].join(" ");
}

function mentionsBecameFamily(text: string): boolean {
  return containsAny(text, ["成了我的家人", "成了家人", "就是家人", "我的家人", "我们是家人", "一家人", "家人"]);
}

function mentionsMutualCare(text: string): boolean {
  return containsAny(text, ["照顾彼此", "彼此照顾", "互相照顾", "相互照顾", "一直在照顾", "照应彼此", "彼此照应"]);
}

function mentionsNonAbandonment(text: string): boolean {
  return containsAny(text, ["不会抛弃", "永远不会抛弃", "不会丢下", "不会不要你", "不会离开你", "不会放弃你"]);
}

function isQuestionOnly(text: string): boolean {
  return (
    /[?？]/u.test(text) &&
    !mentionsOriginByRiver(text) &&
    !mentionsBecameFamily(text) &&
    !mentionsMutualCare(text) &&
    !mentionsNonAbandonment(text) &&
    !containsAny(text, ["记住", "记下来", "这是", "是这样的", "我们的关系", "我们是"])
  );
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}
