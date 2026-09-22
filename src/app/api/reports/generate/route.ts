import { NextResponse } from "next/server";
import { stateful } from "@/server/runtime/stateful";
import { REPORT_TYPE_LABEL, type ReportType } from "@/lib/types";
import { PROJECTS_BY_ID } from "@/lib/company/projects";
import { DEPARTMENTS } from "@/lib/company/departments";
import { getConfig } from "@/server/runtime/config";
import { runAgent } from "@/server/agents/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel caps this per plan (300s on Hobby). Long agent runs stream their
// progress into the activity feed, so a cut-off loses the tail, not the work.
export const maxDuration = 300;

const AUTHOR: Record<string, string> = {
  daily: "coo",
  weekly: "coo",
  executive: "coo",
  project: "coo",
  department: "coo",
  research: "research_director",
  task_completion: "chief_of_staff",
};

/**
 * POST /api/reports/generate — an AI employee writes a real report.
 *
 * The author reads the company's actual state through its tools, then submits
 * via `submit_report`, which stores it, renders the PDF and files it for review.
 */
async function handlePOST(request: Request) {
  const cfg = getConfig();
  if (cfg.mode === "demo") {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let body: { type?: ReportType; projectId?: string; departmentId?: string; wait?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const type = (body.type ?? "daily") as ReportType;
  if (!REPORT_TYPE_LABEL[type]) {
    return NextResponse.json({ error: `Unknown report type "${type}"` }, { status: 422 });
  }

  const scope = body.projectId
    ? `対象プロジェクト: ${PROJECTS_BY_ID[body.projectId]?.name ?? body.projectId}（id: ${body.projectId}）`
    : body.departmentId
      ? `対象部署: ${DEPARTMENTS.find((d) => d.id === body.departmentId)?.name ?? body.departmentId}（id: ${body.departmentId}）`
      : "対象: 全社";

  const objective = [
    `${REPORT_TYPE_LABEL[type]}を作成してください。`,
    scope,
    "",
    "手順:",
    "1. get_company_data で対象範囲のタスク・プロジェクト・部署・分析データを実際に読む。",
    "2. search_knowledge で関連する社内の記録を確認する。",
    "3. 読んだデータだけを根拠に、結論から書く。数値は必ず読み取った値を使う。",
    "4. submit_report で提出する。",
    "",
    "数値を推測してはいけません。読めなかった項目は、その旨を書いてください。",
  ].join("\n");

  const options = {
    agentId: AUTHOR[type] ?? "coo",
    objective,
    canDelegate: false,
    canReport: true,
    ...(body.projectId ? {} : {}),
  };

  if (body.wait) {
    const result = await runAgent(options);
    return NextResponse.json(result);
  }

  const started = runAgent(options);
  started.catch((error) => console.error("[friday] report run failed:", error));

  return NextResponse.json({ status: "started", agentId: options.agentId });
}

export const POST = stateful(handlePOST);
