import { NextResponse } from "next/server";
import { stateful } from "@/server/runtime/stateful";
import { getConfig } from "@/server/runtime/config";
import { listDrafts, setDraftStatus, type NoteDraftStatus } from "@/server/note-drafts";
import { jobHistory } from "@/server/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The note articles waiting to be posted, newest first. */
async function handleGET() {
  if (getConfig().mode === "demo") {
    return NextResponse.json({ drafts: [], jobs: [] });
  }
  return NextResponse.json({
    drafts: listDrafts(),
    jobs: jobHistory().filter((j) => j.id === "note-daily-draft").slice(0, 7),
  });
}

/** The CEO marks a draft posted, or puts it aside. */
async function handlePOST(request: Request) {
  if (getConfig().mode === "demo") {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let body: { id?: string; status?: NoteDraftStatus; noteUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.id || !body.status) {
    return NextResponse.json({ error: "id and status are required" }, { status: 422 });
  }
  if (!["READY", "POSTED", "ARCHIVED"].includes(body.status)) {
    return NextResponse.json({ error: "unknown status" }, { status: 422 });
  }

  const draft = setDraftStatus(body.id, body.status, body.noteUrl);
  if (!draft) return NextResponse.json({ error: "draft not found" }, { status: 404 });

  return NextResponse.json({ draft });
}

export const GET = stateful(handleGET);
export const POST = stateful(handlePOST);
