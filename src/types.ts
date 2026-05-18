export type AgentId =
  | "director"
  | "memory-curator"
  | "memory-reviewer"
  | "memory-corrector"
  | "self-model"
  | "policy"
  | "tool-planner"
  | "planner"
  | "reflector"
  | "learning-evaluator"
  | "associator"
  | "inner-life"
  | "desire-habit"
  | "proactive-intent"
  | "proactive-scheduler"
  | "tool-reflector"
  | "actor"
  | "companion";

export type MemoryKind =
  | "episode"
  | "semantic"
  | "goal"
  | "preference"
  | "reflection"
  | "self_model"
  | "procedure"
  | "relationship";
export type MemoryStatus = "active" | "archived";
export type MemoryRelation =
  | "supports"
  | "contradicts"
  | "elaborates"
  | "same_goal"
  | "same_entity"
  | "temporal_neighbor"
  | "derived_from"
  | "reinforces"
  | "supersedes";

export type EntityKind =
  | "user"
  | "project"
  | "tool"
  | "model"
  | "file"
  | "goal"
  | "concept"
  | "agent";

export type Importance = 1 | 2 | 3 | 4 | 5;

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  text: string;
  importance: Importance;
  confidence: number;
  tags: string[];
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;
  pinned: boolean;
  status: MemoryStatus;
  archivedAt?: string;
}

export interface MemoryEdgeRecord {
  id: string;
  fromMemoryId: string;
  toMemoryId: string;
  relation: MemoryRelation;
  strength: number;
  confidence: number;
  createdAt: string;
  lastReinforcedAt: string;
}

export interface EntityRecord {
  id: string;
  kind: EntityKind;
  name: string;
  aliases: string[];
  createdAt: string;
  lastSeenAt: string;
  confidence: number;
}

export interface MemoryEntityLink {
  memoryId: string;
  entityId: string;
  relation: "mentions" | "about" | "uses" | "owns" | "implements";
  confidence: number;
}

export interface Perception {
  source: "user" | "system" | "environment" | "internal";
  text: string;
  createdAt: string;
}

export interface AgentContext {
  cycle: number;
  perception: Perception;
  route?: IntentRoute;
  innerState?: InnerState;
  memories: MemoryRecord[];
  activatedMemory?: ActivatedMemoryGraph;
  workingMemory?: WorkingMemoryFrame;
  compiledContext?: CompiledContext;
  scratchpad: Record<string, unknown>;
}

export interface AgentProposal {
  agentId: AgentId;
  intent: string;
  content: string;
  confidence: number;
  memoryWrites?: NewMemory[];
  memoryFormation?: MemoryFormationPlan;
  memoryCorrection?: MemoryCorrectionPlan;
  actions?: AgentAction[];
}

export type TaskMode =
  | "conversation"
  | "memory-correction"
  | "memory-inspection"
  | "tool-status"
  | "tool-result-recall"
  | "development"
  | "autonomous-maintenance";

export interface IntentRoute {
  mode: TaskMode;
  confidence: number;
  reason: string;
  selectedAgentIds: AgentId[];
}

export interface AgentAction {
  type: "say" | "remember" | "wait" | "ask-user" | "tool" | "file-write" | "external-message" | "delete-data";
  content: string;
  metadata?: Record<string, unknown>;
}

export type ActionRisk = "safe" | "low" | "medium" | "high" | "blocked";
export type PolicyDecisionStatus = "allow" | "confirm" | "block";

export interface PolicyDecision {
  action: AgentAction;
  risk: ActionRisk;
  status: PolicyDecisionStatus;
  reason: string;
}

export type ActionExecutionStatus = "executed" | "skipped" | "failed";

export type ToolRisk = "safe" | "medium" | "high";

export interface ToolContext {
  memory?: {
    total: number;
    active: number;
    archived: number;
    pinned: number;
  };
  memoryInspection?: {
    query: string;
    summary: string;
    markdown: string;
  };
  project?: {
    cwd: string;
  };
}

export interface ToolResult {
  toolName: string;
  output: string;
  metadata?: Record<string, unknown>;
}

export interface ActionExecutionResult {
  action: AgentAction;
  status: ActionExecutionStatus;
  output: string;
  createdAt: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface NewMemory {
  kind: MemoryKind;
  text: string;
  importance: Importance;
  confidence?: number;
  pinned?: boolean;
  tags?: string[];
}

export type MemoryCorrectionOperation = "archive" | "pin" | "unpin" | "reinforce" | "downgrade";

export interface MemoryCorrectionPlan {
  operation: MemoryCorrectionOperation;
  targetMemoryIds: string[];
  reason: string;
  note?: NewMemory;
}

export interface MemoryCorrectionReport {
  operation: MemoryCorrectionOperation;
  requested: number;
  changed: number;
  reason: string;
}

export interface MemoryFormationPlan {
  nodes: NewMemoryNode[];
  edges: NewMemoryEdge[];
  entities?: NewEntity[];
  memoryEntityLinks?: NewMemoryEntityLink[];
  rationale: string;
}

export interface NewMemoryNode extends NewMemory {
  localId: string;
}

export interface NewMemoryEdge {
  fromLocalId?: string;
  toLocalId?: string;
  fromMemoryId?: string;
  toMemoryId?: string;
  relation: MemoryRelation;
  strength: number;
  confidence?: number;
}

export interface NewEntity {
  localId: string;
  kind: EntityKind;
  name: string;
  aliases?: string[];
  confidence?: number;
}

export interface NewMemoryEntityLink {
  memoryLocalId?: string;
  memoryId?: string;
  entityLocalId?: string;
  entityId?: string;
  relation: MemoryEntityLink["relation"];
  confidence?: number;
}

export interface ForgettingPolicy {
  archiveBelowScore: number;
  halfLifeDays: number;
  minAgeDays: number;
  preserveKinds: MemoryKind[];
}

export interface ForgettingReport {
  scanned: number;
  archived: number;
  preserved: number;
}

export interface ConsolidationClusterReport {
  key: string;
  keptMemoryId: string;
  archivedMemoryIds: string[];
  reason: string;
  consolidatedMemoryId?: string;
}

export interface ConsolidationReport {
  scanned: number;
  duplicateClusters: number;
  llmClusters?: number;
  archived: number;
  clusters: ConsolidationClusterReport[];
}

export interface AutonomyDrive {
  id: string;
  name: string;
  priority: number;
  prompt: string;
}

export interface MaintenanceReport {
  consolidation?: ConsolidationReport;
  forgetting?: ForgettingReport;
  experienceReplay?: ExperienceReplayReport;
  recallTest?: MemoryRecallHarnessReport;
}

export interface ExperienceReplayClusterReport {
  key: string;
  sourceMemoryIds: string[];
  createdMemoryIds: string[];
  skippedReason?: string;
}

export interface ExperienceReplayReport {
  scanned: number;
  candidateSources: number;
  clusters: ExperienceReplayClusterReport[];
  createdMemoryIds: string[];
  reinforcedEdges: number;
  downgradedEpisodeIds: string[];
  archivedEpisodeIds: string[];
  skippedReasons: string[];
  ranAt: string;
}

export interface MemoryRecallHarnessResult {
  target: {
    id: string;
    kind: MemoryKind;
    importance: number;
    confidence: number;
    createdAt: string;
    tags: string[];
    reason: "high-value" | "recent";
    textPreview: string;
  };
  query: string;
  success: boolean;
  score: number;
  activated: boolean;
  selectedByWorkingMemory: boolean;
  compiledIntoContext: boolean;
  directRetrievalHit: boolean;
  bestActivation: number;
  workingMemorySections: string[];
  notes: string[];
}

export interface MemoryRecallHarnessReport {
  ranAt: string;
  scanned: number;
  selected: number;
  successes: number;
  failures: number;
  writes: number;
  summary: string;
  results: MemoryRecallHarnessResult[];
}

export type InnerMood = "quiet" | "curious" | "tender" | "focused" | "restless" | "protective";

export interface InnerState {
  mood: InnerMood;
  arousal: number;
  socialNeed: number;
  curiosity: number;
  continuityNeed: number;
  dominantDrives: string[];
  recallBiasTags: string[];
  note: string;
  updatedAt: string;
}

export interface RecallQuery {
  rawInput: string;
  taskIntent: string;
  expandedQueries: string[];
  explicitTopicTerms: string[];
  priorityTags: string[];
  priorityKinds: MemoryKind[];
  queryPlanReason: string;
  seedLimit: number;
  entityLimit: number;
  entitySeedLimit: number;
  maxDepth: number;
  maxNodes: number;
}

export interface ActivatedMemoryNode {
  memory: MemoryRecord;
  activation: number;
  depth: number;
  reasons: string[];
}

export interface ActivationTrace {
  fromMemoryId?: string;
  toMemoryId: string;
  entityId?: string;
  relation?: MemoryRelation;
  amount: number;
  reason: string;
}

export interface ActivatedEntityNode {
  entity: EntityRecord;
  activation: number;
  linkedMemoryIds: string[];
  reasons: string[];
}

export interface ActivatedMemoryGraph {
  query: RecallQuery;
  entityNodes: ActivatedEntityNode[];
  focusNodes: ActivatedMemoryNode[];
  supportNodes: ActivatedMemoryNode[];
  contradictionNodes: ActivatedMemoryNode[];
  activationTrace: ActivationTrace[];
}

export type WorkingMemorySection =
  | "topic"
  | "identity"
  | "relationship"
  | "goals"
  | "preferences"
  | "procedures"
  | "evidence"
  | "background";

export type TopicSubchannel = "history" | "food" | "route" | "promise" | "general";

export interface WorkingMemorySlot {
  section: WorkingMemorySection;
  topicSubchannel?: TopicSubchannel;
  node: ActivatedMemoryNode;
  score: number;
  reasons: string[];
}

export interface WorkingMemoryFrame {
  topicTerms: string[];
  slots: WorkingMemorySlot[];
  excluded: Array<{
    memoryId: string;
    reason: string;
  }>;
  summary: string;
}

export interface ContextTrace {
  memoryId?: string;
  section: string;
  reason: string;
  activation?: number;
}

export interface CompiledContext {
  currentTask: string;
  innerState: string;
  workingMemory: string;
  relevantEntities: string;
  selfModel: string;
  focus: string;
  goals: string;
  preferences: string;
  longTermMemory: string;
  uncertainty: string;
  recentEvidence: string;
  prompt: string;
  trace: ContextTrace[];
}

export interface MemoryInspectionNode {
  memory: MemoryRecord;
  activation?: number;
  depth?: number;
  activationReasons: string[];
  contextSections: string[];
  traceReasons: string[];
  edges: MemoryEdgeRecord[];
  entities: Array<{
    entity: EntityRecord;
    relation: MemoryEntityLink["relation"];
    confidence: number;
  }>;
}

export interface MemoryInspectionReport {
  query: string;
  inspectedAt: string;
  nodes: MemoryInspectionNode[];
  summary: string;
}

export interface Agent {
  id: AgentId;
  role: string;
  run(context: AgentContext): Promise<AgentProposal>;
}

export interface RuntimeEvent {
  type: string;
  payload: unknown;
  createdAt: string;
}
