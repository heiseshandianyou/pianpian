import type {
  ActivatedMemoryGraph,
  ActivatedMemoryNode,
  InnerState,
  TopicSubchannel,
  WorkingMemoryFrame,
  WorkingMemorySection,
  WorkingMemorySlot,
} from "../types.js";

export interface WorkingMemoryGateOptions {
  maxSlots: number;
  topicSlots: number;
  topicHistorySlots: number;
  topicFoodSlots: number;
  topicRouteSlots: number;
  topicPromiseSlots: number;
  topicGeneralSlots: number;
  identitySlots: number;
  relationshipSlots: number;
  evidenceSlots: number;
  backgroundSlots: number;
}

const defaultOptions: WorkingMemoryGateOptions = {
  maxSlots: 18,
  topicSlots: 6,
  topicHistorySlots: 1,
  topicFoodSlots: 1,
  topicRouteSlots: 1,
  topicPromiseSlots: 1,
  topicGeneralSlots: 2,
  identitySlots: 2,
  relationshipSlots: 2,
  evidenceSlots: 3,
  backgroundSlots: 5,
};

export class WorkingMemoryGate {
  constructor(private readonly options: Partial<WorkingMemoryGateOptions> = {}) {}

  select(graph: ActivatedMemoryGraph, innerState?: InnerState): WorkingMemoryFrame {
    const options = { ...defaultOptions, ...this.options };
    const candidates = dedupeNodes([...graph.focusNodes, ...graph.supportNodes]);
    const topicTerms = graph.query.explicitTopicTerms;
    const slots: WorkingMemorySlot[] = [];
    const excluded: WorkingMemoryFrame["excluded"] = [];
    const used = new Set<string>();

    const topicCandidates = rankForSection(candidates, "topic", topicTerms, innerState);
    takeTopicSlots(topicCandidates, slots, used, options);

    const relationshipCandidates = rankForSection(candidates, "relationship", topicTerms, innerState);
    takeSlots(relationshipCandidates, slots, used, "relationship", options.relationshipSlots);

    const identityCandidates = rankForSection(candidates, "identity", topicTerms, innerState);
    takeSlots(identityCandidates, slots, used, "identity", options.identitySlots);

    const goalCandidates = rankForSection(candidates, "goals", topicTerms, innerState);
    takeSlots(goalCandidates, slots, used, "goals", 3);

    const preferenceCandidates = rankForSection(candidates, "preferences", topicTerms, innerState);
    takeSlots(preferenceCandidates, slots, used, "preferences", 3);

    const procedureCandidates = rankForSection(candidates, "procedures", topicTerms, innerState);
    takeSlots(procedureCandidates, slots, used, "procedures", 2);

    const evidenceCandidates = rankForSection(candidates, "evidence", topicTerms, innerState);
    takeSlots(evidenceCandidates, slots, used, "evidence", options.evidenceSlots);

    const backgroundCandidates = rankForSection(candidates, "background", topicTerms, innerState);
    takeSlots(backgroundCandidates, slots, used, "background", options.backgroundSlots);

    const trimmed = slots
      .sort(sectionOrder)
      .slice(0, options.maxSlots);
    const finalIds = new Set(trimmed.map((slot) => slot.node.memory.id));
    for (const node of candidates) {
      if (!finalIds.has(node.memory.id)) {
        excluded.push({
          memoryId: node.memory.id,
          reason: exclusionReason(node, topicTerms),
        });
      }
    }

    return {
      topicTerms,
      slots: trimmed,
      excluded,
      summary: summarizeFrame(trimmed, topicTerms),
    };
  }
}

function rankForSection(
  nodes: ActivatedMemoryNode[],
  section: WorkingMemorySection,
  topicTerms: string[],
  innerState?: InnerState,
): WorkingMemorySlot[] {
  return nodes
    .map((node) => scoreNode(node, section, topicTerms, innerState))
    .filter((slot) => slot.score > 0)
    .sort((left, right) => right.score - left.score);
}

function scoreNode(
  node: ActivatedMemoryNode,
  section: WorkingMemorySection,
  topicTerms: string[],
  innerState?: InnerState,
): WorkingMemorySlot {
  const reasons: string[] = [];
  let score = node.activation;
  const topicScore = topicMatchScore(node, topicTerms);
  const actionNoise = isActionLog(node) ? 0.45 : 1;
  const innerBias = innerStateBias(node, innerState);

  if (topicScore > 0) {
    score += topicScore * 1.9;
    reasons.push(`explicit topic match ${topicScore.toFixed(2)}`);
  }
  if (node.memory.pinned) {
    score += section === "identity" || section === "relationship" ? 0.2 : 0.05;
    reasons.push("pinned continuity");
  }
  if (innerBias > 0) {
    score += innerBias;
    reasons.push(`inner-state bias ${innerBias.toFixed(2)}`);
  }
  if (isActionLog(node)) {
    reasons.push("action-log noise reduced");
  }

  score *= actionNoise;
  if (!belongsToSection(node, section, topicScore)) {
    score = 0;
  }

  return {
    section,
    node,
    score,
    reasons: reasons.length > 0 ? reasons : ["activation ranking"],
  };
}

function belongsToSection(node: ActivatedMemoryNode, section: WorkingMemorySection, topicScore: number): boolean {
  const tags = node.memory.tags.map((tag) => tag.toLowerCase());
  const kind = node.memory.kind;
  if (section === "topic") {
    return topicScore > 0 && !isActionLog(node) && !isRecallQuestionEpisode(node);
  }
  if (section === "identity") {
    return kind === "self_model" || tags.some((tag) => ["identity", "self", "self-model", "name"].includes(tag));
  }
  if (section === "relationship") {
    return kind === "relationship" || tags.includes("relationship") || tags.includes("user");
  }
  if (section === "goals") {
    return kind === "goal";
  }
  if (section === "preferences") {
    return kind === "preference";
  }
  if (section === "procedures") {
    return kind === "procedure";
  }
  if (section === "evidence") {
    return kind === "episode" && !isActionLog(node);
  }
  return !isActionLog(node);
}

function topicMatchScore(node: ActivatedMemoryNode, topicTerms: string[]): number {
  if (topicTerms.length === 0) {
    return 0;
  }

  const text = `${node.memory.text} ${node.memory.tags.join(" ")}`.toLowerCase();
  let score = 0;
  for (const term of topicTerms) {
    const normalized = term.toLowerCase();
    if (!normalized || !text.includes(normalized)) {
      continue;
    }
    score += Math.min(1.2, normalized.length / 4);
  }
  return score;
}

function innerStateBias(node: ActivatedMemoryNode, innerState?: InnerState): number {
  if (!innerState) {
    return 0;
  }
  const tags = new Set(node.memory.tags.map((tag) => tag.toLowerCase()));
  return innerState.recallBiasTags.reduce(
    (score, tag) => score + (tags.has(tag.toLowerCase()) ? 0.08 : 0),
    0,
  );
}

function takeSlots(
  candidates: WorkingMemorySlot[],
  slots: WorkingMemorySlot[],
  used: Set<string>,
  section: WorkingMemorySection,
  limit: number,
): void {
  let taken = 0;
  for (const candidate of candidates) {
    if (taken >= limit) {
      return;
    }
    if (used.has(candidate.node.memory.id)) {
      continue;
    }
    used.add(candidate.node.memory.id);
    slots.push({ ...candidate, section });
    taken += 1;
  }
}

function takeTopicSlots(
  candidates: WorkingMemorySlot[],
  slots: WorkingMemorySlot[],
  used: Set<string>,
  options: WorkingMemoryGateOptions,
): void {
  const quotas: Array<{ subchannel: TopicSubchannel; limit: number }> = [
    { subchannel: "history", limit: options.topicHistorySlots },
    { subchannel: "food", limit: options.topicFoodSlots },
    { subchannel: "route", limit: options.topicRouteSlots },
    { subchannel: "promise", limit: options.topicPromiseSlots },
    { subchannel: "general", limit: options.topicGeneralSlots },
  ];
  let topicTaken = 0;

  for (const quota of quotas) {
    let subchannelTaken = 0;
    const subchannelCandidates = candidates
      .filter((candidate) => topicSubchannels(candidate.node).includes(quota.subchannel))
      .sort(
        (left, right) =>
          subchannelScore(right, quota.subchannel) - subchannelScore(left, quota.subchannel),
      );
    for (const candidate of subchannelCandidates) {
      if (topicTaken >= options.topicSlots || subchannelTaken >= quota.limit) {
        break;
      }
      if (used.has(candidate.node.memory.id)) {
        continue;
      }

      used.add(candidate.node.memory.id);
      slots.push({
        ...candidate,
        section: "topic",
        topicSubchannel: quota.subchannel,
        reasons: [`topic-subchannel=${quota.subchannel}`, ...candidate.reasons],
      });
      topicTaken += 1;
      subchannelTaken += 1;
    }
  }

  for (const candidate of candidates) {
    if (topicTaken >= options.topicSlots) {
      return;
    }
    if (used.has(candidate.node.memory.id)) {
      continue;
    }
    const [subchannel] = topicSubchannels(candidate.node);
    used.add(candidate.node.memory.id);
    slots.push({
      ...candidate,
      section: "topic",
      topicSubchannel: subchannel ?? "general",
      reasons: [`topic-subchannel=${subchannel ?? "general"}`, ...candidate.reasons],
    });
    topicTaken += 1;
  }
}

function subchannelScore(slot: WorkingMemorySlot, subchannel: TopicSubchannel): number {
  return slot.score + concreteSubchannelScore(slot.node, subchannel);
}

function concreteSubchannelScore(node: ActivatedMemoryNode, subchannel: TopicSubchannel): number {
  const text = `${node.memory.text} ${node.memory.tags.join(" ")}`.toLowerCase();
  const terms: Record<TopicSubchannel, string[]> = {
    history: ["大运河", "运河", "盐商", "隋炀帝", "唐宋", "明清", "园林", "诗词"],
    food: ["富春", "冶春", "趣园", "扬州炒饭", "蟹粉狮子头", "狮子头", "大煮干丝", "三丁包", "千层油糕", "翡翠烧卖", "淮扬"],
    route: ["瘦西湖", "东关街", "个园", "何园", "皮市街"],
    promise: ["静涵", "托付", "城市记忆", "长期主题"],
    general: [],
  };
  return terms[subchannel].reduce((score, term) => score + (text.includes(term.toLowerCase()) ? 4 : 0), 0);
}

function sectionOrder(left: WorkingMemorySlot, right: WorkingMemorySlot): number {
  const order: Record<WorkingMemorySection, number> = {
    topic: 0,
    relationship: 1,
    identity: 2,
    goals: 3,
    preferences: 4,
    procedures: 5,
    evidence: 6,
    background: 7,
  };
  return order[left.section] - order[right.section] || right.score - left.score;
}

function summarizeFrame(slots: WorkingMemorySlot[], topicTerms: string[]): string {
  const counts = new Map<WorkingMemorySection, number>();
  const topicCounts = new Map<TopicSubchannel, number>();
  for (const slot of slots) {
    counts.set(slot.section, (counts.get(slot.section) ?? 0) + 1);
    if (slot.section === "topic") {
      const subchannel = slot.topicSubchannel ?? "general";
      topicCounts.set(subchannel, (topicCounts.get(subchannel) ?? 0) + 1);
    }
  }
  const parts = [...counts.entries()].map(([section, count]) => `${section}=${count}`);
  const topicParts = [...topicCounts.entries()].map(([section, count]) => `topic.${section}=${count}`);
  const topic = topicTerms.length > 0 ? `topicTerms=${topicTerms.join(", ")}` : "topicTerms=none";
  return `${topic}; ${[...topicParts, ...parts].join("; ")}`;
}

function exclusionReason(node: ActivatedMemoryNode, topicTerms: string[]): string {
  if (isActionLog(node)) {
    return "Excluded because action execution logs are background noise unless explicitly needed.";
  }
  if (topicTerms.length > 0 && topicMatchScore(node, topicTerms) === 0) {
    return "Excluded because it did not match the explicit topic terms and quota was filled.";
  }
  return "Excluded because section quota was filled by stronger candidates.";
}

function dedupeNodes(nodes: ActivatedMemoryNode[]): ActivatedMemoryNode[] {
  const byText = new Map<string, ActivatedMemoryNode>();
  for (const node of nodes) {
    const key = `${node.memory.kind}:${node.memory.text.trim().toLowerCase().replace(/\s+/g, " ")}`;
    const existing = byText.get(key);
    if (!existing || node.activation > existing.activation) {
      byText.set(key, node);
    }
  }
  return [...byText.values()];
}

function isActionLog(node: ActivatedMemoryNode): boolean {
  return node.memory.text.startsWith("Action executed:") || node.memory.tags.includes("execution");
}

function isRecallQuestionEpisode(node: ActivatedMemoryNode): boolean {
  if (node.memory.kind !== "episode") {
    return false;
  }
  if (!node.memory.tags.includes("user") && !node.memory.tags.includes("experience")) {
    return false;
  }
  const text = node.memory.text;
  const asksRecall = /[?？]/.test(text) || text.includes("还记得") || text.includes("remember");
  const isInstruction = text.includes("记住") || text.toLowerCase().includes("remember this");
  return asksRecall && !isInstruction;
}

function topicSubchannels(node: ActivatedMemoryNode): TopicSubchannel[] {
  const text = `${node.memory.text} ${node.memory.tags.join(" ")}`.toLowerCase();
  const subchannels: TopicSubchannel[] = [];
  if (containsAny(text, historyTerms)) {
    subchannels.push("history");
  }
  if (containsAny(text, foodTerms)) {
    subchannels.push("food");
  }
  if (containsAny(text, routeTerms)) {
    subchannels.push("route");
  }
  if (containsAny(text, promiseTerms)) {
    subchannels.push("promise");
  }
  if (subchannels.length === 0) {
    subchannels.push("general");
  }
  return subchannels;
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

const historyTerms = [
  "历史",
  "大运河",
  "运河",
  "盐商",
  "隋炀帝",
  "唐宋",
  "明清",
  "园林",
  "诗词",
  "history",
];

const foodTerms = [
  "美食",
  "早茶",
  "富春",
  "冶春",
  "趣园",
  "扬州炒饭",
  "蟹粉狮子头",
  "狮子头",
  "大煮干丝",
  "干丝",
  "三丁包",
  "千层油糕",
  "翡翠烧卖",
  "淮扬",
  "food",
];

const routeTerms = [
  "路线",
  "散步",
  "地点",
  "地图",
  "瘦西湖",
  "东关街",
  "个园",
  "何园",
  "皮市街",
  "route",
  "map",
];

const promiseTerms = [
  "静涵",
  "托付",
  "城市记忆",
  "长期主题",
  "认真",
  "亲近",
  "关系线",
  "promise",
  "relationship",
];
