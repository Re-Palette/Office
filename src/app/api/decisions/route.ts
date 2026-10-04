import { NextResponse } from "next/server";
import { stateful } from "@/server/runtime/stateful";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { getConfig } from "@/server/runtime/config";
import { resumeRun } from "@/server/agents/runner";
import { background } from "@/server/runtime/background";
import { applyDecision, type Decision } from "@/server/decisions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel caps this per plan (300s on Hobby). Long agent runs stream their
// progress into the activity feed, so a cut-off loses the tail, not the work.
export const maxDuration = 300;

/**
 * POST /api/decisions — the CEO decides.
 *
 * This is the point of the whole approval gate: the decision is recorded, the
 * blocked task is released, and the AI employee that stopped to ask picks its
 * work back up from where it paused. The decision itself lives in
 * server/decisions.ts, because the vice-president agent reaches the same gate.
 */
async function handlePOST(request: Request) {
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
    return NextResponse.json(
      { error: "decision must be approved | rejected | revision_requested" },
      { status: 422 },
    );
  }

  const resolved = applyDecision({ ...body, decision });
  if (!resolved) {
    return NextResponse.json({ error: "approval not found" }, { status: 404 });
  }

  // Resuming can take a while, so the CEO is not kept waiting — but it must
  // still actually happen. This is the path that carries out the action the
  // CEO just approved; a dropped promise here meant an approved email was
  // never sent, with nothing anywhere saying so.
  let resumed = false;
  if (resolved.runId) {
    resumed = true;
    const runId = resolved.runId;
    background("resume", () => resumeRun(runId, decision, body.comment));
  }

  return NextResponse.json({
    status: "ok",
    approvalId: resolved.approvalId,
    resumed,
    agent: resolved.runId ? AGENTS_BY_ID[resolved.report?.createdBy ?? ""]?.role : undefined,
  });
}

export const POST = stateful(handlePOST);
