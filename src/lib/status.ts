import type {
  AgentStatus,
  ApprovalStatus,
  NotificationLevel,
  Priority,
  ReportStatus,
  TaskStatus,
} from "@/lib/types";

export interface StatusMeta {
  label: string;
  /** Tailwind classes for the dot/text pairing. */
  dot: string;
  text: string;
  chip: string;
  /** True when the agent counts towards "active" head-count. */
  active: boolean;
  pulse?: boolean;
}

/**
 * Activity states.
 *
 * The working states share one family — a cool blue-green run — so "this agent
 * is busy" reads at a glance, while the three states that need the CEO
 * (waiting / needs approval / error) break out of it on purpose. Chip fills are
 * strong enough to register as a filled badge rather than a tint.
 */
export const AGENT_STATUS: Record<AgentStatus, StatusMeta> = {
  working:       { label: "Working",        dot: "bg-live",      text: "text-live",      chip: "bg-live/[0.18] text-live",           active: true,  pulse: true },
  thinking:      { label: "Thinking",       dot: "bg-accent",    text: "text-accent-soft", chip: "bg-accent/[0.22] text-accent-soft", active: true,  pulse: true },
  researching:   { label: "Researching",    dot: "bg-info",      text: "text-info",      chip: "bg-info/[0.18] text-info",           active: true,  pulse: true },
  coding:        { label: "Coding",         dot: "bg-[#5EEAD4]", text: "text-[#5EEAD4]", chip: "bg-[#5EEAD4]/[0.16] text-[#5EEAD4]", active: true,  pulse: true },
  writing:       { label: "Writing",        dot: "bg-[#C4B5FD]", text: "text-[#C4B5FD]", chip: "bg-[#C4B5FD]/[0.18] text-[#C4B5FD]", active: true,  pulse: true },
  designing:     { label: "Designing",      dot: "bg-[#F9A8D4]", text: "text-[#F9A8D4]", chip: "bg-[#F9A8D4]/[0.16] text-[#F9A8D4]", active: true,  pulse: true },
  waiting:       { label: "Waiting",        dot: "bg-ink-ghost", text: "text-ink-faint", chip: "bg-white/[0.08] text-ink-faint",     active: false },
  completed:     { label: "Completed",      dot: "bg-live/70",   text: "text-ink-muted", chip: "bg-white/[0.08] text-ink-muted",     active: false },
  needs_approval:{ label: "Needs Approval", dot: "bg-warn",      text: "text-warn",      chip: "bg-warn/[0.20] text-warn",           active: false, pulse: true },
  error:         { label: "Error",          dot: "bg-danger",    text: "text-danger",    chip: "bg-danger/[0.20] text-danger",       active: false, pulse: true },
  idle:          { label: "Idle",           dot: "bg-ink-ghost", text: "text-ink-ghost", chip: "bg-white/[0.06] text-ink-faint",     active: false },
};

export const TASK_STATUS: Record<TaskStatus, { label: string; chip: string }> = {
  QUEUED:          { label: "QUEUED",          chip: "bg-white/[0.08] text-ink-faint" },
  PLANNING:        { label: "PLANNING",        chip: "bg-accent/[0.22] text-accent-soft" },
  RUNNING:         { label: "RUNNING",         chip: "bg-live/[0.18] text-live" },
  WAITING:         { label: "WAITING",         chip: "bg-white/[0.08] text-ink-muted" },
  WAITING_FOR_CEO: { label: "WAITING FOR CEO", chip: "bg-warn/[0.22] text-warn" },
  REVIEW:          { label: "REVIEW",          chip: "bg-[#C4B5FD]/[0.18] text-[#C4B5FD]" },
  COMPLETED:       { label: "COMPLETED",       chip: "bg-white/[0.08] text-ink-muted" },
  FAILED:          { label: "FAILED",          chip: "bg-danger/[0.20] text-danger" },
};

export const REPORT_STATUS: Record<
  ReportStatus,
  { label: string; chip: string; dot: string }
> = {
  DRAFT:             { label: "DRAFT",             chip: "bg-white/[0.08] text-ink-faint",     dot: "bg-ink-ghost" },
  GENERATING:        { label: "GENERATING",        chip: "bg-accent/[0.22] text-accent-soft",  dot: "bg-accent" },
  GENERATED:         { label: "GENERATED",         chip: "bg-info/[0.18] text-info",           dot: "bg-info" },
  PENDING_REVIEW:    { label: "PENDING REVIEW",    chip: "bg-warn/[0.22] text-warn",           dot: "bg-warn" },
  APPROVED:          { label: "APPROVED",          chip: "bg-live/[0.18] text-live",           dot: "bg-live" },
  REVISION_REQUIRED: { label: "REVISION REQUIRED", chip: "bg-[#C4B5FD]/[0.18] text-[#C4B5FD]", dot: "bg-[#C4B5FD]" },
  REJECTED:          { label: "REJECTED",          chip: "bg-danger/[0.20] text-danger",       dot: "bg-danger" },
  ARCHIVED:          { label: "ARCHIVED",          chip: "bg-white/[0.06] text-ink-faint",     dot: "bg-ink-ghost" },
};

export const APPROVAL_STATUS: Record<ApprovalStatus, { label: string; chip: string }> = {
  pending:            { label: "PENDING",            chip: "bg-warn/[0.22] text-warn" },
  reviewing:          { label: "REVIEWING",          chip: "bg-accent/[0.22] text-accent-soft" },
  approved:           { label: "APPROVED",           chip: "bg-live/[0.18] text-live" },
  rejected:           { label: "REJECTED",           chip: "bg-danger/[0.20] text-danger" },
  revision_requested: { label: "REVISION REQUESTED", chip: "bg-[#C4B5FD]/[0.18] text-[#C4B5FD]" },
};

export const NOTIFICATION_LEVEL: Record<
  NotificationLevel,
  { label: string; chip: string; dot: string; banner: boolean }
> = {
  INFO:              { label: "INFO",     chip: "bg-info/[0.16] text-info",       dot: "bg-info",      banner: false },
  SUCCESS:           { label: "SUCCESS",  chip: "bg-live/[0.18] text-live",       dot: "bg-live",      banner: false },
  WARNING:           { label: "WARNING",  chip: "bg-warn/[0.20] text-warn",       dot: "bg-warn",      banner: false },
  APPROVAL_REQUIRED: { label: "APPROVAL", chip: "bg-warn/[0.24] text-warn",       dot: "bg-warn",      banner: true },
  ERROR:             { label: "ERROR",    chip: "bg-danger/[0.20] text-danger",   dot: "bg-danger",    banner: true },
  URGENT:            { label: "URGENT",   chip: "bg-danger/[0.20] text-danger",   dot: "bg-danger",    banner: true },
};

export const PRIORITY_ORDER: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const PRIORITY_BADGE: Record<Priority, { label: string; chip: string }> = {
  urgent: { label: "URGENT", chip: "bg-danger/[0.20] text-danger" },
  high:   { label: "HIGH",   chip: "bg-warn/[0.22] text-warn" },
  medium: { label: "MEDIUM", chip: "bg-info/[0.16] text-info" },
  low:    { label: "LOW",    chip: "bg-white/[0.08] text-ink-faint" },
};

export const PRIORITY_META = {
  critical: { label: "CRITICAL", chip: "bg-danger/10 text-danger" },
  high:     { label: "HIGH",     chip: "bg-warn/10 text-warn" },
  normal:   { label: "NORMAL",   chip: "bg-white/5 text-ink-muted" },
  low:      { label: "LOW",      chip: "bg-white/5 text-ink-ghost" },
} as const;

export const ACTIVITY_META: Record<string, { label: string; tone: string }> = {
  "agent.started":      { label: "STARTED",   tone: "text-accent-soft" },
  "agent.thinking":     { label: "THINKING",  tone: "text-accent-soft" },
  "agent.tool_called":  { label: "TOOL",      tone: "text-ink-faint" },
  "agent.completed":    { label: "COMPLETED", tone: "text-live" },
  "agent.handoff":      { label: "HANDOFF",   tone: "text-[#C4B5FD]" },
  "task.created":       { label: "TASK",      tone: "text-ink-muted" },
  "task.assigned":      { label: "ASSIGNED",  tone: "text-[#C4B5FD]" },
  "task.completed":     { label: "DONE",      tone: "text-live" },
  "approval.requested": { label: "APPROVAL",  tone: "text-warn" },
  "approval.approved":  { label: "APPROVED",  tone: "text-live" },
  "approval.rejected":  { label: "REJECTED",  tone: "text-danger" },
  "approval.revision_requested": { label: "REVISION", tone: "text-[#C4B5FD]" },
  "report.approved":    { label: "APPROVED", tone: "text-live" },
  "report.rejected":    { label: "REJECTED", tone: "text-danger" },
  "report.revision_requested":   { label: "REVISION", tone: "text-[#C4B5FD]" },
  "report.generated":   { label: "REPORT",    tone: "text-ink-muted" },
  "insight.found":      { label: "INSIGHT",   tone: "text-info" },
};

export const isActiveStatus = (s: AgentStatus) => AGENT_STATUS[s].active;
