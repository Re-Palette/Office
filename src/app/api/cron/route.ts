import { NextResponse } from "next/server";
import { getConfig } from "@/server/runtime/config";
import { jobHistory, runDailyNoteDraft, runDueJobs } from "@/server/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * The company's clock, as an endpoint.
 *
 * Several things ring it — a platform cron at the scheduled minute, the
 * dashboard while a tab is open, and the CEO pressing "Run now" — because any
 * one of them alone would leave a gap. The jobs are keyed by JST day, so
 * ringing it twice is harmless and ringing it late still gets the work done.
 */

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true; // Nothing to check against; local development.

  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  if (getConfig().mode === "demo") {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const force = new URL(request.url).searchParams.get("force") === "1";
  const results = force ? [await runDailyNoteDraft(true)] : await runDueJobs();

  return NextResponse.json({ results, history: jobHistory().slice(0, 10) });
}

/** Platform crons POST as often as they GET. */
export const POST = GET;
