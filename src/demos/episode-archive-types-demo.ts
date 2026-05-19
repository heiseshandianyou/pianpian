import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AutonomousRuntime, MemoryStore } from "../index.js";

const memoryRoot = await mkdtemp(path.join(tmpdir(), "pianpian-archive-types-"));
const memory = new MemoryStore(memoryRoot);
const runtime = new AutonomousRuntime(memory, undefined, {
  useConfiguredLlm: false,
  useLlmForCompanion: false,
  useLlmForMemoryFormation: false,
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
const qingyu = await readVaultFile("literature/青玉案-元夕.md");

const preferenceRecall = memory.retrieve("静涵 爱好 琵琶", 8);
const originRecall = memory.retrieve("第一次相遇 扬州 河边 捡回来 娘刚死", 8);
const placeRecall = memory.retrieve("扬州 瘦西湖 富春早茶 盐商文化", 8);
const literatureRecall = memory.retrieve("青玉案 元夕 辛弃疾 蓦然回首", 8);

printSection("dossiers");
pass(people.includes("听琵琶"), "created people/卢静涵.md with pipa preference");
pass(relationship.includes("扬州河边") && relationship.includes("捡回来"), "created relationship origin dossier");
pass(yangzhou.includes("瘦西湖") && yangzhou.includes("富春早茶"), "created Yangzhou place dossier");
pass(qingyu.includes("辛弃疾") && qingyu.includes("蓦然回首"), "created Qingyu Yuanxi literature dossier");

printSection("recall");
pass(hasSource(preferenceRecall, "people/卢静涵.md"), "preference recall uses person dossier");
pass(hasSource(originRecall, "relationships/卢静涵-林翩翩.md"), "origin recall uses relationship dossier");
pass(hasSource(placeRecall, "places/扬州.md"), "place recall uses Yangzhou dossier");
pass(hasSource(literatureRecall, "literature/青玉案-元夕.md"), "literature recall uses Qingyu dossier");

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
