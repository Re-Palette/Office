import { NextResponse } from "next/server";
import { getConfig } from "@/server/runtime/config";
import { runAgent } from "@/server/agents/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel caps this per plan (300s on Hobby). Long agent runs stream their
// progress into the activity feed, so a cut-off loses the tail, not the work.
export const maxDuration = 300;

/**
 * POST /api/command — the CEO instructs the company.
 *
 * The COO picks it up, decomposes it and delegates. Runs are long, so this
 * returns as soon as the work has started; the dashboard follows along through
 * the activity feed.
 */
export async function POST(request: Request) {
  const cfg = getConfig();
  if (cfg.mode === "demo") {
    return NextResponse.json(
      {
        error: "not_configured",
        message:
          "ANTHROPIC_API_KEY が未設定のため、AI社員は実際には動作しません。Settings の手順を参照してください。",
      },
      { status: 503 },
    );
  }

  let body: { instruction?: string; agentId?: string; wait?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const instruction = body.instruction?.trim();
  if (!instruction) {
    return NextResponse.json({ error: "instruction is required" }, { status: 422 });
  }

  const options = {
    agentId: body.agentId?.trim() || "coo",
    objective: instruction,
    context:
      "これはCEO（陽大）からの直接の指示です。必要に応じて他のAI社員へ委譲し、" +
      "最終的にあなたが1つの報告へ統合してください。",
    canDelegate: true,
    canReport: true,
  };

  if (body.wait) {
    const result = await runAgent(options);
    return NextResponse.json(result);
  }

  // Fire and forget: the run keeps going and writes into the company state.
  const started = runAgent(options);
  started.catch((error) => console.error("[friday] command run failed:", error));

  return NextResponse.json({ status: "started", agentId: options.agentId });
}
