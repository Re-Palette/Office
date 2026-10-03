import { NextResponse } from "next/server";
import { stateful } from "@/server/runtime/stateful";
import { getReport } from "@/server/report-store";
import { renderReportPdf } from "@/server/report-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /reports/{id}/pdf
 *
 * Renders the report as a real PDF. `?download=1` forces a save dialog;
 * otherwise it opens inline, which is what both the new-tab link and the
 * in-dashboard preview rely on.
 */
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const report = getReport(id);

  if (!report) {
    return NextResponse.json(
      {
        error: "Report not found",
        detail:
          "このIDのレポートが見つかりません。削除されたか、URLが古い可能性があります。",
      },
      { status: 404 },
    );
  }

  const bytes = await renderReportPdf(report);
  const download = new URL(request.url).searchParams.get("download");
  const filename = `${report.id}.pdf`;

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}

// Wrapped so a cold instance fetches the company state before looking: the
// instance serving this PDF is rarely the one that wrote the report.
export const GET = stateful(handleGET);
