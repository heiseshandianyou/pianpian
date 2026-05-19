# Memory Agent System Design

This document describes the long-term memory and autonomy architecture for Pianpian, a TypeScript-first autonomous multi-agent system. The desktop pet is only one possible body. The deeper system is an always-on agent society with a dynamic memory network.

## 0. Core Thesis

An LLM is a text input/output reasoner with a finite context window. It does not truly keep memory by itself. Pianpian therefore needs a memory operating system that decides:

1. what experiences become memory,
2. how memories connect into a high-dimensional network,
3. which memories activate in the current situation,
4. which memories fade, consolidate, or remain pinned,
5. how activated memory becomes usable LLM context,
6. how the agent maintains continuity and acts while idle.

Memory should not be modeled as a library of independent categories. It should be modeled as:

```text
memory nodes + relational edges + vector space + time + activation dynamics + agent interpretation
```

The Markdown vault stores the substrate. Agents interpret, form, recall, compress, forget, and compile it.

## 1. Overall Architecture

Pianpian is organized as an autonomous loop:

```text
Perception
  -> Memory Formation
  -> Memory Activation / Recall
  -> Context Organization
  -> Multi-Agent Deliberation
  -> Action Selection
  -> Action Execution
  -> Reflection / Consolidation / Forgetting
  -> Next Perception
```

Perceptions can come from:

- user messages
- system timers
- environment events
- tool results
- internal drives
- prior unresolved goals
- self-reflection

The same runtime should process both external and internal events. The agent's private thoughts are not a separate hidden system; they are internal perceptions that enter the same memory network.

## 1.1 Major Agents

The system should use many small agents rather than one giant prompt.

```text
MemoryFormationAgent
MemoryLinkingAgent
MemoryCriticAgent
MemoryConsolidationAgent
ForgettingAgent
RecallQueryAgent
ActivationAgent
ContextCompilerAgent
SelfModelAgent
DriveAgent
PlannerAgent
ActorAgent
ReflectionAgent
PolicyAgent
DirectorAgent
```

Each agent can be backed by an LLM call, local rules, or both. The recommended approach is hybrid:

- rules for safety, schema validation, retention scoring, and deterministic ranking,
- LLMs for interpretation, summarization, contradiction detection, abstraction, and context writing.

## 1.2 Data Substrate

Minimum viable storage:

```text
Markdown memory vault
  memories
  memory_edges
  activations
  action_log
  agent_cycles
```

Later storage layers:

```text
Vector index
  semantic similarity

Graph index
  spreading activation

Object/file store
  raw transcripts, documents, tool artifacts

Event log
  full auditability and replay
```

Markdown is the source of truth. Runtime graph structures and JSON state are indexes that can be rebuilt from readable files.

## 2. Memory Management

Memory management is the orchestration layer. It is not one storage class. It coordinates formation, retrieval, activation, consolidation, forgetting, and context compilation.

## 2.1 Responsibilities

The `MemoryManager` should provide:

```ts
interface MemoryManager {
  form(perception: Perception, state: RuntimeState): Promise<MemoryFormationResult>;
  recall(query: RecallQuery, state: RuntimeState): Promise<ActivatedMemoryGraph>;
  compileContext(graph: ActivatedMemoryGraph, state: RuntimeState): Promise<CompiledContext>;
  consolidate(scope: ConsolidationScope): Promise<ConsolidationReport>;
  forget(policy: ForgettingPolicy): Promise<ForgettingReport>;
}
```

It should not blindly trust LLM output. It validates schemas, enforces policies, handles deduplication, and writes audit logs.

## 2.2 Memory Node Model

```ts
type MemoryNode = {
  id: string;
  kind:
    | "episode"
    | "semantic"
    | "goal"
    | "preference"
    | "reflection"
    | "procedure"
    | "self_model"
    | "relationship"
    | "artifact";
  content: string;
  summary?: string;
  embedding?: number[];
  entities: string[];
  tags: string[];
  salience: number;
  importance: 1 | 2 | 3 | 4 | 5;
  confidence: number;
  emotionalWeight?: number;
  status: "active" | "dormant" | "archived" | "deleted";
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  lastActivatedAt?: string;
  accessCount: number;
  sourceEventIds: string[];
};
```

Kinds are not folders. They are projections over the same network.

## 2.3 Memory Edge Model

```ts
type MemoryEdge = {
  id: string;
  from: string;
  to: string;
  relation:
    | "derived_from"
    | "supports"
    | "contradicts"
    | "elaborates"
    | "same_entity"
    | "same_goal"
    | "temporal_neighbor"
    | "causes"
    | "blocks"
    | "reinforces"
    | "supersedes"
    | "part_of";
  strength: number;
  confidence: number;
  createdAt: string;
  lastReinforcedAt: string;
  evidenceNodeIds: string[];
};
```

Edges are as important as nodes. A memory network without edges is just a search index.

## 2.4 Memory Manager Agents

`MemoryCoordinatorAgent`

- decides which memory sub-agents should run for a cycle.
- chooses whether to form memory immediately or defer to batch consolidation.
- enforces token and cost budgets.

`MemoryCriticAgent`

- checks whether a proposed memory is too vague, redundant, unsafe, or unsupported.
- detects contradictions with active high-confidence memories.
- asks for clarification when a memory would be risky to commit.

`MemorySchemaAgent`

- normalizes LLM outputs into strict schemas.
- repairs malformed JSON.
- assigns missing metadata conservatively.

## 3. Memory Formation

Memory formation is the act of turning experience into durable structure. It must be agentic because the system has to interpret meaning, not just store text.

## 3.1 Formation Pipeline

```text
Raw perception
  -> event record
  -> candidate extraction
  -> node proposal
  -> edge proposal
  -> critique
  -> dedupe / merge
  -> commit
  -> audit log
```

## 3.2 Formation Agents

`MemoryFormationAgent`

- reads the current perception and active context.
- proposes new episode, semantic, goal, preference, procedure, reflection, or self-model nodes.
- explains why each proposed memory should exist.

`MemoryLinkingAgent`

- links new nodes to prior nodes.
- proposes relations like `derived_from`, `supports`, `contradicts`, `same_goal`, and `supersedes`.
- strengthens existing edges when a pattern repeats.

`MemoryCriticAgent`

- rejects memories that are too broad, ungrounded, or duplicated.
- marks low-confidence interpretation as provisional.

`EntityAgent`

- extracts people, projects, tools, documents, places, and recurring concepts.
- maintains stable entity IDs across sessions.

`PreferenceAgent`

- watches for durable user preferences.
- distinguishes one-off instructions from long-term preferences.

`GoalAgent`

- extracts user goals, agent goals, abandoned goals, blocked goals, and recurring project direction.

## 3.3 LLM Use

LLMs are valuable here because memory formation requires interpretation:

```text
"The user says the pet is only an outer shell"
  -> semantic memory:
     "The core product is an autonomous memory-based multi-agent system; UI is secondary."
```

The LLM should return structured proposals:

```ts
type MemoryFormationPlan = {
  nodes: ProposedMemoryNode[];
  edges: ProposedMemoryEdge[];
  rejectedCandidates: RejectedMemoryCandidate[];
  rationale: string;
};
```

The runtime then validates and commits the plan.

## 3.4 Formation Rules

Do form memory when:

- the user states a durable preference,
- a project decision is made,
- a goal is created, changed, blocked, or completed,
- the agent learns a reusable procedure,
- a contradiction appears,
- a repeated pattern becomes stable.

Do not form durable memory when:

- the content is a temporary command,
- the fact is obvious from immediate context,
- the memory would be unsupported speculation,
- the memory is sensitive and not needed,
- the memory duplicates an existing stronger node.

## 3.5 Example

Input:

```text
记忆不是像一个图书馆，而是一个高维度网状结构。
```

Formation:

```text
Episode node:
  User stated that memory should be a high-dimensional network, not a library.

Semantic node:
  Pianpian's memory model should use graph/vector/time activation, not independent categories.

Edge:
  episode -> semantic, relation=derived_from

Edge:
  semantic -> existing memory-manager goal, relation=supports
```

## 4. Memory Forgetting

Forgetting is not failure. Forgetting is memory hygiene. A long-running agent must let low-value details fade while preserving durable structure.

## 4.1 Forgetting Modes

Pianpian should support several forgetting modes:

```text
Decay
  Lower activation and salience over time.

Dormancy
  Keep memory stored but remove it from normal recall.

Archival
  Hide memory from active context but keep it inspectable.

Consolidation
  Replace many low-level episodes with one higher-level abstraction.

Supersession
  Mark old memories as replaced by newer, better memories.

Deletion
  Hard delete only for explicit user request, privacy policy, or corruption.
```

## 4.2 Forgetting Score

For each memory:

```text
retention =
  importance
+ confidence
+ salience
+ recent activation
+ repeated usefulness
+ relationship value
+ active goal relevance
+ pinned protection
- age decay
- contradiction penalty
- redundancy penalty
- sensitivity penalty
```

Low retention does not mean immediate deletion. It usually means dormancy or archival.

## 4.3 Forgetting Agents

`ForgettingAgent`

- proposes which memories should decay, sleep, archive, merge, or be deleted.
- explains why.

`ConsolidationAgent`

- compresses clusters of repeated episode nodes into semantic nodes.
- reduces the weight of source details after abstraction.

`ContradictionResolverAgent`

- identifies conflicts.
- proposes `supersedes` edges or asks the user for clarification.

`PrivacyAgent`

- detects sensitive memory.
- applies stricter retention and recall rules.

## 4.4 LLM Use

LLMs are useful for consolidation:

```text
Input cluster:
  User said TypeScript is preferred.
  User repeated TypeScript.
  User avoided Python.

Consolidated memory:
  The user strongly prefers TypeScript for this project unless there is a compelling technical reason.
```

The LLM should not decide hard deletion alone. Deletion requires deterministic policy or explicit user request.

## 4.5 Forgetting as Edge Weakening

In a network model, forgetting often means:

- weaken edges,
- lower salience,
- increase activation threshold,
- archive source details,
- keep the consolidated abstraction.

This avoids the brittle behavior of deleting random records.

## 5. Memory Recall

Recall is not file search. Recall is activation.

The correct question is:

```text
Given the current state, which part of the memory network should become active?
```

## 5.1 Recall Pipeline

```text
Current state
  -> RecallQueryAgent
  -> seed retrieval
  -> spreading activation
  -> ranking and inhibition
  -> activated subgraph
  -> recall explanation
```

## 5.2 Recall Query

```ts
type RecallQuery = {
  rawInput: string;
  taskIntent: string;
  entities: string[];
  activeGoals: string[];
  drives: string[];
  neededMemoryKinds: MemoryKind[];
  timeScope: "recent" | "long_term" | "all";
  riskLevel: "low" | "medium" | "high";
};
```

`RecallQueryAgent` should infer what the agent needs to know, not simply search the user's words.

## 5.3 Multi-Source Seed Retrieval

Seed nodes come from:

- lexical and section-level search,
- vector search,
- active goals,
- recently activated nodes,
- pinned self-model memories,
- current entities,
- active drives,
- unresolved tasks,
- tool or file context.

## 5.4 Spreading Activation

Activation should propagate through edges:

```text
node activation =
  seed score
+ incoming activation * edge strength * relation weight * time decay
```

Different relations behave differently:

- `supports` spreads positive activation.
- `contradicts` activates counter-evidence.
- `same_goal` pulls in planning context.
- `temporal_neighbor` pulls in recent sequence.
- `supersedes` suppresses old nodes.
- `derived_from` can pull raw evidence if needed.

## 5.5 Recall Agents

`ActivationAgent`

- runs graph activation.
- returns a scored subgraph.

`RecallCriticAgent`

- checks whether recall is missing obvious context.
- asks for a second retrieval pass when needed.

`CounterMemoryAgent`

- intentionally searches for contradictory or cautionary memories.
- prevents the agent from overfitting to a convenient memory.

`EvidenceAgent`

- attaches supporting source nodes to high-level claims.
- helps the model avoid unsupported confidence.

## 5.6 Activated Memory Graph

```ts
type ActivatedMemoryGraph = {
  focusNodes: ActivatedMemoryNode[];
  supportNodes: ActivatedMemoryNode[];
  contradictionNodes: ActivatedMemoryNode[];
  sourceEvidenceNodes: ActivatedMemoryNode[];
  suppressedNodes: ActivatedMemoryNode[];
  activationTrace: ActivationTrace[];
};
```

This graph is the raw material for context organization.

## 6. Context Organization

Context organization is the final step before the LLM thinks. It converts an activated memory graph into a carefully shaped context package.

The goal is not to include many memories. The goal is to include the right memories in the right form.

## 6.1 Context Compiler Pipeline

```text
ActivatedMemoryGraph
  -> cluster
  -> dedupe
  -> resolve contradictions
  -> summarize
  -> allocate token budget
  -> compose context sections
  -> validate context
```

## 6.2 Context Sections

Recommended compiled context:

```text
Identity / Self Model
Current Situation
Active Goals
Relevant Long-Term Memory
User Preferences
Relationship Continuity
Project Decisions
Procedures / Skills
Contradictions / Uncertainty
Action Policies
Available Tools
Recent Events
```

The section order should change based on task. For example, coding tasks need project decisions and procedures early. Emotional companion tasks need relationship continuity and preferences early.

## 6.3 Context Compiler Agents

`ContextCompilerAgent`

- writes the final context package.
- transforms memory nodes into concise, task-useful text.

`BudgetAgent`

- allocates token budget across sections.
- decides what to summarize, include verbatim, or omit.

`ContradictionPresenterAgent`

- ensures unresolved contradictions appear explicitly.

`PromptSanityAgent`

- checks whether the final context is too long, stale, biased, or missing the current task.

## 6.4 Context Budgeting

Even with a 100M token window, context should be curated. Large context can still dilute attention.

Budget categories:

```text
system identity
current task
active goals
critical memories
supporting evidence
recent events
tool state
scratchpad
```

The compiler should prefer:

- stable abstractions over raw episodes,
- raw evidence only when grounding matters,
- contradictions when decisions are risky,
- recent events when continuity matters,
- pinned preferences when user experience matters.

## 6.5 Output

```ts
type CompiledContext = {
  system: string;
  developer?: string;
  memoryContext: string;
  taskContext: string;
  toolContext?: string;
  uncertainty: string[];
  omittedButRelevant: string[];
  trace: ContextTrace[];
};
```

The trace matters. The agent should be able to explain why a memory entered context.

## 7. Autonomous Action and Self-Awareness

Pianpian should remain active even when the user gives no direct task. But autonomy should be bounded, inspectable, and policy-controlled.

## 7.1 Internal Drives

The agent should have drives such as:

```text
Maintain continuity
Consolidate memory
Resolve uncertainty
Advance active goals
Check stalled tasks
Improve self-model
Protect user trust
Explore permitted environment
Prepare useful suggestions
```

Drives produce internal perceptions:

```text
Internal heartbeat:
  "Review active goals and find one safe useful next action."
```

These internal perceptions enter the same runtime loop as user input.

## 7.2 Self Model

Self-awareness here should be functional, not mystical. The agent needs a maintained model of:

- identity,
- goals,
- limits,
- permissions,
- capabilities,
- past commitments,
- relationship with the user,
- uncertainty about itself,
- current autonomy level.

Self model memory nodes should be explicit:

```text
I am Pianpian's autonomous agent core.
My current project priority is memory architecture.
I should not take high-risk external actions without user confirmation.
I should keep user preferences stable across sessions.
```

Current implementation status:

- `SelfModelAgent` writes pinned `self_model` memories for identity, mission, autonomy level, and high-risk action boundaries.
- pinned self-model memories are included in recall as continuity seeds.
- `ContextCompiler` renders a dedicated `[Self Model]` section.
- `self-model-demo` verifies that the second cycle recalls the pinned self model.

## 7.3 Autonomy Levels

```text
Level 0: passive response only.
Level 1: internal reflection and memory consolidation.
Level 2: draft plans and suggestions while idle.
Level 3: execute approved low-risk local actions.
Level 4: monitor permitted sources and act within policy.
Level 5: broad autonomous operation with strong audit and rollback.
```

Start at Level 1 or Level 2.

## 7.4 Autonomous Agents

`DriveAgent`

- chooses the current internal motive.
- balances curiosity, usefulness, safety, and cost.

`SelfModelAgent`

- maintains self-model memory.
- updates commitments and limitations.

`PlannerAgent`

- turns active goals into candidate plans.

`ActorAgent`

- executes approved actions.
- emits tool results as new perceptions.

`PolicyAgent`

- classifies risk.
- decides whether an action needs confirmation.

`ReflectionAgent`

- reviews completed cycles.
- creates reflection memories and procedure memories.

`DirectorAgent`

- arbitrates between agents.
- chooses the final action or non-action.

## 7.5 Autonomous Cycle

```text
timer wakes host
  -> DriveAgent chooses drive
  -> internal perception enters runtime
  -> recall activates relevant self/goals/memories
  -> context compiler creates working context
  -> planner proposes action
  -> policy checks action
  -> actor executes or asks user
  -> result becomes new perception
  -> memory formation stores what happened
  -> reflection updates self-model
```

## 7.6 Action Safety

Actions should be divided into risk bands:

```text
Safe:
  internal reflection, memory consolidation, local draft creation

Low:
  read allowed files, summarize known data, prepare suggestions

Medium:
  modify project files, start local services, schedule reminders

High:
  send messages, spend money, delete data, access private accounts, publish externally
```

Medium and high actions need explicit policy handling. High actions usually require user confirmation.

Current implementation status:

- `PolicyAgent` classifies action risk.
- `ActionGate` converts medium/high-risk actions into confirmation requests.
- runtime returns `policyDecisions` alongside gated actions.
- `policy-demo` verifies safe, medium, and high-risk behavior.

## 8. Implementation Roadmap

## Phase 1: Memory Graph Core

- store nodes and edges,
- make memory formation agent produce graph plans,
- add audit logs,
- expose graph inspection.

## Phase 2: Activation Recall

- implement seed retrieval,
- implement graph spreading activation,
- return activated subgraphs,
- add recall traces.

Current implementation status:

- `MemoryActivationEngine` uses full-text seed retrieval.
- activation spreads through `memory_edges` up to a bounded depth.
- runtime passes `ActivatedMemoryGraph` into every agent context.
- demo output includes focus nodes and activation traces.

## Phase 3: Context Compiler

- compile activated graph into context sections,
- add token budgeting,
- add contradiction presentation,
- add traceable omissions.

Current implementation status:

- `ContextCompiler` deterministically compiles activated memory into context sections.
- runtime injects `compiledContext` into every agent.
- `PlannerAgent` now reads compiled context instead of only raw memories.
- demo output includes compiled prompt text and context trace.

## Phase 4: Forgetting and Consolidation

- implement decay,
- implement archival,
- implement LLM-based consolidation,
- add supersession and contradiction handling.

Current implementation status:

- `MemoryConsolidationEngine` detects exact duplicate active memories.
- strongest memory is kept; redundant duplicate nodes are archived.
- consolidation writes `reinforces` and `supersedes` edges for auditability.
- `consolidation-demo` verifies the flow on an isolated demo vault.
- `MemoryConsolidationAgent` can consolidate related clusters with LLM support and rule fallback.
- `llm-consolidation-demo` verifies related-memory consolidation on an isolated demo vault.

## Phase 5: Autonomous Host

- add heartbeat scheduler,
- add drives,
- add self-model,
- add policy-gated action execution.

Current implementation status:

- `ActiveAgentHost` runs heartbeat cycles as internal perceptions.
- maintenance now includes scheduled consolidation and forgetting.
- consolidation runs immediately when the selected drive is `consolidate-memory`.
- heartbeat results include `drive` and `MaintenanceReport`.
- `maintenance-demo` verifies idle memory cleanup on an isolated demo vault.

## Phase 6: Actor Execution Layer

- execute only policy-approved actions,
- skip medium/high-risk actions until confirmed,
- return execution results to the runtime,
- store successful low-risk execution as memory evidence.

Current implementation status:

- `ActorAgent` advertises execution readiness.
- `ActionExecutor` executes `say`, `remember`, `wait`, and `ask-user`.
- runtime emits `executionResults`.
- successful low-risk executions are stored as action episodes.
- `actor-demo` verifies allowed versus gated execution behavior.

## Phase 7: Tool Registry

- register local tools by name,
- classify each tool by risk,
- allow only safe tools to execute automatically,
- keep unknown or side-effectful tools behind confirmation.

Current implementation status:

- `ToolRegistry` manages tool definitions.
- `memory.stats` and `project.status` are safe read-only tools.
- `PolicyAgent` allows safe registered tools.
- `ActionExecutor` executes safe tools with read-only runtime context.
- `tool-demo` verifies safe and unregistered tool behavior.

Codex integration status:

- `codex.run` is registered as a high-risk tool.
- policy requires explicit confirmation before it can run.
- the executor calls `codex exec` with a bounded prompt and sandbox mode.
- `codex-tool-demo` shows blocked unconfirmed use and confirmed read-only use.

## Phase 8: Entity Graph

- extract stable entities from memory formation plans,
- store entities separately from memory nodes,
- link memories to entities,
- later use entities for recall, consolidation, and context organization.

Current implementation status:

- `EntityExtractionAgent` extracts rule-based entities.
- `MemoryStore` persists `entities` and `memory_entities` in Markdown graph state.
- memory formation automatically includes entity extraction.
- `entity-demo` verifies entity persistence and memory-entity links.

## Phase 9: Entity-Aware Recall and Context

- match current input against known entity names and aliases,
- retrieve active memories linked to matched entities,
- use those linked memories as recall seeds beside text search and pinned self-model memories,
- expose activated entities in compiled context.

Current implementation status:

- `MemoryStore.findEntitiesMentionedInText` matches current input against stored entities.
- `MemoryStore.listActiveMemoriesForEntityIds` retrieves active memories through `memory_entities`.
- `MemoryActivationEngine` now adds entity-linked memories as activation seeds.
- `ActivatedMemoryGraph` includes `entityNodes`.
- `ContextCompiler` renders a `[Relevant Entities]` section.
- `entity-recall-demo` verifies that a query mentioning `Codex` activates the `Codex` entity and linked memories.

## Phase 10: Context-Grounded Response Composition

- keep planning separate from user-facing speech,
- let the companion layer read `compiledContext`,
- use an LLM when available to turn recalled memory into a natural answer,
- provide a deterministic fallback when the provider is unavailable.

Current implementation status:

- `PlannerAgent` no longer emits the default `say` action.
- `CompanionAgent` emits the user-facing `say` action.
- `CompanionAgent` can call the configured LLM with the compiled context.
- fallback response composition summarizes relevant entities, focus memories, active goals, and uncertainty.
- `entity-recall-demo` prints the generated response before the raw recall trace.

## Phase 11: Action-Oriented Tool Loop

- let the actor propose safe read-only tools from current context,
- route those tool actions through the policy gate,
- execute allowed tools,
- write tool results back into long-term memory,
- allow later recall to use tool result memories.

Current implementation status:

- `ActorAgent` proposes `memory.stats` and `project.status` for status/stat requests.
- `PolicyAgent` automatically allows registered safe tools.
- `ActionExecutor` runs safe tools through `ToolRegistry`.
- runtime stores tool results as `Action executed: tool(tool.name)` episode memories.
- `tool-loop-demo` verifies one cycle of tool execution and a second cycle of recalling tool results.

## Phase 12: Tool Result Reflection

- turn raw tool execution logs into stable semantic facts,
- preserve provenance by linking semantic facts to the execution episode,
- use tool metadata when available instead of reparsing text,
- attach entities to reflected facts.

Current implementation status:

- `ActionExecutionResult` preserves optional execution metadata.
- `ActionExecutor` attaches tool name and tool metadata to tool results.
- `ToolResultReflectionAgent` extracts durable facts from `memory.stats` and `project.status`.
- runtime applies reflected memory formations after action execution.
- reflected semantic memories are linked to source tool episodes with `derived_from`.
- `tool-loop-demo` verifies that the second cycle recalls semantic facts such as latest memory stats and current cwd.

## Phase 13: Memory Correction and User Feedback

- allow the user to correct, archive, pin, unpin, reinforce, or downgrade recalled memories,
- select correction targets from currently activated memories,
- keep correction provenance as a note,
- prevent unrelated tool execution during explicit correction requests.

Current implementation status:

- `MemoryCorrectionAgent` detects explicit correction feedback.
- `AgentProposal` can carry a `memoryCorrection` plan.
- `MemoryStore.applyCorrection` supports `archive`, `pin`, `unpin`, `reinforce`, and `downgrade`.
- runtime applies correction plans and writes correction reports.
- `ActorAgent` skips tool execution during correction requests.
- `memory-correction-demo` verifies that an incorrect `Latest memory stats` semantic memory is archived and no longer appears in active recall.

## Phase 14: Memory Inspector and Explainability

- explain why specific memories were activated,
- show whether a memory came from text retrieval, entity-linked retrieval, pinned continuity, or graph propagation,
- expose graph edges and entity links for inspected memories,
- show which context sections used each memory,
- render an inspection report that can later power a desktop memory inspector UI.

Current implementation status:

- `MemoryInspector` inspects an `ActivatedMemoryGraph` plus optional `CompiledContext`.
- `MemoryStore` can fetch memory-entity links by memory ID and entities by ID.
- inspection nodes include activation reasons, trace reasons, context sections, edges, and entities.
- `memory-inspector-demo` verifies explainability for `memory.stats` and `project.status` recall.
- `EntityExtractionAgent` now matches known entity terms case-insensitively, so reflected facts such as `Latest memory stats` can link to tool entities.

## Phase 15: Inspector Tool and Self-Debugging

- expose memory inspection as a safe tool,
- let the actor propose inspection when the user asks why something was recalled,
- pass the current cycle's inspection report through tool context,
- return a Markdown explanation through normal action execution.

Current implementation status:

- `ToolContext` includes optional `memoryInspection`.
- `ToolRegistry` registers `memory.inspect` as a safe read-only tool.
- `ActorAgent` proposes `memory.inspect` for memory explanation requests.
- `AutonomousRuntime` precomputes a `MemoryInspector` report before tool execution.
- `memory-inspector-tool-demo` verifies policy allow, execution, and report output for "Why did you remember memory.stats and project.status?"

## Phase 16: Intent Router and Task Mode Selection

- classify each perception into a task mode before agent execution,
- select only the agents needed for that mode,
- reduce accidental tool execution and reflection noise,
- expose route metadata in runtime results and events.

Current implementation status:

- `IntentRouter` classifies conversation, memory correction, memory inspection, tool status, tool-result recall, development, and autonomous maintenance.
- `AgentContext` includes the current `route`.
- `RuntimeCycleResult` includes the current `route`.
- `AutonomousRuntime` stores agents in an ID map and runs only `route.selectedAgentIds`.
- route selection is emitted as a `director:route-intent` proposal for traceability.
- `intent-router-demo` verifies mode selection across representative inputs.

## Phase 17: Persistent Runtime Session

- provide a continuous local CLI session,
- reuse one runtime and memory store across many user turns,
- expose lightweight slash commands for memory inspection,
- support one-shot scripted mode for smoke tests.

Current implementation status:

- `session-cli` supports interactive mode, stdin mode, and `--once`.
- default memory path is `data/memory-vault`.
- `--memory :memory:` creates a temporary session for testing.
- `/stats` shows memory counts.
- `/memories [limit]` shows recent memories.
- normal input runs `AutonomousRuntime.step`.
- `npm run session` and `npm run session:once -- "..."` are available.

## Phase 18: Desktop Shell and Local UI Panel

- provide a minimal Electron shell around the runtime,
- keep the runtime in the main process,
- expose only safe IPC calls to the renderer,
- show conversation, route, selected agents, tool outputs, memory stats, and recent memories.

Current implementation status:

- `desktop/main.ts` creates the Electron window and owns `MemoryStore` plus `AutonomousRuntime`.
- `desktop/preload.ts` exposes `step`, `stats`, and `memories` through `contextBridge`.
- `npm run desktop` builds and starts Electron.
- the renderer is an inline local panel with no external network assets.
- the desktop shell is a control panel, not the final animated pet body.

## Phase 6: Desktop Body

- connect runtime to Electron pet UI,
- visualize active drives and memory activation,
- allow user to inspect, pin, correct, or delete memories.

## 9. Design Principle

The central principle:

```text
The LLM should not be the memory.
The LLM should be one cognitive worker inside a larger memory system.
```

Memory is formed by agents, stored as a network, recalled through activation, shaped by context compilation, and revised through reflection and forgetting.

That is what lets a finite context-window model behave like a continuous, self-updating agent.
