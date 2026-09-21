import { NextResponse } from "next/server";
import { getConfig } from "@/server/runtime/config";
import { readState } from "@/server/runtime/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The company's live working state. The dashboard polls this in live mode and
 * renders whatever the AI employees have actually done.
 */
export async function GET() {
  if (getConfig().mode === "demo") {
    return NextResponse.json({ mode: "demo" });
  }

  const state = readState();
  return NextResponse.json(
    {
      mode: "live",
      updatedAt: state.updatedAt,
      activity: state.activity.slice(0, 200),
      tasks: state.tasks,
      reports: state.reports,
      approvals: state.approvals,
      notifications: state.notifications.slice(0, 80),
      agents: state.agents,
      usage: state.usage,
      // Message history is intentionally omitted — it is large and internal.
      runs: state.runs.slice(0, 40).map(({ messages: _messages, ...run }) => run),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
