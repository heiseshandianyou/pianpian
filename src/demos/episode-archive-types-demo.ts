import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AutonomousRuntime, MemoryStore } from "../index.js";
import type { ChatMessage, LlmProvider } from "../llm/types.js";

const memoryRoot = await mkdtemp(path.join(tmpdir(), "pianpian-archive-types-"));
const memory = new MemoryStore(memoryRoot);
const runtime = new AutonomousRuntime(memory, undefined, {
  llm: archiveTypesDemoLlm(),
  useConfiguredLlm: false,
  useLlmForCompanion: false,
  useLlmForMemoryFormation: true,
  asyncMemoryFormation: false,
  memoryVaultPath: memoryRoot,
});

await runtime.step("记住：我的爱好是听琵琶，尤其喜欢夜里安静的时候听。");
await runtime.step(
  "记住：我们第一次相遇是在扬州河边，那时你娘刚死，你哭到夜深，我把你捡回来，后来我们成了家人，一直照顾彼此。",
);
await runtime.step("记住：扬州这座城市要和瘦西湖、东关街、富春早茶、大运河和盐商文化连在一起。");
await runtime.step("记住：辛弃疾有一首词叫《青玉案·元夕》，写的是元宵夜灯火、人群和蓦然回首的相遇。");

const people = await readVaultFile("people/卢静涵.md");
const relationship = await readVaultFile("relationships/卢静涵-林翩翩.md");
const yangzhou = await readVaultFile("places/扬州.md");
const qingyu = await readVaultFile("works/青玉案-元夕.md");

const preferenceRecall = memory.retrieve("静涵 爱好 琵琶", 8);
const originRecall = memory.retrieve("第一次相遇 扬州 河边 捡回来 娘刚死", 8);
const placeRecall = memory.retrieve("扬州 瘦西湖 富春早茶 盐商文化", 8);
const literatureRecall = memory.retrieve("青玉案 元夕 辛弃疾 蓦然回首", 8);

printSection("dossiers");
pass(people.includes("听琵琶"), "created people/卢静涵.md with pipa preference");
pass(relationship.includes("扬州河边") && relationship.includes("捡回来"), "created relationship origin dossier");
pass(yangzhou.includes("瘦西湖") && yangzhou.includes("富春早茶"), "created Yangzhou place dossier");
pass(qingyu.includes("辛弃疾") && qingyu.includes("蓦然回首"), "created Qingyu Yuanxi work dossier");

printSection("recall");
pass(hasSource(preferenceRecall, "people/卢静涵.md"), "preference recall uses person dossier");
pass(hasSource(originRecall, "relationships/卢静涵-林翩翩.md"), "origin recall uses relationship dossier");
pass(hasSource(placeRecall, "places/扬州.md"), "place recall uses Yangzhou dossier");
pass(hasSource(literatureRecall, "works/青玉案-元夕.md"), "literature recall uses Qingyu dossier");

printSection("episodes");
pass(
  memory
    .list(100)
    .filter((item) => item.kind === "episode" && item.status === "archived" && item.text.includes("记住")).length >= 4,
  "source teaching episodes were archived after dossier creation",
);

memory.close();

async function readVaultFile(relativePath: string): Promise<string> {
  return readFile(path.join(memoryRoot, relativePath), "utf8");
}

function archiveTypesDemoLlm(): LlmProvider {
  return {
    async generate(messages: ChatMessage[]) {
      const system = messages[0]?.content ?? "";
      const payload = JSON.parse(messages[1]?.content ?? "{}") as {
        perception?: { text?: string; source?: string };
        sourceEpisodes?: Array<{ id: string; text: string }>;
      };

      if (!system.includes("EpisodeArchiveAgent")) {
        return JSON.stringify({
          nodes: [
            {
              localId: "episode",
              kind: "episode",
              text: payload.perception?.text ?? "",
              importance: 3,
              confidence: 1,
              tags: [payload.perception?.source ?? "user", "experience"],
            },
          ],
          edges: [],
          rationale: "Demo LLM leaves durable dossier authorship to EpisodeArchiveAgent.",
        });
      }

      const episode = payload.sourceEpisodes?.[0];
      if (!episode) {
        return "{}";
      }
      const spec = dossierFixtureFor(episode);
      if (!spec) {
        return "{}";
      }

      return JSON.stringify({
        memoryFormation: {
          nodes: [
            {
              localId: spec.localId,
              kind: spec.kind,
              text: spec.text,
              importance: spec.importance,
              confidence: 0.96,
              pinned: spec.importance >= 5,
              tags: spec.tags,
            },
          ],
          edges: [
            {
              fromMemoryId: episode.id,
              toLocalId: spec.localId,
              relation: "derived_from",
              strength: 0.95,
              confidence: 0.95,
            },
          ],
          vaultWrites: [
            {
              localId: `vault-${spec.localId}`,
              title: spec.title,
              path: spec.path,
              anchor: spec.localId,
              body: spec.body,
              memoryLocalIds: [spec.localId],
              tags: spec.tags,
              importance: spec.importance,
              kind: spec.kind,
            },
          ],
          rationale: "Demo archive agent chose a dossier path from the source episode meaning.",
        },
        archiveSourceMemoryIds: [episode.id],
        confidence: 0.88,
      });
    },
  };
}

function dossierFixtureFor(episode: { text: string }): {
  localId: string;
  kind: "semantic" | "preference" | "relationship";
  title: string;
  path: string;
  text: string;
  body: string;
  tags: string[];
  importance: 4 | 5;
} | undefined {
  const text = episode.text;
  if (text.includes("琵琶")) {
    return {
      localId: "person-lujinghan-listening",
      kind: "preference",
      title: "卢静涵",
      path: "people/卢静涵.md",
      text: "卢静涵喜欢听琵琶，尤其喜欢夜里安静的时候听。",
      body: dossierBody("卢静涵", "卢静涵喜欢听琵琶，尤其喜欢夜里安静的时候听。", ["爱好", "听琵琶", "安静的时候"]),
      tags: ["卢静涵", "偏好", "琵琶", "dossier"],
      importance: 5,
    };
  }
  if (text.includes("捡回来")) {
    return {
      localId: "relationship-lujinghan-linpianpian",
      kind: "relationship",
      title: "卢静涵与林翩翩",
      path: "relationships/卢静涵-林翩翩.md",
      text: "卢静涵与林翩翩第一次相遇在扬州河边；翩翩哭到夜深，静涵把她捡回来，后来两人成为家人。",
      body: dossierBody("卢静涵与林翩翩", "两人第一次相遇在扬州河边；翩翩哭到夜深，静涵把她捡回来，后来两人成为家人。", ["第一次相遇", "扬州河边", "捡回来"]),
      tags: ["卢静涵", "林翩翩", "关系", "起源", "dossier"],
      importance: 5,
    };
  }
  if (text.includes("瘦西湖")) {
    return {
      localId: "place-yangzhou",
      kind: "semantic",
      title: "扬州",
      path: "places/扬州.md",
      text: "扬州与瘦西湖、东关街、富春早茶、大运河和盐商文化相连。",
      body: dossierBody("扬州", "扬州与瘦西湖、东关街、富春早茶、大运河和盐商文化相连。", ["扬州", "瘦西湖", "富春早茶", "盐商文化"]),
      tags: ["扬州", "地点", "瘦西湖", "富春早茶", "dossier"],
      importance: 4,
    };
  }
  if (text.includes("青玉案")) {
    return {
      localId: "work-qingyu-yuanxi",
      kind: "semantic",
      title: "青玉案·元夕",
      path: "works/青玉案-元夕.md",
      text: "《青玉案·元夕》是辛弃疾写元宵夜灯火、人群和蓦然回首的词。",
      body: dossierBody("青玉案·元夕", "《青玉案·元夕》是辛弃疾写元宵夜灯火、人群和蓦然回首的词。", ["辛弃疾", "元夕", "蓦然回首"]),
      tags: ["青玉案", "元夕", "辛弃疾", "dossier"],
      importance: 5,
    };
  }
  return undefined;
}

function dossierBody(title: string, stableMemory: string, cues: string[]): string {
  return [
    `# ${title}`,
    "",
    "## Stable Memory",
    "",
    stableMemory,
    "",
    "## Recall Cues",
    "",
    ...cues.map((cue) => `- ${cue}`),
  ].join("\n");
}

function hasSource(items: { sourcePath?: string }[], sourcePath: string): boolean {
  return items.some((item) => item.sourcePath === sourcePath);
}

function printSection(name: string): void {
  console.log(`\n[${name}]`);
}

function pass(condition: boolean, message: string): void {
  if (!condition) {
    console.log(`FAIL ${message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`PASS ${message}`);
}
