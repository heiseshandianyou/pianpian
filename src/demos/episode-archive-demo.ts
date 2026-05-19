import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AutonomousRuntime, MemoryStore } from "../index.js";
import type { ChatMessage, LlmProvider } from "../llm/types.js";

const memoryRoot = await mkdtemp(path.join(tmpdir(), "pianpian-episode-archive-"));
const memory = new MemoryStore(memoryRoot);
const runtime = new AutonomousRuntime(memory, undefined, {
  llm: archiveDemoLlm(),
  useConfiguredLlm: false,
  useLlmForCompanion: false,
  useLlmForMemoryFormation: true,
  asyncMemoryFormation: false,
  memoryVaultPath: memoryRoot,
});

await runtime.step("记住：辛弃疾有一首词叫《青玉案·元夕》，写的是元宵夜灯火、人群和蓦然回首的相遇。");
await runtime.step("记住《青玉案·元夕》的名句：众里寻他千百度，蓦然回首，那人却在，灯火阑珊处。");
const check = await runtime.step("如果我说蓦然回首、灯火阑珊，你会想到什么？");

const dossierPath = path.join(memoryRoot, "works", "青玉案-元夕.md");
const dossier = await readFile(dossierPath, "utf8");
const activeEpisodes = memory
  .listActive(100)
  .filter((item) => item.kind === "episode" && item.text.includes("青玉案"));
const archivedEpisodes = memory
  .list(100)
  .filter((item) => item.kind === "episode" && item.status === "archived" && item.text.includes("青玉案"));
const recalledArchive = memory.retrieve("蓦然回首 灯火阑珊 青玉案 元夕 辛弃疾", 8);

printSection("dossier");
pass(dossier.includes("青玉案·元夕"), "created works/青玉案-元夕.md");
pass(dossier.includes("辛弃疾"), "dossier includes author");
pass(dossier.includes("灯火阑珊"), "dossier includes trigger imagery");

printSection("episodes");
pass(archivedEpisodes.length >= 2, `source episodes archived=${archivedEpisodes.length}`);
pass(activeEpisodes.length === 0, "source Qingyu episodes no longer remain active");

printSection("recall");
pass(
  recalledArchive.some((item) => item.sourcePath === "works/青玉案-元夕.md"),
  "recall uses the dossier memory",
);
pass(
  check.activatedMemory.focusNodes.some((node) => node.memory.sourcePath === "works/青玉案-元夕.md"),
  "runtime context activates the dossier",
);

memory.close();

function archiveDemoLlm(): LlmProvider {
  return {
    async generate(messages: ChatMessage[]) {
      const system = messages[0]?.content ?? "";
      if (system.includes("EpisodeArchiveAgent")) {
        const payload = JSON.parse(messages[1]?.content ?? "{}") as {
          sourceEpisodes?: Array<{ id: string; text: string }>;
        };
        const episodes = payload.sourceEpisodes?.filter((item) => item.text.includes("青玉案")) ?? [];
        if (episodes.length < 2) {
          return "{}";
        }
        return JSON.stringify({
          memoryFormation: {
            nodes: [
              {
                localId: "work-qingyu-yuanxi",
                kind: "semantic",
                text: "《青玉案·元夕》是辛弃疾写元宵夜灯火、人群和蓦然回首的词；灯火阑珊是重要召回线索。",
                importance: 5,
                confidence: 0.96,
                pinned: true,
                tags: ["青玉案", "元夕", "辛弃疾", "灯火阑珊"],
              },
            ],
            edges: episodes.map((episode) => ({
              fromMemoryId: episode.id,
              toLocalId: "work-qingyu-yuanxi",
              relation: "derived_from",
              strength: 0.92,
              confidence: 0.95,
            })),
            vaultWrites: [
              {
                localId: "vault-work-qingyu-yuanxi",
                title: "青玉案·元夕",
                path: "works/青玉案-元夕.md",
                anchor: "work-qingyu-yuanxi",
                body: [
                  "# 青玉案·元夕",
                  "",
                  "## Stable Memory",
                  "",
                  "《青玉案·元夕》是辛弃疾写元宵夜灯火、人群和蓦然回首的词。",
                  "",
                  "## Recall Cues",
                  "",
                  "- 辛弃疾",
                  "- 元宵夜",
                  "- 蓦然回首",
                  "- 灯火阑珊",
                  "",
                  "## Evidence",
                  "",
                  ...episodes.map((episode) => `- ${episode.id}: ${episode.text}`),
                ].join("\n"),
                memoryLocalIds: ["work-qingyu-yuanxi"],
                tags: ["青玉案", "元夕", "辛弃疾", "dossier"],
                importance: 5,
                kind: "semantic",
              },
            ],
            rationale: "The archive agent selected a work dossier based on the related episodes.",
          },
          archiveSourceMemoryIds: episodes.map((episode) => episode.id),
          confidence: 0.88,
          summary: "Archived Qingyu Yuanxi episodes into a work dossier.",
        });
      }

      const payload = JSON.parse(messages[1]?.content ?? "{}") as { perception?: { text?: string; source?: string } };
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
        rationale: "Demo LLM keeps memory formation to raw episode so EpisodeArchiveAgent can own dossier formation.",
      });
    },
  };
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
