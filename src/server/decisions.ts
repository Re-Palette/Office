import "server-only";

import type { ApprovalStatus, Report, ReportStatus } from "@/lib/types";
import { mutate } from "@/server/runtime/store";
import { putReport } from "@/server/report-store";
import { uid } from "@/server/runtime/uid";

/**
 * The CEO's decision on something an AI employee stopped to ask about.
 *
 * Lifted out of the route handler because it is now reachable from two
 * places: the dashboard, and the vice-president agent relaying a decision the
 * CEO gave it in conversation. One implementation means the gate behaves the
 * same whichever door it is opened from — which matters, because this is the
 * function that releases an irreversible action.
 */

export type Decision = "approved" | "rejected" | "revision_requested";

export interface DecisionInput {
  approvalId?: string;
  reportId?: string;
  decision: Decision;
  comment?: string;
}

export interface DecisionOutcome {
  approvalId: string;
  /** The run that paused to ask, if one is still waiting to be resumed. */
  runId?: string;
  report?: Report;
}

export function applyDecision(input: DecisionInput): DecisionOutcome | null {
  const now = Date.now();

  const resolved = mutate((s) => {
    const approval = input.approvalId
      ? s.approvals.find((a) => a.id === input.approvalId)
      : input.reportId
        ? s.approvals.find((a) => a.relatedReportId === input.reportId && a.status === "pending")
        : undefined;

    if (!approval) return null;

    approval.status = input.decision as ApprovalStatus;
    approval.reviewedAt = now;
    approval.reviewedBy = "CEO";
    approval.reviewComment = input.comment;

    // Release or stop whatever the approval was blocking.
    for (const task of s.tasks) {
      if (task.approvalId !== approval.id) continue;
      task.updatedAt = now;
      task.status = input.decision === "rejected" ? "FAILED" : "RUNNING";
      if (input.decision !== "rejected") task.blockedReason = undefined;
    }

    let report = approval.relatedReportId
      ? s.reports.find((r) => r.id === approval.relatedReportId)
      : undefined;
    if (report) {
      report.status =
        input.decision === "approved"
          ? ("APPROVED" as ReportStatus)
          : input.decision === "rejected"
            ? ("REJECTED" as ReportStatus)
            : ("REVISION_REQUIRED" as ReportStatus);
      report.reviewedAt = now;
      report.reviewedBy = "CEO";
      report.reviewComment = input.comment;
      report.updatedAt = now;
    } else {
      report = undefined;
    }

    for (const notification of s.notifications) {
      if (notification.relatedApprovalId === approval.id) notification.read = true;
    }

    s.activity = [
      {
        id: `act-${now.toString(36)}-d`,
        kind:
          input.decision === "approved"
            ? "approval.approved"
            : input.decision === "rejected"
              ? "approval.rejected"
              : "approval.revision_requested",
        agentId: approval.requestedBy,
        at: now,
        message:
          input.decision === "approved"
            ? `CEO approved: ${approval.title}`
            : input.decision === "rejected"
              ? `CEO rejected: ${approval.title}`
              : `CEO requested revision: ${approval.title}`,
        detail: input.comment ?? approval.title,
        severity: "important",
      },
      ...s.activity,
    ];

    // The run that stopped to ask, so it can be continued.
    const waiting = s.runs.find(
      (r) => r.approvalId === approval.id && r.status === "waiting_for_ceo",
    );

    return { approvalId: approval.id, runId: waiting?.id, report };
  });


  if (resolved?.report) putReport(resolved.report);
  return resolved;
}
