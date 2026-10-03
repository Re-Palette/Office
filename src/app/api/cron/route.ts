import { NextResponse } from "next/server";
import { stateful } from "@/server/runtime/stateful";
import { getConfig } from "@/server/runtime/config";
import { jobHistory, jobs, runDueJobs } from "@/server/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel caps this per plan (300s on Hobby). Long agent runs stream their
// progress into the activity feed, so a cut-off loses the tail, not the work.
export const maxDuration = 300;

/**
 * The company's clock, as an endpoint.
 *
 * Several things ring it — a platform cron, the dashboard while a tab is
 * open, and the CEO pressing "Run now" — because any one of them alone would
 * leave a gap. The free plan in particular allows very few scheduled firings,
 * far fewer than the company has jobs, so most days some of them are picked
 * up late by whichever trigger comes next.
 *
 * That is safe because it asks for everything *due* rather than for a
 * specific job, and because each job is keyed by its JST day: ringing twice
 * is a no-op, and ringing late still gets the work done.
 */

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true; // Nothing to check against; local development.

  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function handleGET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  if (getConfig().mode === "demo") {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;
  const force = params.get("force") === "1";
  // "Run now" names the job it means; without a name, force runs the article,
  // which is the one the dashboard's button has always meant.
  const only = params.get("job") ?? (force ? "note-daily-draft" : null);

  const available = jobs();

  let results;
  if (force && only) {
    const job = available.find((j) => j.id === only);
    if (!job) {
      return NextResponse.json(
        { error: "unknown job", jobs: available.map((j) => j.id) },
        { status: 422 },
      );
    }
    results = [await job.run(true)];
  } else {
    results = await runDueJobs();
  }

  return NextResponse.json({
    results,
    jobs: available.map((j) => ({ id: j.id, label: j.label, at: j.at })),
    history: jobHistory().slice(0, 10),
  });
}

export const GET = stateful(handleGET);

/** Platform crons POST as often as they GET. */
export const POST = GET;
