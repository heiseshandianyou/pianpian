import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AutonomousRuntime, MemoryStore } from "../index.js";

const memoryRoot = await mkdtemp(path.join(tmpdir(), "pianpian-episode-archive-"));
const memory = new MemoryStore(memoryRoot);
const runtime = new AutonomousRuntime(memory, undefined, {
  useConfiguredLlm: false,
  useLlmForCompanion: false,
  useLlmForMemoryFormation: false,
  asyncMemoryFormation: false,
  memoryVaultPath: memoryRoot,
});

await runtime.step("记住：辛弃疾有一首词叫《青玉案·元夕》，写的是元宵夜灯火、人群和蓦然回首的相遇。");
await runtime.step("记住《青玉案·元夕》的名句：众里寻他千百度，蓦然回首，那人却在，灯火阑珊处。");
const check = await runtime.step("如果我说蓦然回首、灯火阑珊，你会想到什么？");

const dossierPath = path.join(memoryRoot, "literature", "青玉案-元夕.md");
const dossier = await readFile(dossierPath, "utf8");
const activeEpisodes = memory
  .listActive(100)
  .filter((item) => item.kind === "episode" && item.text.includes("记住") && item.text.includes("青玉案"));
const archivedEpisodes = memory
  .list(100)
  .filter((item) => item.kind === "episode" && item.status === "archived" && item.text.includes("记住") && item.text.includes("青玉案"));
const recalledArchive = memory.retrieve("蓦然回首 灯火阑珊 青玉案 元夕 辛弃疾", 8);

printSection("dossier");
pass(dossier.includes("青玉案·元夕"), "created literature/青玉案-元夕.md");
pass(dossier.includes("辛弃疾"), "dossier includes author");
pass(dossier.includes("灯火阑珊"), "dossier includes trigger imagery");

printSection("episodes");
pass(archivedEpisodes.length >= 2, `source episodes archived=${archivedEpisodes.length}`);
pass(activeEpisodes.length === 0, "source Qingyu episodes no longer remain active");

printSection("recall");
pass(
  recalledArchive.some((item) => item.sourcePath === "literature/青玉案-元夕.md"),
  "recall uses the dossier memory",
);
pass(
  check.activatedMemory.focusNodes.some((node) => node.memory.sourcePath === "literature/青玉案-元夕.md"),
  "runtime context activates the dossier",
);

memory.close();

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
