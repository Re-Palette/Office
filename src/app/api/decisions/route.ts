import { NextResponse } from "next/server";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import type { ApprovalStatus, ReportStatus } from "@/lib/types";
import { getConfig } from "@/server/runtime/config";
import { mutate } from "@/server/runtime/store";
import { resumeRun } from "@/server/agents/runner";
import { putReport } from "@/server/report-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel caps this per plan (300s on Hobby). Long agent runs stream their
// progress into the activity feed, so a cut-off loses the tail, not the work.
export const maxDuration = 300;

type Decision = "approved" | "rejected" | "revision_requested";

/**
 * POST /api/decisions — the CEO decides.
 *
 * This is the point of the whole approval gate: the decision is recorded, the
 * blocked task is released, and the AI employee that stopped to ask picks its
 * work back up from where it paused.
 */
export async function POST(request: Request) {
  if (getConfig().mode === "demo") {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let body: { approvalId?: string; reportId?: string; decision?: Decision; comment?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const decision = body.decision;
  if (!decision || !["approved", "rejected", "revision_requested"].includes(decision)) {
    return NextResponse.json({ error: "decision must be approved | rejected | revision_requested" }, { status: 422 });
  }

  const now = Date.now();

  const resolved = mutate((s) => {
    const approval = body.approvalId
      ? s.approvals.find((a) => a.id === body.approvalId)
      : body.reportId
        ? s.approvals.find((a) => a.relatedReportId === body.reportId && a.status === "pending")
        : undefined;

    if (!approval) return null;

    approval.status = decision as ApprovalStatus;
    approval.reviewedAt = now;
    approval.reviewedBy = "CEO";
    approval.reviewComment = body.comment;

    // Release or stop whatever the approval was blocking.
    for (const task of s.tasks) {
      if (task.approvalId !== approval.id) continue;
      task.updatedAt = now;
      task.status = decision === "rejected" ? "FAILED" : "RUNNING";
      if (decision !== "rejected") task.blockedReason = undefined;
    }

    let report = approval.relatedReportId
      ? s.reports.find((r) => r.id === approval.relatedReportId)
      : undefined;
    if (report) {
      report.status =
        decision === "approved"
          ? ("APPROVED" as ReportStatus)
          : decision === "rejected"
            ? ("REJECTED" as ReportStatus)
            : ("REVISION_REQUIRED" as ReportStatus);
      report.reviewedAt = now;
      report.reviewedBy = "CEO";
      report.reviewComment = body.comment;
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
          decision === "approved"
            ? "approval.approved"
            : decision === "rejected"
              ? "approval.rejected"
              : "approval.revision_requested",
        agentId: approval.requestedBy,
        at: now,
        message:
          decision === "approved"
            ? `CEO approved: ${approval.title}`
            : decision === "rejected"
              ? `CEO rejected: ${approval.title}`
              : `CEO requested revision: ${approval.title}`,
        detail: body.comment ?? approval.title,
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

  if (!resolved) {
    return NextResponse.json({ error: "approval not found" }, { status: 404 });
  }

  if (resolved.report) putReport(resolved.report);

  // Resuming can take a while — let it run and report back through the feed.
  let resumed = false;
  if (resolved.runId) {
    resumed = true;
    resumeRun(resolved.runId, decision, body.comment).catch((error) =>
      console.error("[friday] resume failed:", error),
    );
  }

  return NextResponse.json({
    status: "ok",
    approvalId: resolved.approvalId,
    resumed,
    agent: resolved.runId ? AGENTS_BY_ID[resolved.report?.createdBy ?? ""]?.role : undefined,
  });
}
