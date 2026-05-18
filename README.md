# Pianpian

Pianpian is a TypeScript-first autonomous multi-agent core with durable long-term memory. The desktop pet is one possible body; the runtime, memory system, and agent coordination loop are the stable core.

## Current Shape

- Autonomous runtime loop: perceive, retrieve memories, compile context, run agents, choose actions, and write new memories.
- SQLite long-term memory: episodes, semantic facts, goals, preferences, reflections, relationships, and self-model records.
- Markdown Memory Vault: durable high-value memories can be mirrored into human-readable `.md` files while SQLite keeps the graph index.
- Vault import and sync: Markdown files can be parsed back into memory formation plans, and memory corrections can sync status back to frontmatter.
- Memory activation graph: recall starts from text, identity continuity, pinned memories, entities, and relation-edge propagation.
- Context compiler: activated memories are compressed into structured prompt sections for agents.
- Specialist agents: memory curator, planner, reflector, companion, actor, policy, self-model, and director.
- Async memory formation: normal conversation returns quickly while MemoryFormationAgent runs in the background.
- Synchronous memory commands: explicit requests such as `记住` or `remember this` force memory formation before the reply.
- Desktop shell: Electron UI for conversation, route, tools, memory stats, and recent memories.
- Desktop backend sidecar: Electron never loads native SQLite modules directly; it talks to a local Node backend process.
- Action/tool loop: safe read-only tools can be proposed, executed, and distilled into memory.
- Memory correction and inspection: recalled memories can be explained, archived, pinned, reinforced, or downgraded.
- Active host: internal heartbeat loop for idle autonomy.
- Forgetting and consolidation: retention scoring, archival, duplicate consolidation, and semantic compression.

## Project Structure

```text
src/
  agents/      Specialist agents for memory, planning, reflection, policy, and companion replies.
  actor/       Action execution for say/tool/wait-style actions.
  context/     Context compiler that turns activated memory graphs into prompt sections.
  desktop/     Electron shell, preload bridge, and Node backend sidecar.
  llm/         DeepSeek-compatible LLM provider.
  memory/      SQLite store, activation engine, consolidation, and inspection.
  policy/      Action gate and risk review.
  runtime/     Autonomous runtime, heartbeat host, drive system, and intent router.
  tools/       Tool registry, including memory/project/Codex-oriented tools.
  vault/       Markdown Memory Vault and bridge code for file-backed long-term memory.
```

## Run

```bash
npm install
npm run typecheck
npm run build
npm run desktop
```

CLI session:

```bash
npm run session
npm run session:once -- "检查一下当前项目状态和记忆统计。"
```

Demos:

```bash
npm run demo
npm run active-demo
npm run consolidation-demo
npm run llm-consolidation-demo
npm run entity-demo
npm run entity-recall-demo
npm run intent-router-demo
npm run memory-correction-demo
npm run memory-inspector-demo
npm run memory-inspector-tool-demo
npm run markdown-memory-vault-demo
npm run vault-import-demo
npm run vault-rebuild-demo
npm run vault-correction-sync-demo
npm run maintenance-demo
npm run self-model-demo
npm run policy-demo
npm run actor-demo
npm run tool-demo
npm run tool-loop-demo
npm run codex-tool-demo
```

Persistent session commands:

```text
/help              Show commands.
/stats             Show memory counts.
/memories [limit]  Show recent memories.
/exit              Quit.
```

## Configuration

Copy `.env.example` to `.env` and fill in local secrets. Never commit `.env`.

```text
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_THINKING=true
DEEPSEEK_REASONING_EFFORT=medium
```

Runtime switches:

```text
PIANPIAN_NO_LLM=1             Disable configured LLM usage.
PIANPIAN_MEMORY_LLM=0         Disable LLM memory formation.
PIANPIAN_COMPANION_LLM=0      Disable LLM companion replies.
PIANPIAN_SYNC_MEMORY=1        Force all memory formation to run synchronously.
PIANPIAN_MEMORY_PATH=...      Use a custom SQLite memory path.
PIANPIAN_MEMORY_VAULT_PATH=... Use a custom Markdown Memory Vault path.
```

## Design Direction

1. Make memory trustworthy: deduplication, conflict handling, importance decay, consolidation, and source provenance.
2. Make autonomy observable: heartbeat logs, visible background tasks, action policies, and confirmation gates.
3. Make the agent more alive: living state, drives, mood/energy, self-narrative, and desktop presence.
4. Make tools useful: Codex workflows, local project inspection, safe file operations, and user-approved external actions.

Detailed design:

- [Memory Agent System Design](docs/memory-agent-system-design.md)
- [Architecture](docs/architecture.md)
- [DeepSeek Integration](docs/deepseek-integration.md)

## Philosophy

Autonomy should be bounded before it becomes powerful. Pianpian can remember, plan, reflect, and propose freely, but actions that touch files, network, apps, money, accounts, or privacy should pass through explicit policy gates.
