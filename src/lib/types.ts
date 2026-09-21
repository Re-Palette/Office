/**
 * Core domain model for the AI Company OS.
 *
 * Everything the UI renders is derived from these structures, so adding a new
 * AI employee to the registry surfaces it across the whole product without
 * touching a single screen.
 */

export type AgentStatus =
  | "working"
  | "thinking"
  | "researching"
  | "coding"
  | "writing"
  | "designing"
  | "waiting"
  | "completed"
  | "needs_approval"
  | "error"
  | "idle";

export type DepartmentId =
  | "strategy"
  | "engineering"
  | "marketing"
  | "sales"
  | "finance"
  | "research"
  | "creative"
  | "operations";

export type AgentSeniority = "executive" | "director" | "manager" | "specialist";

export type ToolId =
  | "web_research"
  | "browser"
  | "code_execution"
  | "file_search"
  | "database"
  | "email"
  | "calendar"
  | "analytics"
  | "social_media"
  | "github"
  | "design"
  | "deploy";

/** Capabilities that must pass through the Human Approval Gate. */
export type PermissionId =
  | "read_company_data"
  | "write_company_data"
  | "assign_tasks"
  | "spend_budget"
  | "send_external_email"
  | "publish_social"
  | "deploy_production"
  | "connect_external_service";

export interface Agent {
  id: string;
  name: string;
  /** Short Japanese/English role title, e.g. "COO" or "Research AI". */
  role: string;
  title: string;
  department: DepartmentId;
  seniority: AgentSeniority;
  /** One-line mandate used as the head of the agent's system prompt. */
  mission: string;
  /** The full role prompt handed to the model when this agent runs. */
  systemPrompt: string;
  skills: string[];
  tools: ToolId[];
  permissions: PermissionId[];
  /** Agents this one routes work to. Drives the collaboration graph. */
  reportsTo?: string;
  collaborators: string[];
  status: AgentStatus;
  currentTask?: string;
  tasksCompleted: number;
  performance: number;
  lastActiveMinutesAgo: number;
  accent: string;
  memory: string[];
}

export interface Department {
  id: DepartmentId;
  name: string;
  label: string;
  headAgentId: string;
  mandate: string;
  /** Departments this one habitually hands work to. */
  interfaces: DepartmentId[];
}

export type TaskStatus =
  | "QUEUED"
  | "PLANNING"
  | "RUNNING"
  | "WAITING"
  | "REVIEW"
  | "COMPLETED"
  | "FAILED";

export type TaskPriority = "critical" | "high" | "normal" | "low";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedAgent: string;
  department: DepartmentId;
  project?: string;
  createdAt: number;
  updatedAt: number;
  deadline?: number;
  parentTask?: string;
  subTasks: string[];
  progress: number;
  output?: string;
}

export interface Project {
  id: string;
  name: string;
  codename: string;
  summary: string;
  status: "active" | "planning" | "paused" | "shipped";
  progress: number;
  health: "on_track" | "at_risk" | "blocked";
  owner: string;
  agents: string[];
  departments: DepartmentId[];
  deadline: number;
  startedAt: number;
  milestones: { id: string; label: string; done: boolean; due: number }[];
}

export type ActivityKind =
  | "agent.started"
  | "agent.thinking"
  | "agent.tool_called"
  | "agent.completed"
  | "agent.handoff"
  | "task.created"
  | "task.assigned"
  | "task.completed"
  | "approval.requested"
  | "approval.approved"
  | "approval.rejected"
  | "report.generated"
  | "insight.found";

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  agentId: string;
  at: number;
  message: string;
  /** Secondary line — task title, source count, tool name. */
  detail?: string;
  targetAgentId?: string;
  taskId?: string;
  projectId?: string;
  severity?: "normal" | "important" | "critical";
}

export type ApprovalKind =
  | "project_start"
  | "budget"
  | "external_service"
  | "email"
  | "social_post"
  | "deploy";

export interface Approval {
  id: string;
  kind: ApprovalKind;
  title: string;
  requestedBy: string;
  requestedAt: number;
  summary: string;
  /** What actually happens the moment the CEO approves. */
  impact: string;
  risk: "low" | "medium" | "high";
  payload?: { label: string; value: string }[];
  status: "pending" | "approved" | "rejected" | "reviewing";
  deadline?: number;
}

export interface Recommendation {
  id: string;
  fromAgent: string;
  headline: string;
  rationale: string;
  evidence: { label: string; value: string }[];
  confidence: number;
  status: "open" | "approved" | "rejected";
}

/** One node in a visualised chain of work moving between AI employees. */
export interface FlowStep {
  id: string;
  agentId: string;
  action: string;
  state: "done" | "active" | "queued";
  at?: number;
}

export interface CollaborationFlow {
  id: string;
  title: string;
  origin: "CEO" | "COO" | "SCHEDULED";
  startedAt: number;
  steps: FlowStep[];
  projectId?: string;
}

export interface MeetingReport {
  agentId: string;
  area: string;
  headline: string;
  points: string[];
  metric?: { label: string; value: string; delta?: string };
}

export interface BoardMeeting {
  id: string;
  title: string;
  at: number;
  status: "scheduled" | "completed";
  reports: MeetingReport[];
  summary: string;
  decisions: string[];
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  category:
    | "documents"
    | "projects"
    | "research"
    | "reports"
    | "memory"
    | "ceo_instructions"
    | "brand"
    | "technical";
  owner: string;
  updatedAt: number;
  excerpt: string;
  tags: string[];
}

export interface ChatMessage {
  id: string;
  role: "ceo" | "agent" | "system";
  agentId?: string;
  text: string;
  at: number;
  /** Rendered as a routed delegation chain under the message. */
  routing?: { agentId: string; note: string }[];
}

export interface ScheduleConfig {
  morningBriefing: string;
  dailyReport: string;
  weeklyBoard: string;
  weeklyBoardDay: string;
}

export interface NotificationItem {
  id: string;
  kind:
    | "approval"
    | "error"
    | "task_completed"
    | "discovery"
    | "deadline"
    | "recommendation";
  title: string;
  body: string;
  at: number;
  read: boolean;
  agentId?: string;
}
