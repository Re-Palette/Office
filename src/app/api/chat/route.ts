import { NextResponse } from "next/server";
import { stateful } from "@/server/runtime/stateful";
import { getConfig } from "@/server/runtime/config";
import { runAgent } from "@/server/agents/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel caps this per plan (300s on Hobby). Long agent runs stream their
// progress into the activity feed, so a cut-off loses the tail, not the work.
export const maxDuration = 300;

/**
 * POST /api/chat — the CEO talks to the company.
 *
 * The COO answers using the company's real state, delegating when a question
 * genuinely belongs to someone else. Synchronous: the CEO is waiting.
 */
async function handlePOST(request: Request) {
  const cfg = getConfig();
  if (cfg.mode === "demo") {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let body: { message?: string; agentId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 422 });
  }

  const result = await runAgent({
    agentId: body.agentId?.trim() || "coo",
    objective: message,
    context:
      "CEOからの質問です。会社の実際のデータを読んだうえで、簡潔に答えてください。" +
      "レポートの提出は求められていません。",
    canDelegate: true,
    canReport: false,
  });

  return NextResponse.json(result);
}

export const POST = stateful(handlePOST);
