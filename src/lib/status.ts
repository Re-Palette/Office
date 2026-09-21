import type { AgentStatus, TaskStatus } from "@/lib/types";

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

export const AGENT_STATUS: Record<AgentStatus, StatusMeta> = {
  working:       { label: "Working",        dot: "bg-live",   text: "text-live",   chip: "bg-live/10 text-live",     active: true,  pulse: true },
  thinking:      { label: "Thinking",       dot: "bg-accent", text: "text-accent-soft", chip: "bg-accent/10 text-accent-soft", active: true, pulse: true },
  researching:   { label: "Researching",    dot: "bg-[#5BC8D8]", text: "text-[#5BC8D8]", chip: "bg-[#5BC8D8]/10 text-[#5BC8D8]", active: true, pulse: true },
  coding:        { label: "Coding",         dot: "bg-[#4FA8FF]", text: "text-[#4FA8FF]", chip: "bg-[#4FA8FF]/10 text-[#4FA8FF]", active: true, pulse: true },
  writing:       { label: "Writing",        dot: "bg-[#A78BFA]", text: "text-[#A78BFA]", chip: "bg-[#A78BFA]/10 text-[#A78BFA]", active: true, pulse: true },
  designing:     { label: "Designing",      dot: "bg-[#F0849B]", text: "text-[#F0849B]", chip: "bg-[#F0849B]/10 text-[#F0849B]", active: true, pulse: true },
  waiting:       { label: "Waiting",        dot: "bg-ink-ghost", text: "text-ink-faint", chip: "bg-white/5 text-ink-faint", active: false },
  completed:     { label: "Completed",      dot: "bg-live/60", text: "text-ink-muted", chip: "bg-live/10 text-live", active: false },
  needs_approval:{ label: "Needs Approval", dot: "bg-warn",   text: "text-warn",   chip: "bg-warn/10 text-warn",     active: false, pulse: true },
  error:         { label: "Error",          dot: "bg-danger", text: "text-danger", chip: "bg-danger/10 text-danger", active: false, pulse: true },
  idle:          { label: "Idle",           dot: "bg-ink-ghost", text: "text-ink-ghost", chip: "bg-white/5 text-ink-ghost", active: false },
};

export const TASK_STATUS: Record<TaskStatus, { label: string; chip: string }> = {
  QUEUED:    { label: "QUEUED",    chip: "bg-white/5 text-ink-faint" },
  PLANNING:  { label: "PLANNING",  chip: "bg-accent/10 text-accent-soft" },
  RUNNING:   { label: "RUNNING",   chip: "bg-live/10 text-live" },
  WAITING:   { label: "WAITING",   chip: "bg-warn/10 text-warn" },
  REVIEW:    { label: "REVIEW",    chip: "bg-[#A78BFA]/10 text-[#A78BFA]" },
  COMPLETED: { label: "COMPLETED", chip: "bg-white/5 text-ink-muted" },
  FAILED:    { label: "FAILED",    chip: "bg-danger/10 text-danger" },
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
  "agent.handoff":      { label: "HANDOFF",   tone: "text-[#A78BFA]" },
  "task.created":       { label: "TASK",      tone: "text-ink-muted" },
  "task.assigned":      { label: "ASSIGNED",  tone: "text-[#A78BFA]" },
  "task.completed":     { label: "DONE",      tone: "text-live" },
  "approval.requested": { label: "APPROVAL",  tone: "text-warn" },
  "approval.approved":  { label: "APPROVED",  tone: "text-live" },
  "approval.rejected":  { label: "REJECTED",  tone: "text-danger" },
  "report.generated":   { label: "REPORT",    tone: "text-ink-muted" },
  "insight.found":      { label: "INSIGHT",   tone: "text-[#5BC8D8]" },
};

export const isActiveStatus = (s: AgentStatus) => AGENT_STATUS[s].active;
