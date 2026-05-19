import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AutonomousRuntime, MemoryStore } from "../index.js";
import type { LlmProvider } from "../llm/types.js";

const memoryRoot = await mkdtemp(path.join(tmpdir(), "pianpian-dossier-protocol-"));
const memory = new MemoryStore(memoryRoot);
const llm: LlmProvider = {
  async generate() {
    return JSON.stringify({
      nodes: [
        {
          localId: "episode",
          kind: "episode",
          text: "User taught a durable preference about quiet pipa listening.",
          importance: 3,
          confidence: 1,
          tags: ["user", "experience", "evidence"],
        },
        {
          localId: "dossier-lujinghan-listening",
          kind: "preference",
          text: "卢静涵喜欢在安静的时候听琵琶。",
          importance: 5,
          confidence: 0.96,
          pinned: true,
          tags: ["卢静涵", "偏好", "琵琶", "安静"],
        },
      ],
      edges: [
        {
          fromLocalId: "episode",
          toLocalId: "dossier-lujinghan-listening",
          relation: "derived_from",
          strength: 1,
          confidence: 0.96,
        },
      ],
      vaultWrites: [
        {
          localId: "vault-lujinghan-listening",
          title: "卢静涵的安静听觉偏好",
          path: "people/卢静涵.md",
          anchor: "listening-preference",
          body: [
            "# 卢静涵",
            "",
            "## Stable Memory",
            "",
            "卢静涵喜欢在安静的时候听琵琶。",
            "",
            "## Evidence",
            "",
            "- 本轮对话中，静涵要求翩翩记住这个偏好。",
            "",
            "## Recall Cues",
            "",
            "- 爱好",
            "- 听琵琶",
            "- 安静的时候",
          ].join("\n"),
          memoryLocalIds: ["dossier-lujinghan-listening"],
          tags: ["卢静涵", "偏好", "琵琶", "dossier"],
          importance: 5,
          kind: "preference",
        },
      ],
      archiveLocalIds: ["episode"],
      rationale: "The agent chose a person dossier and treated the episode as evidence.",
    });
  },
};
const runtime = new AutonomousRuntime(memory, undefined, {
  llm,
  useConfiguredLlm: false,
  useLlmForCompanion: false,
  useLlmForMemoryFormation: true,
  asyncMemoryFormation: false,
  memoryVaultPath: memoryRoot,
});

const result = await runtime.step("记住：我的爱好是听琵琶，尤其喜欢夜里安静的时候听。");
const formation = result.proposals.find((proposal) => proposal.agentId === "memory-curator")?.memoryFormation;
const people = await readFile(path.join(memoryRoot, "people", "卢静涵.md"), "utf8");
const activeEpisode = memory
  .listActive(100)
  .filter((item) => item.kind === "episode" && item.text.includes("pipa"));
const archivedEpisode = memory
  .list(100)
  .filter((item) => item.kind === "episode" && item.status === "archived" && item.text.includes("pipa"));
const recalled = memory.retrieve("静涵 爱好 琵琶", 8);

printSection("formation protocol");
pass(Boolean(formation?.vaultWrites?.some((write) => write.path === "people/卢静涵.md")), "agent can choose a dossier path");
pass(formation?.archiveLocalIds?.includes("episode") === true, "agent can mark episode as evidence");

printSection("storage");
pass(people.includes("Stable Memory"), "dossier follows the file spec sections");
pass(people.includes("听琵琶"), "dossier contains the durable memory");
pass(activeEpisode.length === 0, "source episode does not remain active");
pass(archivedEpisode.length >= 1, "source episode remains archived evidence");

printSection("recall");
pass(recalled.some((item) => item.sourcePath === "people/卢静涵.md"), "recall uses the agent-authored dossier");

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
