import { ActorAgent } from "../agents/actor-agent.js";
import { AutonomousAssociationAgent } from "../agents/autonomous-association-agent.js";
import { CompanionAgent } from "../agents/companion-agent.js";
import { DesireHabitAgent } from "../agents/desire-habit-agent.js";
import { DirectorAgent } from "../agents/director-agent.js";
import { EpisodeArchiveAgent } from "../agents/episode-archive-agent.js";
import { InnerLifeAgent } from "../agents/inner-life-agent.js";
import { LearningEvaluatorAgent } from "../agents/learning-evaluator-agent.js";
import { MemoryCorrectionAgent } from "../agents/memory-correction-agent.js";
import { MemoryFormationAgent } from "../agents/memory-formation-agent.js";
import { MemoryReviewAgent } from "../agents/memory-review-agent.js";
import { PlannerAgent } from "../agents/planner-agent.js";
import { PolicyAgent } from "../agents/policy-agent.js";
import { ProactiveIntentAgent } from "../agents/proactive-intent-agent.js";
import { ProactiveSchedulerAgent } from "../agents/proactive-scheduler-agent.js";
import { ReflectorAgent } from "../agents/reflector-agent.js";
import { SelfModelAgent } from "../agents/self-model-agent.js";
import { ToolResultReflectionAgent } from "../agents/tool-result-reflection-agent.js";
import { ToolPlanningAgent } from "../agents/tool-planning-agent.js";
import { ActionExecutor } from "../actor/action-executor.js";
import { ContextCompiler } from "../context/context-compiler.js";
import { EventBus } from "../events/event-bus.js";
import { createDefaultDeepSeekClient } from "../llm/deepseek-client.js";
import type { LlmProvider } from "../llm/types.js";
import { MemoryActivationEngine } from "../memory/memory-activation-engine.js";
import { MemoryInspector } from "../memory/memory-inspector.js";
import { RecallQueryAgent } from "../memory/recall-query-agent.js";
import { MemoryStore } from "../memory/memory-store.js";
import { WorkingMemoryGate } from "../memory/working-memory-gate.js";
import { ActionGate } from "../policy/action-gate.js";
import {
  annotateFormationWithVaultSources,
  MarkdownMemoryVault,
  writeFormationVaultDocuments,
  syncVaultMemoryFrontmatter,
} from "../vault/index.js";
import { InnerStateEngine } from "./inner-state-engine.js";
import { IntentRouter } from "./intent-router.js";
import { nowIso } from "../utils/id.js";
import type {
  ActivatedMemoryGraph,
  ActionExecutionResult,
  Agent,
  AgentId,
  AgentAction,
  AgentContext,
  AgentProposal,
  CompiledContext,
  IntentRoute,
  MemoryRecord,
  Perception,
  PolicyDecision,
  WorkingMemoryFrame,
} from "../types.js";

export interface RuntimeCycleResult {
  cycle: number;
  perception: Perception;
  route: IntentRoute;
  activatedMemory: ActivatedMemoryGraph;
  workingMemory: WorkingMemoryFrame;
  compiledContext: CompiledContext;
  proposals: AgentProposal[];
  policyDecisions: PolicyDecision[];
  executionResults: ActionExecutionResult[];
  actions: AgentAction[];
  backgroundJobs: RuntimeBackgroundJob[];
}

export interface RuntimeBackgroundJob {
  id: string;
  cycle: number;
  agentId: AgentId;
  intent: string;
  status: "queued" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface AutonomousRuntimeOptions {
  llm?: LlmProvider;
  useConfiguredLlm?: boolean;
  useLlmForMemoryFormation?: boolean;
  useLlmForCompanion?: boolean;
  asyncMemoryFormation?: boolean;
  trustAutonomousActions?: boolean;
  memoryVaultPath?: string;
  useMarkdownVault?: boolean;
}

export class AutonomousRuntime {
  private cycle = 0;
  private readonly director = new DirectorAgent();
  private readonly agents: Map<AgentId, Agent>;
  private readonly router = new IntentRouter();
  private readonly innerStateEngine = new InnerStateEngine();
  private readonly recallQueryAgent = new RecallQueryAgent();
  private readonly activationEngine: MemoryActivationEngine;
  private readonly workingMemoryGate = new WorkingMemoryGate();
  private readonly contextCompiler = new ContextCompiler();
  private readonly memoryInspector: MemoryInspector;
  private readonly actionGate: ActionGate;
  private readonly actionExecutor = new ActionExecutor();
  private readonly toolResultReflection = new ToolResultReflectionAgent();
  private readonly learningEvaluator = new LearningEvaluatorAgent();
  private readonly scratchpad: Record<string, unknown> = {};
  private readonly asyncMemoryFormation: boolean;
  private readonly vault?: MarkdownMemoryVault;
  private readonly backgroundJobs: RuntimeBackgroundJob[] = [];
  private stepQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly memory: MemoryStore,
    private readonly events = new EventBus(),
    options: AutonomousRuntimeOptions = {},
  ) {
    const defaultLlm = createDefaultDeepSeekClient();
    const llm =
      options.llm ??
      (options.useConfiguredLlm === false
        ? undefined
        : defaultLlm.isConfigured()
          ? defaultLlm
          : undefined);
    const memoryFormationLlm = options.useLlmForMemoryFormation === false ? undefined : llm;
    const companionLlm = options.useLlmForCompanion === false ? undefined : llm;
    this.asyncMemoryFormation = options.asyncMemoryFormation ?? false;
    this.vault =
      options.useMarkdownVault === false
        ? undefined
        : new MarkdownMemoryVault(options.memoryVaultPath ?? process.env.PIANPIAN_MEMORY_VAULT_PATH ?? "data/memory-vault");
    this.actionGate = new ActionGate(undefined, {
      trustAutonomousActions: options.trustAutonomousActions ?? false,
    });
    this.activationEngine = new MemoryActivationEngine(memory);
    this.memoryInspector = new MemoryInspector(memory);

    this.agents = new Map(
      [
        new MemoryFormationAgent(memoryFormationLlm),
        new MemoryReviewAgent(),
        new EpisodeArchiveAgent(memoryFormationLlm),
        new MemoryCorrectionAgent(),
        new SelfModelAgent(),
        new PolicyAgent(),
        new ActorAgent(),
        new ToolPlanningAgent(),
        new PlannerAgent(),
        new ReflectorAgent(),
        new AutonomousAssociationAgent(),
        new InnerLifeAgent(),
        new DesireHabitAgent(),
        new ProactiveIntentAgent(),
        new ProactiveSchedulerAgent(),
        new CompanionAgent(companionLlm),
      ].map((agent) => [agent.id, agent]),
    );
  }

  onEvent(listener: Parameters<EventBus["on"]>[1]): void {
    this.events.on("*", listener);
  }

  async step(input: string, source: Perception["source"] = "user"): Promise<RuntimeCycleResult> {
    const run = this.stepQueue.then(() => this.runStep(input, source));
    this.stepQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async runStep(input: string, source: Perception["source"]): Promise<RuntimeCycleResult> {
    this.cycle += 1;
    const perception: Perception = {
      source,
      text: input,
      createdAt: nowIso(),
    };

    this.events.publish("cycle.started", {
      cycle: this.cycle,
      perception,
    });

    const route = this.router.route(perception);
    const innerState = this.innerStateEngine.update(perception, route);
    const recallQuery = this.recallQueryAgent.plan(perception, route, innerState);
    let activatedMemory = this.activationEngine.recall(input, recallQuery);
    let workingMemory = this.workingMemoryGate.select(activatedMemory, innerState);
    let memories = [
      ...workingMemory.slots.map((slot) => slot.node.memory),
    ];
    let compiledContext = this.contextCompiler.compile(activatedMemory, innerState, workingMemory);
    let context: AgentContext = {
      cycle: this.cycle,
      perception,
      route,
      innerState,
      memories,
      activatedMemory,
      workingMemory,
      compiledContext,
      scratchpad: this.scratchpad,
    };

    const selectedAgents = this.selectAgents(route);
    const backgroundAgents = this.selectBackgroundAgents(selectedAgents, context);
    let foregroundAgents = selectedAgents.filter((agent) => !backgroundAgents.includes(agent));
    const syncMemoryAgents = this.selectSynchronousMemoryAgents(foregroundAgents, context);
    const routeProposal: AgentProposal = {
      agentId: "director",
      intent: "route-intent",
      confidence: route.confidence,
      content: `Intent route: ${route.mode}. ${route.reason}`,
    };
    const syncMemoryProposals = await Promise.all(syncMemoryAgents.map((agent) => agent.run(context)));
    for (const proposal of syncMemoryProposals) {
      await this.applyProposalMemoryEffects(proposal);
    }

    if (syncMemoryProposals.length > 0) {
      activatedMemory = this.activationEngine.recall(input, recallQuery);
      workingMemory = this.workingMemoryGate.select(activatedMemory, innerState);
      memories = [
        ...workingMemory.slots.map((slot) => slot.node.memory),
      ];
      compiledContext = this.contextCompiler.compile(activatedMemory, innerState, workingMemory);
      context = {
        ...context,
        memories,
        activatedMemory,
        workingMemory,
        compiledContext,
      };
      foregroundAgents = foregroundAgents.filter((agent) => !syncMemoryAgents.includes(agent));
    }

    const proposals = [
      routeProposal,
      ...syncMemoryProposals,
      ...(await Promise.all(foregroundAgents.map((agent) => agent.run(context)))),
    ];
    for (const proposal of proposals) {
      await this.applyProposalMemoryEffects(proposal);
    }
    const queuedBackgroundJobs = backgroundAgents.map((agent) => this.queueBackgroundAgent(agent, context));

    const proposedActions = this.director.decide(proposals);
    const policyDecisions = this.actionGate.review(proposedActions);
    const actions = this.actionGate.toUserVisibleActions(policyDecisions);
    const inspectionReport = this.memoryInspector.inspectActivatedGraph(activatedMemory, compiledContext, 8);
    const executionResults = await this.actionExecutor.executeAllowed(policyDecisions, {
      memory: this.memory.stats(),
      memoryInspection: {
        query: inspectionReport.query,
        summary: inspectionReport.summary,
        markdown: this.memoryInspector.renderMarkdown(inspectionReport),
      },
      project: {
        cwd: process.cwd(),
      },
    });
    const executionMemories: MemoryRecord[] = [];
    for (const result of executionResults) {
      if (result.status !== "executed") {
        continue;
      }
      if (result.action.type === "say") {
        continue;
      }

      const executionMemory = this.memory.add({
        kind: "episode",
        text: `Action executed: ${formatActionLabel(result.action)}. Output: ${result.output}`,
        importance: 2,
        confidence: 1,
        tags: ["action", "execution", result.action.type, ...actionTags(result.action)],
      });
      executionMemories.push(executionMemory);
    }
    const toolReflection = this.toolResultReflection.reflect(executionResults, executionMemories);
    await this.applyProposalMemoryEffects(toolReflection);
    const learningEvaluation = this.learningEvaluator.evaluate({
      cycle: this.cycle,
      perception,
      proposals: [...proposals, toolReflection],
      actions,
      executionResults,
    });
    await this.applyProposalMemoryEffects(learningEvaluation);
    const allProposals = [...proposals, toolReflection, learningEvaluation];

    this.events.publish("cycle.completed", {
      cycle: this.cycle,
      actions,
      executionResults: executionResults.map((result) => ({
        actionType: result.action.type,
        status: result.status,
        output: result.output,
        error: result.error,
      })),
      policyDecisions: policyDecisions.map((decision) => ({
        actionType: decision.action.type,
        risk: decision.risk,
        status: decision.status,
        reason: decision.reason,
      })),
      activatedMemory: {
        focusNodes: activatedMemory.focusNodes.map((node) => ({
          id: node.memory.id,
          kind: node.memory.kind,
          activation: node.activation,
          text: node.memory.text,
        })),
        traceCount: activatedMemory.activationTrace.length,
      },
      compiledContext: {
        currentTask: compiledContext.currentTask,
        workingMemory: workingMemory.summary,
        traceCount: compiledContext.trace.length,
      },
      route,
      proposals: allProposals.map((proposal) => ({
        agentId: proposal.agentId,
        intent: proposal.intent,
        confidence: proposal.confidence,
      })),
    });

    return {
      cycle: this.cycle,
      perception,
      route,
      activatedMemory,
      workingMemory,
      compiledContext,
      proposals: allProposals,
      policyDecisions,
      executionResults,
      actions,
      backgroundJobs: queuedBackgroundJobs,
    };
  }

  private selectAgents(route: IntentRoute): Agent[] {
    return route.selectedAgentIds.flatMap((id) => {
      const agent = this.agents.get(id);
      return agent ? [agent] : [];
    });
  }

  private selectBackgroundAgents(agents: Agent[], context: AgentContext): Agent[] {
    if (!this.asyncMemoryFormation) {
      return [];
    }

    if (shouldSynchronizeMemoryFormation(context.perception.text)) {
      return [];
    }

    return agents.filter((agent) => agent.id === "memory-curator");
  }

  private selectSynchronousMemoryAgents(agents: Agent[], context: AgentContext): Agent[] {
    if (!shouldSynchronizeMemoryFormation(context.perception.text)) {
      return [];
    }

    return agents.filter((agent) => agent.id === "memory-curator");
  }

  private queueBackgroundAgent(agent: Agent, context: AgentContext): RuntimeBackgroundJob {
    const job: RuntimeBackgroundJob = {
      id: `${context.cycle}:${agent.id}:${this.backgroundJobs.length + 1}`,
      cycle: context.cycle,
      agentId: agent.id,
      intent: "background-memory-formation",
      status: "queued",
      startedAt: nowIso(),
    };
    this.backgroundJobs.push(job);

    this.events.publish("background-job.started", {
      ...job,
      perception: context.perception,
    });

    void agent
      .run(context)
      .then(async (proposal) => {
        await this.applyProposalMemoryEffects(proposal);
        job.status = "completed";
        job.intent = proposal.intent;
        job.completedAt = nowIso();
        this.events.publish("background-job.completed", {
          ...job,
          proposal: {
            agentId: proposal.agentId,
            intent: proposal.intent,
            confidence: proposal.confidence,
          },
        });
      })
      .catch((error: unknown) => {
        job.status = "failed";
        job.completedAt = nowIso();
        job.error = error instanceof Error ? error.message : String(error);
        this.events.publish("background-job.failed", job);
      });

    return { ...job };
  }

  private async applyProposalMemoryEffects(proposal: AgentProposal): Promise<void> {
    if (proposal.memoryFormation) {
      const formation = annotateFormationWithVaultSources(proposal.memoryFormation);
      const applied = this.memory.applyFormation(formation);
      const localToMemory = new Map(formation.nodes.map((node, index) => [node.localId, applied.nodes[index]] as const));
      await writeFormationVaultDocuments(this.vault, formation, localToMemory);
      const archiveIds = (formation.archiveLocalIds ?? []).flatMap((localId) => {
        const memory = localToMemory.get(localId);
        return memory ? [memory.id] : [];
      });
      if (archiveIds.length > 0) {
        const archived = this.memory.archiveByIdsDetailed(archiveIds);
        await syncVaultMemoryFrontmatter(this.vault, archived.memories);
      }
    }

    for (const memory of proposal.memoryWrites ?? []) {
      this.memory.add(memory);
    }

    if (proposal.memoryCorrection) {
      const correction = this.memory.applyCorrectionDetailed(proposal.memoryCorrection);
      const report = correction.report;
      await syncVaultMemoryFrontmatter(this.vault, correction.memories);
      if (proposal.memoryCorrection.note) {
        this.memory.add({
          ...proposal.memoryCorrection.note,
          text: `${proposal.memoryCorrection.note.text} Correction report: ${report.operation} changed=${report.changed}/${report.requested}.`,
        });
      }
    }
  }

}

function formatActionLabel(action: AgentAction): string {
  if (action.type === "tool") {
    const toolName = typeof action.metadata?.toolName === "string" ? action.metadata.toolName : "unknown";
    return `tool(${toolName})`;
  }

  return action.type;
}

function actionTags(action: AgentAction): string[] {
  if (action.type === "tool" && typeof action.metadata?.toolName === "string") {
    return [action.metadata.toolName];
  }

  return [];
}

function shouldSynchronizeMemoryFormation(input: string): boolean {
  const normalized = input.toLowerCase();
  return [
    "\u8bb0\u4f4f",
    "\u8a18\u4f4f",
    "\u8bb0\u4e00\u4e0b",
    "\u5e2e\u6211\u8bb0",
    "\u5e2e\u6211\u8bb0\u4f4f",
    "\u5e6b\u6211\u8a18",
    "\u8bb0\u5230\u957f\u671f\u8bb0\u5fc6",
    "\u5b58\u5230\u957f\u671f\u8bb0\u5fc6",
    "remember",
    "remember this",
    "save this",
    "commit this to memory",
  ].some((term) => normalized.includes(term));
}

