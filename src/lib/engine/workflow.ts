import { AGENTS_BY_ID } from "@/lib/company/agents";
import { REPORT_TYPE_LABEL } from "@/lib/types";
import type {
  ActivityEvent,
  Approval,
  ApprovalKind,
  NotificationItem,
  NotificationLevel,
  Priority,
  Report,
  Task,
} from "@/lib/types";

/**
 * The workflow that joins the pieces together:
 *
 *   Task → Report → Approval → Notification → CEO Decision → work resumes
 *
 * Nothing here talks to React. The store calls these to produce the records a
 * step should create, which keeps the rules in one readable place.
 */

let seq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const roleOf = (agentId: string) => AGENTS_BY_ID[agentId]?.role ?? agentId;

/* ── Notifications ────────────────────────────────────────────────────────── */

export function notify(input: {
  kind: NotificationItem["kind"];
  level: NotificationLevel;
  title: string;
  message: string;
  at: number;
  agentId?: string;
  href?: string;
  actionLabel?: string;
  relatedTaskId?: string;
  relatedReportId?: string;
  relatedApprovalId?: string;
}): NotificationItem {
  return {
    id: uid("ntf"),
    kind: input.kind,
    level: input.level,
    title: input.title,
    message: input.message,
    createdAt: input.at,
    read: false,
    recipient: "CEO",
    agentId: input.agentId,
    href: input.href,
    actionLabel: input.actionLabel,
    relatedTaskId: input.relatedTaskId,
    relatedReportId: input.relatedReportId,
    relatedApprovalId: input.relatedApprovalId,
  };
}

/* ── Approval requests ────────────────────────────────────────────────────── */

export interface ApprovalRequestInput {
  kind: ApprovalKind;
  title: string;
  description?: string;
  summary: string;
  impact: string;
  requestedBy: string;
  at: number;
  risk?: Approval["risk"];
  priority?: Priority;
  href?: string;
  payload?: { label: string; value: string }[];
  relatedTaskId?: string;
  relatedReportId?: string;
  relatedProjectId?: string;
  deadline?: number;
}

/**
 * What an AI employee does when it cannot decide something itself: it stops,
 * records why, and asks. It never proceeds on its own.
 */
export function requestApproval(input: ApprovalRequestInput): {
  approval: Approval;
  notification: NotificationItem;
  event: ActivityEvent;
} {
  const approval: Approval = {
    id: uid("ap"),
    kind: input.kind,
    title: input.title,
    description: input.description,
    requestedBy: input.requestedBy,
    requestedAt: input.at,
    summary: input.summary,
    impact: input.impact,
    risk: input.risk ?? "medium",
    priority: input.priority ?? "high",
    status: "pending",
    payload: input.payload,
    deadline: input.deadline,
    relatedTaskId: input.relatedTaskId,
    relatedReportId: input.relatedReportId,
    relatedProjectId: input.relatedProjectId,
    href: input.href,
  };

  const notification = notify({
    kind: input.kind === "report" ? "report" : "approval",
    level: input.priority === "urgent" ? "URGENT" : "APPROVAL_REQUIRED",
    title: input.title,
    message: `${roleOf(input.requestedBy)} があなたの承認を待っています。${input.summary}`,
    at: input.at,
    agentId: input.requestedBy,
    href: input.href,
    actionLabel: "Review",
    relatedTaskId: input.relatedTaskId,
    relatedReportId: input.relatedReportId,
    relatedApprovalId: approval.id,
  });

  const event: ActivityEvent = {
    id: uid("act"),
    kind: "approval.requested",
    agentId: input.requestedBy,
    at: input.at,
    message: `${input.title}の承認を申請`,
    detail: input.summary,
    severity: input.priority === "urgent" ? "critical" : "important",
    taskId: input.relatedTaskId,
    reportId: input.relatedReportId,
  };

  return { approval, notification, event };
}

/* ── Reports ──────────────────────────────────────────────────────────────── */

/** The records that accompany a freshly generated report into the CEO's queue. */
export function submitReportForReview(
  report: Report,
  at: number,
): { approval: Approval; notification: NotificationItem; events: ActivityEvent[] } {
  const generated: ActivityEvent = {
    id: uid("act"),
    kind: "report.generated",
    agentId: report.createdBy,
    at,
    message: `${REPORT_TYPE_LABEL[report.type]}を生成`,
    detail: report.title,
    reportId: report.id,
    severity: "important",
  };

  const { approval, notification, event } = requestApproval({
    kind: "report",
    title: `${report.title} の確認`,
    description: report.content.executiveSummary.slice(0, 160),
    summary: `${report.sources.length}名のAI社員の成果を集約しました。PDFを添付しています。`,
    impact: "承認するとレポートが確定し、Knowledge Center へ保存されます。",
    requestedBy: report.createdBy,
    at,
    risk: "low",
    priority: report.priority,
    href: `/reports/${report.id}`,
    relatedReportId: report.id,
    payload: [
      { label: "Type", value: REPORT_TYPE_LABEL[report.type] },
      { label: "Created by", value: roleOf(report.createdBy) },
      { label: "Sources", value: `${report.sources.length} AI employees` },
      { label: "PDF", value: report.pdfUrl },
    ],
  });

  return {
    approval,
    notification: {
      ...notification,
      title: `${report.title} is ready for review.`,
      message: `${roleOf(report.createdBy)}がレポートを作成しました。PDFを確認のうえ承認してください。`,
      actionLabel: "Open Report",
    },
    events: [generated, event],
  };
}

/** The revision task an AI employee picks up when the CEO asks for changes. */
export function buildRevisionTask(report: Report, comment: string, at: number): Task {
  return {
    id: uid("t"),
    title: `${report.title} の修正`,
    description: `CEOからの修正依頼: ${comment}`,
    status: "RUNNING",
    priority: "high",
    assignedAgent: report.createdBy,
    department: AGENTS_BY_ID[report.createdBy]?.department ?? "strategy",
    project: report.projectId,
    createdAt: at,
    updatedAt: at,
    subTasks: [],
    progress: 10,
    reportId: report.id,
  };
}

/* ── CEO decisions ────────────────────────────────────────────────────────── */

export function ceoDecisionEvent(
  decision: "approved" | "rejected" | "revision_requested",
  subject: string,
  agentId: string,
  at: number,
  reportId?: string,
): ActivityEvent {
  const message =
    decision === "approved"
      ? `CEO approved: ${subject}`
      : decision === "rejected"
        ? `CEO rejected: ${subject}`
        : `CEO requested revision: ${subject}`;

  return {
    id: uid("act"),
    kind:
      decision === "approved"
        ? reportId
          ? "report.approved"
          : "approval.approved"
        : decision === "rejected"
          ? reportId
            ? "report.rejected"
            : "approval.rejected"
          : reportId
            ? "report.revision_requested"
            : "approval.revision_requested",
    agentId,
    at,
    message,
    detail: subject,
    reportId,
    severity: "important",
  };
}

export function decisionNotification(
  decision: "approved" | "rejected" | "revision_requested",
  subject: string,
  agentId: string,
  at: number,
  href?: string,
): NotificationItem {
  const level: NotificationLevel =
    decision === "approved" ? "SUCCESS" : decision === "rejected" ? "WARNING" : "INFO";

  const message =
    decision === "approved"
      ? `${roleOf(agentId)} へ承認を通知しました。作業を再開します。`
      : decision === "rejected"
        ? `${roleOf(agentId)} へ却下を通知しました。作業は中止されます。`
        : `${roleOf(agentId)} が修正版の作成を開始しました。`;

  return notify({
    kind: "task_completed",
    level,
    title: subject,
    message,
    at,
    agentId,
    href,
  });
}

export { uid as workflowId, roleOf as workflowRole };
