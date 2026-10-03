import { NextResponse } from "next/server";
import { stateful } from "@/server/runtime/stateful";
import { putReport } from "@/server/report-store";
import type { Report } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/reports
 *
 * The dashboard pushes reports it generates here so the PDF route can render
 * them. The write is durable, so the PDF resolves from any instance.
 */
async function handlePOST(request: Request) {
  let report: Report;
  try {
    report = (await request.json()) as Report;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!report?.id || !report.content || !report.title) {
    return NextResponse.json(
      { error: "A report requires id, title and content" },
      { status: 422 },
    );
  }

  putReport(report);
  return NextResponse.json({ id: report.id, pdfUrl: `/reports/${report.id}/pdf` });
}

export const POST = stateful(handlePOST);
