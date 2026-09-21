import { NextResponse } from "next/server";
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
export async function GET(
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
          "このレポートはサーバー側に登録されていません。ダッシュボードから再生成してください。",
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
