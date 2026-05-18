# Pianpian Agent Architecture

Pianpian is designed as an autonomous multi-agent core first. A desktop pet can be one client, but the core should also run headless as a local background process.

## Loop

The runtime follows a small durable loop:

1. Perceive an event from the user, system, clock, file watcher, or desktop environment.
2. Route the event into an intent mode.
3. Retrieve relevant long-term memories.
4. Ask only the selected specialist agents for proposals.
5. Let the director choose actions.
6. Execute actions through tools or UI clients.
7. Store episodes, extracted facts, goals, and reflections.

## Intent Routing

`IntentRouter` classifies each perception before agent execution. Current modes:

- `conversation`: default memory formation and response.
- `memory-correction`: user wants to archive, pin, unpin, reinforce, or downgrade memory.
- `memory-inspection`: user asks why something was recalled.
- `tool-status`: user asks for project, workspace, progress, or memory status.
- `tool-result-recall`: user asks about previous tool outputs rather than requesting a fresh tool run.
- `development`: user asks to implement, build, fix, refactor, or start the next phase.
- `autonomous-maintenance`: internal heartbeat or maintenance perception.

Each route carries selected agent IDs. This prevents every agent from running on every cycle and keeps side-effect opportunities narrower.

## Persistent Session

`session-cli` is the first persistent local runtime entrypoint:

1. It opens one `MemoryStore` for the whole process.
2. It creates one `AutonomousRuntime`.
3. Each user line runs a complete runtime cycle.
4. Results show the selected route, selected agents, tool outputs, and user-facing response.
5. Slash commands provide local inspection:
   - `/stats`
   - `/memories [limit]`
   - `/help`
   - `/exit`

The same entrypoint supports `--once` for smoke tests and scripted use, and `--memory :memory:` for temporary sessions.

## Desktop Shell

The first Electron shell wraps the same runtime in a local UI:

1. The main process owns `MemoryStore` and `AutonomousRuntime`.
2. A preload script exposes a narrow IPC API:
   - `step(input)`
   - `stats()`
   - `memories(limit)`
3. The renderer shows:
   - conversation messages,
   - current route and selected agents,
   - tool outputs,
   - memory statistics,
   - recent memory records.
4. The UI is intentionally read-only except for submitting user input; risky actions still pass through the existing policy gate.

This is not the animated pet body yet. It is the first desktop control panel for the autonomous memory core.

## Agent Roles

- `director`: arbitrates proposals and chooses the next action.
- `memory-curator`: forms memory nodes and relational edges from experience.
- `self-model`: maintains identity, mission, autonomy level, and safety boundaries.
- `planner`: turns goals and context into concrete next steps.
- `reflector`: compresses completed cycles into lessons.
- `companion`: keeps personality and user-facing continuity.
- `actor`: future role for real tool execution.

The memory formation role is intentionally an agent rather than a database hook. It decides what the experience means, which stable nodes should exist, and how those nodes relate to the source episode or previous memories.

## Long-Term Memory

The first storage layer is SQLite because it is local, durable, inspectable, and easy to ship with a desktop app.

Memory kinds:

- `episode`: raw things that happened.
- `semantic`: stable facts about the world or project.
- `goal`: durable objectives.
- `preference`: user preferences and relationship continuity.
- `reflection`: compressed lessons from prior cycles.

Future layers can add embeddings for semantic recall, decay policies, memory conflict resolution, and nightly consolidation.

The memory model should evolve from flat records into a high-dimensional network:

- memory nodes store experiences, goals, preferences, reflections, and semantic abstractions.
- memory edges store relations such as `derived_from`, `supports`, `contradicts`, `same_goal`, and `reinforces`.
- activation engines should retrieve a subgraph by spreading activation from the current state instead of selecting isolated top-k records.

### Markdown Memory Vault

SQLite remains the graph index, but durable high-value memories can now be mirrored into a Markdown Memory Vault:

- Markdown files hold human-readable memory bodies, identity notes, relationships, preferences, goals, and reflections.
- SQLite keeps activation metadata, source provenance, entity links, FTS index, status, confidence, importance, and access counters.
- Memory records can point back to Vault documents with `storageKind`, `sourcePath`, and `sourceAnchor`.
- `MemoryFormationAgent` can propose `vaultWrites`; the runtime applies those writes through the same side-effect path used by synchronous and background memory formation.
- Context compilation and memory inspection expose source metadata, so a recalled memory can point back to `markdown:path#anchor`.
- Vault import helpers can parse Markdown frontmatter/body back into `MemoryFormationPlan` objects for rebuild or migration workflows.
- Memory corrections and forgetting can sync changed status back into Markdown frontmatter through per-memory `memory_states`.
- A rebuild helper can scan the Vault and repopulate an empty SQLite memory index from Markdown files.
- The desktop shell includes a read-only Vault page for browsing, searching, and dry-run rebuild previews.

## Entity Graph

The memory layer now has an entity graph alongside memory nodes:

- `entities`: stable people, projects, tools, models, files, goals, concepts, and agents.
- `memory_entities`: links memories to entities with relations such as `mentions`, `about`, `uses`, and `implements`.

`EntityExtractionAgent` runs during memory formation and attaches entity links to the formation plan. This gives recall and consolidation a stronger structure than raw tags alone.

Entity-aware recall now uses this graph directly: when the current input mentions a known entity name or alias, linked active memories become additional recall seeds.

## Autonomy

Autonomy should be explicit and bounded. The runtime can wake up on schedules, react to events, and propose actions, but higher-risk actions should require user confirmation until trust policies are implemented.

The useful near-term autonomy levels are:

- Level 1: responds only when called.
- Level 2: runs scheduled reflection and memory consolidation.
- Level 3: monitors allowed sources and drafts actions.
- Level 4: executes approved low-risk routines.
- Level 5: broad autonomous operation with policy gates and audit logs.

## Active Agent Host

The core runtime handles one thought cycle. The active host keeps the agent alive by sending internal heartbeat perceptions into the same runtime:

1. The host wakes on a timer or external event.
2. The drive system chooses an internal motive such as continuity, memory consolidation, or project progress.
3. The host creates an `internal` perception.
4. The normal runtime retrieves memory, runs agents, chooses actions, and writes new memories.
5. Every few cycles, the memory store applies a forgetting policy.

This keeps user messages, system events, and the agent's private thoughts inside one event stream instead of creating a separate hidden brain.

## Activation Recall

Recall now begins as graph activation rather than flat top-k retrieval:

1. Full-text search finds seed memory nodes for the current perception.
2. Entity matching finds mentioned known entities and retrieves memories linked through `memory_entities`.
3. Pinned continuity memories are included as self-model and safety anchors.
4. Each seed receives initial activation from importance, confidence, and reuse.
5. Activation spreads through memory edges for a bounded depth.
6. Relation type changes propagation strength.
7. The runtime receives a ranked `ActivatedMemoryGraph` with entity nodes, focus nodes, support nodes, contradiction nodes, and an activation trace.

This is the first implementation of the high-dimensional memory idea. It does not yet use embeddings, but the interface is ready for vector seeds and richer relation dynamics.

## Context Compiler

The runtime now compiles activated memory into a structured context package before agents deliberate:

1. Deduplicate activated nodes by kind and text.
2. Render activated entities into a dedicated `Relevant Entities` section.
3. Allocate memories into focus, goals, preferences, long-term memory, uncertainty, and evidence sections.
4. Render a prompt-shaped context block.
5. Preserve a context trace explaining why each memory or entity entered each section.

Agents should increasingly depend on `compiledContext` rather than raw memory lists. The raw activated graph remains available for specialized agents that need lower-level detail.

## Response Composition

The user-facing response now comes from `CompanionAgent`, not from the planner:

1. `PlannerAgent` reads compiled context and proposes the next internal direction.
2. `CompanionAgent` turns compiled context into a `say` action.
3. If an LLM provider is configured, the companion asks it to write a concise answer grounded in the compiled context.
4. If the provider is unavailable, the companion falls back to a deterministic context summary.
5. `DirectorAgent` selects the proposed `say` action and the policy gate treats it as safe.

This separates planning from communication. The agent can now recall entities and memories, then use them directly in the answer instead of emitting a fixed template.

## Self Model

The runtime now maintains self-model memories as pinned graph nodes. These memories represent:

- identity: what Pianpian is,
- mission: what the current project is building,
- autonomy level: what idle action is allowed,
- boundaries: which actions require explicit user confirmation.

Pinned self-model memories are included during recall even when the current query does not directly match them. This keeps identity and safety constraints active as part of the memory network instead of only as static prompt text.

## Policy Gate

Actions now pass through a policy gate before they are exposed as runtime output:

1. The director selects proposed actions from agent proposals.
2. `PolicyAgent` classifies each action as safe, low, medium, high, or blocked.
3. Safe and low-risk conversational actions are allowed.
4. Medium and high-risk actions become `ask-user` confirmation actions.
5. Unknown action types are blocked by default.

This is the first enforcement layer for autonomous behavior. It keeps self-model safety boundaries connected to actual action flow rather than leaving them as descriptive memory only.

## Actor Execution

The actor layer executes only policy-approved low-risk actions:

1. Agents propose actions.
2. The director selects actions.
3. The policy gate classifies risk.
4. The action executor executes allowed actions and skips gated actions.
5. Runtime stores successful execution results as action episodes.

Current executors are intentionally conservative:

- `say`: returns conversational output.
- `remember`: records an accepted remember request.
- `wait`: records a wait result.
- `ask-user`: surfaces the confirmation or question.

File writes, tool calls, external messages, and deletion remain gated until explicit approval and dedicated executors are added.

## Tool Registry

The actor layer now has a small tool registry. Tools declare a name, description, risk level, and executor.

Current safe tools:

- `memory.stats`: read-only memory counts.
- `project.status`: read-only project cwd/status.

Policy allows registered `safe` tools to execute automatically. Unknown tools or tools that are not classified as safe require confirmation. This lets the agent begin doing useful local introspection without opening broad side-effectful execution.

## Action-Oriented Tool Loop

The actor can now propose safe read-only tools during normal runtime cycles:

1. `ActorAgent` inspects the current perception for status or stats requests.
2. It proposes `tool` actions such as `memory.stats` and `project.status`.
3. `PolicyAgent` allows registered safe tools and gates unknown or risky tools.
4. `ActionExecutor` runs allowed tools.
5. `AutonomousRuntime` records tool execution output as episode memory with the tool name in the text and tags.
6. Later recall can retrieve those tool results by tool name or execution context.

This gives Pianpian the first small loop of perception, tool use, memory writeback, and later recall.

## Tool Result Reflection

Tool execution output is now split into two memory layers:

1. Runtime first stores the raw execution as an `episode`.
2. `ToolResultReflectionAgent` reads executed tool results and their metadata.
3. Stable results become `semantic` memories such as:
   - `Latest memory stats: total=..., active=..., archived=..., pinned=...`
   - `Current project workspace cwd is ...`
4. Semantic facts are linked back to the execution episode with `derived_from`.
5. Entity extraction runs on the reflected facts, so tools such as `memory.stats` and `project.status` can become entity-linked context.

This prevents the agent from treating every tool output as a raw log forever. The log remains inspectable, while the distilled fact becomes easier to recall and reason over.

## Memory Correction

User feedback can now change memory state instead of only adding more memories:

1. `MemoryCorrectionAgent` detects explicit feedback such as wrong, incorrect, do not remember, pin this, unpin, downgrade, or reinforce.
2. It selects likely target memories from the currently activated memory graph.
3. `MemoryStore.applyCorrection` performs the requested operation:
   - archive incorrect or unwanted memories,
   - pin or unpin important memories,
   - reinforce useful memories,
   - downgrade less-important memories.
4. Runtime records a correction note with a report such as `archive changed=1/1`.
5. Archived memories remain inspectable but stop appearing in normal active recall.

The actor intentionally does not run tools during explicit memory-correction requests. This prevents a correction like "that memory stats fact is wrong" from immediately generating a fresh tool result before the correction is applied.

## Memory Inspector

The memory system now has an explainability layer for activated recall:

1. `MemoryInspector` receives an `ActivatedMemoryGraph` and optional `CompiledContext`.
2. It explains each inspected memory node with:
   - activation amount and depth,
   - activation reasons,
   - activation trace entries,
   - context sections where the memory was used,
   - graph edges touching the memory,
   - linked entities from `memory_entities`.
3. The inspector can render a Markdown report for CLI, logs, or a future desktop inspection panel.

This makes memory recall auditable. Instead of only seeing what the agent remembered, we can inspect why a memory appeared, which source episode it came from, and how it entered context.

## Inspector Tool

The inspector is also available as a safe runtime tool:

1. `ActorAgent` detects questions such as "why did you remember this?" or "explain recall".
2. It proposes the `memory.inspect` tool action.
3. `PolicyAgent` allows the tool because it is read-only and safe.
4. `AutonomousRuntime` precomputes the inspection report for the current cycle and passes it through `ToolContext`.
5. `ToolRegistry` returns the Markdown inspection report.

This is the first self-debugging loop: the agent can use its own explainability subsystem as a tool and surface the result to the user without requiring a separate developer demo.

## Codex Tool

The registry includes `codex.run`, a high-risk tool that invokes `codex exec` non-interactively. It is intentionally not automatic:

- default status: confirmation required,
- execution requires `metadata.confirmed === true`,
- default sandbox: `read-only`,
- optional sandbox: `workspace-write`,
- approval policy inside the subprocess: `never`, so it cannot hang waiting for nested approval.

This lets Pianpian delegate bounded coding or inspection work to Codex while keeping the autonomous policy gate in charge.

## Forgetting

Forgetting should begin as decay and archival, not hard deletion. A memory receives a retention score based on:

- importance
- confidence
- recency of access
- reuse frequency
- pinned status
- memory kind

Low-scoring memories can be archived so they stop appearing in normal recall, while still remaining inspectable for debugging or later recovery.

## Consolidation

The first consolidation pass handles exact duplicate memory nodes:

1. Scan active memories.
2. Group nodes by kind and normalized text.
3. Keep the strongest node in each duplicate cluster.
4. Archive redundant nodes.
5. Add graph edges that explain the consolidation:
   - duplicate `reinforces` kept node
   - kept node `supersedes` duplicate

This is intentionally conservative. Later consolidation should use LLM agents to merge near-duplicates and compress episode clusters into semantic abstractions.

The second consolidation pass handles related memory clusters:

1. Find candidate clusters by shared tags and meaningful words.
2. Ask `MemoryConsolidationAgent` to create one durable high-level memory.
3. Fall back to a deterministic summary if no LLM is available.
4. Archive source memories.
5. Add graph evidence:
   - source `reinforces` consolidated memory
   - consolidated memory `supersedes` source

This turns repeated low-level episodes into stable memory structure.

## Autonomous Maintenance

The active host now performs memory maintenance during idle heartbeats:

1. The drive system selects an internal motive.
2. The runtime processes the heartbeat as an `internal` perception.
3. The host runs consolidation on schedule, or immediately when the selected drive is `consolidate-memory`.
4. The host runs forgetting on its own schedule.
5. The heartbeat result returns a `MaintenanceReport` so UI or logs can show what changed.

This makes memory care part of the agent's autonomous life rather than a manual developer command.
