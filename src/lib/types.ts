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
  | "note"
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
  /** Blocked until the CEO decides. Always paired with an Approval. */
  | "WAITING_FOR_CEO"
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
  /** Why the task cannot proceed — shown wherever it is blocked. */
  blockedReason?: string;
  approvalId?: string;
  reportId?: string;
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
  | "approval.revision_requested"
  | "report.generated"
  | "report.approved"
  | "report.rejected"
  | "report.revision_requested"
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
  reportId?: string;
  severity?: "normal" | "important" | "critical";
}

export type ApprovalKind =
  | "project_start"
  | "budget"
  | "external_service"
  | "email"
  | "social_post"
  | "deploy"
  | "report"
  | "task"
  | "contract"
  | "decision";

export type ApprovalStatus =
  | "pending"
  | "reviewing"
  | "approved"
  | "rejected"
  | "revision_requested";

/** Drives ordering everywhere the CEO is asked to decide something. */
export type Priority = "urgent" | "high" | "medium" | "low";

export interface Approval {
  id: string;
  kind: ApprovalKind;
  title: string;
  /** Longer description of what is being asked for. */
  description?: string;
  requestedBy: string;
  requestedAt: number;
  summary: string;
  /** What actually happens the moment the CEO approves. */
  impact: string;
  risk: "low" | "medium" | "high";
  priority: Priority;
  payload?: { label: string; value: string }[];
  status: ApprovalStatus;
  deadline?: number;
  relatedTaskId?: string;
  relatedReportId?: string;
  relatedProjectId?: string;
  /** Where "Review" takes the CEO. */
  href?: string;
  reviewedAt?: number;
  reviewedBy?: string;
  reviewComment?: string;
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

export type NotificationLevel =
  | "INFO"
  | "SUCCESS"
  | "WARNING"
  | "APPROVAL_REQUIRED"
  | "ERROR"
  | "URGENT";

export type NotificationKind =
  | "approval"
  | "report"
  | "error"
  | "task_completed"
  | "discovery"
  | "deadline"
  | "recommendation";

export interface NotificationItem {
  id: string;
  /** Semantic category — picks the icon. */
  kind: NotificationKind;
  /** Urgency — picks the treatment, and decides banner eligibility. */
  level: NotificationLevel;
  title: string;
  message: string;
  createdAt: number;
  read: boolean;
  /** Always the CEO in a one-human company, but modelled for later. */
  recipient: "CEO";
  agentId?: string;
  relatedTaskId?: string;
  relatedReportId?: string;
  relatedApprovalId?: string;
  /** Clicking the notification goes straight here. */
  href?: string;
  actionLabel?: string;
}

/* ── Reports ──────────────────────────────────────────────────────────────── */

export type ReportType =
  | "daily"
  | "weekly"
  | "project"
  | "department"
  | "research"
  | "task_completion"
  | "executive"
  | "briefing";

/**
 * The lifecycle an AI-authored report moves through.
 *
 *   DRAFT → GENERATING → GENERATED → PENDING_REVIEW → APPROVED
 *                                                  ↘ REVISION_REQUIRED → (new version)
 *                                                  ↘ REJECTED
 */
export type ReportStatus =
  | "DRAFT"
  | "GENERATING"
  | "GENERATED"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REVISION_REQUIRED"
  | "REJECTED"
  | "ARCHIVED";

export interface ReportMetric {
  label: string;
  value: string;
  delta?: string;
  positive?: boolean;
}

export interface ReportDepartmentResult {
  department: DepartmentId;
  headline: string;
  points: string[];
  metric?: ReportMetric;
}

export interface ReportProjectResult {
  projectId: string;
  progress: number;
  health: Project["health"];
  note: string;
}

export interface ReportContribution {
  agentId: string;
  text: string;
}

export interface ReportRisk {
  level: "high" | "medium" | "low";
  text: string;
}

/**
 * The body of a report, in the order a formal executive report presents it:
 * Cover → Executive Summary → Key Metrics → Department Performance →
 * Project Progress → Major Achievements → Important Findings →
 * Problems / Risks → CEO Decisions Required → Next Actions → Appendix.
 *
 * Both the on-screen Report Detail and the generated PDF render from this one
 * structure, so they can never drift apart.
 */
export interface ReportContent {
  subtitle: string;
  period: string;
  executiveSummary: string;
  keyMetrics: ReportMetric[];
  departmentResults: ReportDepartmentResult[];
  projectResults: ReportProjectResult[];
  achievements: ReportContribution[];
  findings: string[];
  risks: ReportRisk[];
  /** What the report is asking the CEO to decide. */
  decisions: string[];
  nextActions: string[];
  appendix: { label: string; value: string }[];
}

export interface Report {
  id: string;
  title: string;
  type: ReportType;
  status: ReportStatus;
  /** The AI employee who authored it. */
  createdBy: string;
  /** Every AI employee whose work fed into it. */
  sources: string[];
  createdAt: number;
  updatedAt: number;
  projectId?: string;
  departmentId?: DepartmentId;
  content: ReportContent;
  /** Stable, openable URL — served by the PDF route handler. */
  pdfUrl: string;
  requiresReview: boolean;
  priority: Priority;
  reviewedAt?: number;
  reviewedBy?: string;
  reviewComment?: string;
  /** Set on a re-issued report; points at the version it replaces. */
  revisionOf?: string;
  version: number;
  approvalId?: string;
}

export const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  daily: "Daily Report",
  weekly: "Weekly Report",
  project: "Project Report",
  department: "Department Report",
  research: "Research Report",
  task_completion: "Task Completion Report",
  executive: "Executive Report",
  briefing: "Morning Briefing",
};
