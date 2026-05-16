import { ActorAgent } from "../agents/actor-agent.js";
import { CompanionAgent } from "../agents/companion-agent.js";
import { DirectorAgent } from "../agents/director-agent.js";
import { MemoryCorrectionAgent } from "../agents/memory-correction-agent.js";
import { MemoryFormationAgent } from "../agents/memory-formation-agent.js";
import { PlannerAgent } from "../agents/planner-agent.js";
import { PolicyAgent } from "../agents/policy-agent.js";
import { ReflectorAgent } from "../agents/reflector-agent.js";
import { SelfModelAgent } from "../agents/self-model-agent.js";
import { ToolResultReflectionAgent } from "../agents/tool-result-reflection-agent.js";
import { ActionExecutor } from "../actor/action-executor.js";
import { ContextCompiler } from "../context/context-compiler.js";
import { EventBus } from "../events/event-bus.js";
import { createDefaultDeepSeekClient } from "../llm/deepseek-client.js";
import type { LlmProvider } from "../llm/types.js";
import { MemoryActivationEngine } from "../memory/memory-activation-engine.js";
import { MemoryInspector } from "../memory/memory-inspector.js";
import { MemoryStore } from "../memory/memory-store.js";
import { ActionGate } from "../policy/action-gate.js";
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
} from "../types.js";

export interface RuntimeCycleResult {
  cycle: number;
  perception: Perception;
  route: IntentRoute;
  activatedMemory: ActivatedMemoryGraph;
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
}

export class AutonomousRuntime {
  private cycle = 0;
  private readonly director = new DirectorAgent();
  private readonly agents: Map<AgentId, Agent>;
  private readonly router = new IntentRouter();
  private readonly activationEngine: MemoryActivationEngine;
  private readonly contextCompiler = new ContextCompiler();
  private readonly memoryInspector: MemoryInspector;
  private readonly actionGate = new ActionGate();
  private readonly actionExecutor = new ActionExecutor();
  private readonly toolResultReflection = new ToolResultReflectionAgent();
  private readonly scratchpad: Record<string, unknown> = {};
  private readonly asyncMemoryFormation: boolean;
  private readonly backgroundJobs: RuntimeBackgroundJob[] = [];

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
    this.activationEngine = new MemoryActivationEngine(memory);
    this.memoryInspector = new MemoryInspector(memory);

    this.agents = new Map(
      [
        new MemoryFormationAgent(memoryFormationLlm),
        new MemoryCorrectionAgent(),
        new SelfModelAgent(),
        new PolicyAgent(),
        new ActorAgent(),
        new PlannerAgent(),
        new ReflectorAgent(),
        new CompanionAgent(companionLlm),
      ].map((agent) => [agent.id, agent]),
    );
  }

  onEvent(listener: Parameters<EventBus["on"]>[1]): void {
    this.events.on("*", listener);
  }

  async step(input: string, source: Perception["source"] = "user"): Promise<RuntimeCycleResult> {
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
    let activatedMemory = this.activationEngine.recall(input);
    let memories = [
      ...activatedMemory.focusNodes.map((node) => node.memory),
      ...activatedMemory.supportNodes.map((node) => node.memory),
    ];
    let compiledContext = this.contextCompiler.compile(activatedMemory);
    let context: AgentContext = {
      cycle: this.cycle,
      perception,
      route,
      memories,
      activatedMemory,
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
      this.applyProposalMemoryEffects(proposal);
    }

    if (syncMemoryProposals.length > 0) {
      activatedMemory = this.activationEngine.recall(input);
      memories = [
        ...activatedMemory.focusNodes.map((node) => node.memory),
        ...activatedMemory.supportNodes.map((node) => node.memory),
      ];
      compiledContext = this.contextCompiler.compile(activatedMemory);
      context = {
        ...context,
        memories,
        activatedMemory,
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
      this.applyProposalMemoryEffects(proposal);
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

      const executionMemory = this.memory.add({
        kind: "episode",
        text: `Action executed: ${formatActionLabel(result.action)}. Output: ${result.output}`,
        importance: result.action.type === "say" ? 1 : 2,
        confidence: 1,
        tags: ["action", "execution", result.action.type, ...actionTags(result.action)],
      });
      executionMemories.push(executionMemory);
    }
    const toolReflection = this.toolResultReflection.reflect(executionResults, executionMemories);
    if (toolReflection.memoryFormation) {
      this.memory.applyFormation(toolReflection.memoryFormation);
    }
    const allProposals = [...proposals, toolReflection];

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
      .then((proposal) => {
        this.applyProposalMemoryEffects(proposal);
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

  private applyProposalMemoryEffects(proposal: AgentProposal): void {
    if (proposal.memoryFormation) {
      this.memory.applyFormation(proposal.memoryFormation);
    }

    for (const memory of proposal.memoryWrites ?? []) {
      this.memory.add(memory);
    }

    if (proposal.memoryCorrection) {
      const report = this.memory.applyCorrection(proposal.memoryCorrection);
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
    "记住",
    "記住",
    "记一下",
    "帮我记",
    "幫我記",
    "记到长期记忆",
    "存到长期记忆",
    "remember",
    "remember this",
    "save this",
    "commit this to memory",
  ].some((term) => normalized.includes(term));
}
