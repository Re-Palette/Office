import { NextResponse } from "next/server";
import { stateful } from "@/server/runtime/stateful";
import { DEFAULT_SCHEDULE } from "@/lib/company/reports";
import type { ScheduleConfig } from "@/lib/types";
import { mutate, readState } from "@/server/runtime/store";
import { validateSchedule } from "@/server/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/schedule — when the recurring work runs.
 *
 * Settings has offered these as editable fields since the company was built,
 * and saving them changed a value in the browser that nothing on the server
 * ever read: the jobs compared the clock against a hardcoded constant. They
 * read this now, so the times mean something.
 */

async function handlePOST(request: Request) {
  let body: Partial<ScheduleConfig>;
  try {
    body = (await request.json()) as Partial<ScheduleConfig>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const problem = validateSchedule(body);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  const saved = mutate((s) => {
    s.schedule = { ...(s.schedule ?? DEFAULT_SCHEDULE), ...body };
    return s.schedule;
  });

  return NextResponse.json({ schedule: saved });
}

async function handleGET() {
  return NextResponse.json({ schedule: readState().schedule ?? DEFAULT_SCHEDULE });
}

export const POST = stateful(handlePOST);
export const GET = stateful(handleGET);
