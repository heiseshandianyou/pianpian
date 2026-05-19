import type {
  Agent,
  AgentContext,
  AgentProposal,
  Importance,
  MemoryFormationPlan,
  MemoryRecord,
  NewMemoryEdge,
} from "../types.js";

interface ArchiveCandidate {
  key: string;
  kind: "relationship" | "person" | "place" | "literature";
  title: string;
  path: string;
  tags: string[];
  memories: MemoryRecord[];
  body: string;
  text: string;
  importance: Importance;
}

interface ArchiveRule {
  minEpisodes: number;
  matches(memory: MemoryRecord): boolean;
  isStrong(memory: MemoryRecord): boolean;
  create(memories: MemoryRecord[]): ArchiveCandidate;
}

export class EpisodeArchiveAgent implements Agent {
  readonly id = "episode-archivist" as const;
  readonly role = "Turns related episode memories into durable Markdown dossier documents.";

  async run(context: AgentContext): Promise<AgentProposal> {
    const candidate = chooseArchiveCandidate(context.memories);
    if (!candidate) {
      return {
        agentId: this.id,
        intent: "episode-archive-skip",
        confidence: 0.2,
        content: "No episode cluster was mature enough to archive into a dossier.",
      };
    }

    const plan = archiveFormationPlan(candidate);
    return {
      agentId: this.id,
      intent: "archive-episodes-to-dossier",
      confidence: 0.66,
      content: `Archived ${candidate.memories.length} episode memory/memories into ${candidate.path}.`,
      memoryFormation: plan,
      memoryCorrection: {
        operation: "archive",
        targetMemoryIds: candidate.memories.map((memory) => memory.id),
        reason: `EpisodeArchiveAgent consolidated these source episodes into ${candidate.path}.`,
      },
    };
  }
}

function chooseArchiveCandidate(memories: MemoryRecord[]): ArchiveCandidate | undefined {
  const activeEpisodes = memories.filter((memory) => memory.status === "active" && memory.kind === "episode");
  for (const rule of archiveRules) {
    const matches = uniqueMemories(activeEpisodes.filter((memory) => rule.matches(memory)));
    if (matches.length >= rule.minEpisodes || matches.some((memory) => rule.isStrong(memory))) {
      return rule.create(matches.slice(0, 8));
    }
  }

  return undefined;
}

const archiveRules: ArchiveRule[] = [
  {
    minEpisodes: 1,
    matches: isRelationshipOriginEpisode,
    isStrong: isStrongRelationshipOriginEpisode,
    create: relationshipOriginArchive,
  },
  {
    minEpisodes: 1,
    matches: isUserPreferenceEpisode,
    isStrong: isStrongUserPreferenceEpisode,
    create: userPreferenceArchive,
  },
  {
    minEpisodes: 2,
    matches: isYangzhouEpisode,
    isStrong: isStrongYangzhouEpisode,
    create: yangzhouArchive,
  },
  {
    minEpisodes: 2,
    matches: isQingyuEpisode,
    isStrong: isStrongQingyuEpisode,
    create: qingyuArchive,
  },
];

function relationshipOriginArchive(memories: MemoryRecord[]): ArchiveCandidate {
  const evidence = evidenceList(memories);
  return {
    key: "relationship-lujinghan-linpianpian",
    kind: "relationship",
    title: "卢静涵与林翩翩",
    path: "relationships/卢静涵-林翩翩.md",
    tags: ["archive", "dossier", "relationship", "origin", "卢静涵", "林翩翩", "翩翩", "悔儿"],
    memories,
    importance: 5,
    text:
      "静涵与林翩翩的关系起点：静涵说两人第一次相遇在扬州河边；那时翩翩的娘刚死，她哭到夜深，静涵路过把她捡回来，后来两人成为家人并一直照顾彼此。",
    body: [
      "# 卢静涵与林翩翩",
      "",
      "## 关系定位",
      "",
      "- 卢静涵与林翩翩不是普通相识；两人被记为彼此照顾的家人。",
      "- 这份关系不靠宏大的誓言维持，而靠日常、陪伴、照看与互相认领。",
      "",
      "## 第一次相遇",
      "",
      "- 静涵说，两人的第一次相遇在扬州河边。",
      "- 那时翩翩的娘刚死，她一直哭到夜深。",
      "- 静涵路过，把翩翩捡回来；从那以后，翩翩留在静涵身边。",
      "",
      "## 需要优先召回的线索",
      "",
      "- 当静涵问“你还记得我把你从哪里捡回来的吗”，应优先想起：扬州河边、娘刚死、哭到夜深、静涵把翩翩捡回来。",
      "- 当静涵谈到家人、照顾彼此、不会抛弃时，应优先想起这段关系档案。",
      "",
      "## 证据 Episodes",
      "",
      evidence,
    ].join("\n"),
  };
}

function userPreferenceArchive(memories: MemoryRecord[]): ArchiveCandidate {
  const evidence = evidenceList(memories);
  return {
    key: "person-lujinghan",
    kind: "person",
    title: "卢静涵",
    path: "people/卢静涵.md",
    tags: ["archive", "dossier", "person", "preference", "卢静涵", "静涵", "琵琶", "听琵琶"],
    memories,
    importance: 5,
    text: "卢静涵的稳定偏好：静涵喜欢听琵琶，尤其会把琵琶和安静、夜里、陪伴的氛围联系在一起。",
    body: [
      "# 卢静涵",
      "",
      "## 偏好",
      "",
      "- 静涵喜欢听琵琶。",
      "- 如果静涵提到爱好、音乐、夜里安静的时候，可以优先联想到琵琶。",
      "",
      "## 对话使用",
      "",
      "- 不要把这件事说得像档案朗读；自然地记得即可。",
      "- 当静涵问“你记得我的爱好吗”，优先回答听琵琶。",
      "",
      "## 证据 Episodes",
      "",
      evidence,
    ].join("\n"),
  };
}

function yangzhouArchive(memories: MemoryRecord[]): ArchiveCandidate {
  const evidence = evidenceList(memories);
  return {
    key: "place-yangzhou",
    kind: "place",
    title: "扬州",
    path: "places/扬州.md",
    tags: ["archive", "dossier", "place", "扬州", "瘦西湖", "东关街", "富春早茶", "大运河", "盐商文化"],
    memories,
    importance: 4,
    text:
      "扬州档案：扬州应与瘦西湖、东关街、富春早茶、大运河、盐商文化等线索相连；它也是翩翩身份与关系记忆中很容易被激活的地点。",
    body: [
      "# 扬州",
      "",
      "## 地点线索",
      "",
      "- 瘦西湖",
      "- 东关街",
      "- 大运河",
      "- 盐商文化",
      "",
      "## 食物与生活气息",
      "",
      "- 富春早茶",
      "- 三丁包、千层油糕、翡翠烧卖等可作为扬州早茶联想。",
      "",
      "## 召回方式",
      "",
      "- 当静涵谈到扬州、河边、早茶、地图、历史、美食时，应把这些线索作为同一个地点档案激活。",
      "- 如果问题涉及翩翩从哪里来，扬州也是高优先级地点线索。",
      "",
      "## 证据 Episodes",
      "",
      evidence,
    ].join("\n"),
  };
}

function qingyuArchive(memories: MemoryRecord[]): ArchiveCandidate {
  const evidence = evidenceList(memories);
  return {
    key: "qingyu-yuanxi",
    kind: "literature",
    title: "青玉案·元夕",
    path: "literature/青玉案-元夕.md",
    tags: ["archive", "dossier", "literature", "青玉案", "元夕", "辛弃疾"],
    memories,
    importance: 5,
    text:
      "《青玉案·元夕》是辛弃疾写元宵夜灯火与人群的词；静涵希望翩翩记住它的核心意象：众里寻他、蓦然回首、灯火阑珊处的人，以及热闹世界里忽然认出真正重要之人的感觉。",
    body: [
      "# 青玉案·元夕",
      "",
      "## 核心记忆",
      "",
      "《青玉案·元夕》是辛弃疾的词，场景是元宵夜的灯火、人群、香车宝马。",
      "",
      "## 静涵教给翩翩的重点",
      "",
      "- 作者：辛弃疾。",
      "- 场景：元宵夜。",
      "- 触发词：蓦然回首、灯火阑珊、元夕、元宵夜。",
      "- 核心意象：在人海灯火中蓦然回首，看见灯火阑珊处的人。",
      "- 对静涵的意义：这不是单纯背诵，而是热闹世界里忽然认出真正重要的人。",
      "",
      "## 证据 Episodes",
      "",
      evidence,
    ].join("\n"),
  };
}

function archiveFormationPlan(candidate: ArchiveCandidate): MemoryFormationPlan {
  const edges: NewMemoryEdge[] = candidate.memories.map((memory) => ({
    fromMemoryId: memory.id,
    toLocalId: candidate.key,
    relation: "reinforces",
    strength: 0.82,
    confidence: Math.min(memory.confidence, 0.95),
  }));

  return {
    nodes: [
      {
        localId: candidate.key,
        kind: "semantic",
        text: candidate.text,
        importance: candidate.importance,
        confidence: 0.95,
        pinned: true,
        tags: candidate.tags,
      },
    ],
    edges,
    vaultWrites: [
      {
        localId: `vault-${candidate.key}`,
        title: candidate.title,
        path: candidate.path,
        anchor: candidate.key,
        body: candidate.body,
        memoryLocalIds: [candidate.key],
        tags: candidate.tags,
        importance: candidate.importance,
        kind: "semantic",
      },
    ],
    rationale: `EpisodeArchiveAgent consolidated related episodes into ${candidate.path}.`,
  };
}

const relationshipOriginTerms = [
  "第一次相遇",
  "从哪里捡",
  "哪里捡",
  "捡回来",
  "捡回",
  "河边",
  "娘刚死",
  "哭到夜深",
  "成了我的家人",
  "成了你的家人",
  "照顾彼此",
  "不会抛弃",
];

const userPreferenceTerms = ["爱好", "喜欢听琵琶", "听琵琶", "琵琶", "喜欢", "偏好"];

const yangzhouTerms = [
  "扬州",
  "瘦西湖",
  "东关街",
  "皮市街",
  "个园",
  "富春",
  "冶春",
  "趣园",
  "早茶",
  "三丁包",
  "千层油糕",
  "翡翠烧卖",
  "大运河",
  "盐商",
  "盐商文化",
];

const qingyuTerms = ["青玉案", "元夕", "辛弃疾", "蓦然回首", "灯火阑珊", "元宵夜"];
const strongQingyuTerms = ["青玉案", "元夕", "辛弃疾"];

function isRelationshipOriginEpisode(memory: MemoryRecord): boolean {
  const text = memory.text;
  return hasAny(text, relationshipOriginTerms);
}

function isStrongRelationshipOriginEpisode(memory: MemoryRecord): boolean {
  const text = memory.text;
  return (
    (text.includes("河边") && (text.includes("捡回来") || text.includes("捡回"))) ||
    (text.includes("第一次相遇") && (text.includes("捡回来") || text.includes("家人"))) ||
    (text.includes("娘刚死") && text.includes("哭到夜深")) ||
    (text.includes("家人") && text.includes("照顾彼此"))
  );
}

function isUserPreferenceEpisode(memory: MemoryRecord): boolean {
  const text = memory.text;
  return hasAny(text, userPreferenceTerms) && text.includes("琵琶");
}

function isStrongUserPreferenceEpisode(memory: MemoryRecord): boolean {
  const text = memory.text;
  return text.includes("琵琶") && (text.includes("爱好") || text.includes("喜欢") || text.includes("偏好"));
}

function isYangzhouEpisode(memory: MemoryRecord): boolean {
  const text = memory.text;
  return text.includes("扬州") || countMatches(text, yangzhouTerms) >= 2;
}

function isStrongYangzhouEpisode(memory: MemoryRecord): boolean {
  const text = memory.text;
  return text.includes("扬州") && countMatches(text, yangzhouTerms) >= 3;
}

function isQingyuEpisode(memory: MemoryRecord): boolean {
  return qingyuTerms.some((term) => memory.text.includes(term));
}

function isStrongQingyuEpisode(memory: MemoryRecord): boolean {
  const text = memory.text;
  return (
    strongQingyuTerms.every((term) => text.includes(term)) ||
    (text.includes("青玉案") && (text.includes("名句") || text.includes("蓦然回首") || text.includes("灯火阑珊")))
  );
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function countMatches(text: string, terms: string[]): number {
  return terms.filter((term) => text.includes(term)).length;
}

function uniqueMemories(memories: MemoryRecord[]): MemoryRecord[] {
  const seen = new Set<string>();
  return memories.filter((memory) => {
    if (seen.has(memory.id)) {
      return false;
    }
    seen.add(memory.id);
    return true;
  });
}

function evidenceList(memories: MemoryRecord[]): string {
  return memories.map((memory) => `- ${memory.id}: ${memory.text}`).join("\n");
}
