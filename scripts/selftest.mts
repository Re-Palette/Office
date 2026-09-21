/**
 * Workflow self-test.
 *
 * Exercises the live agent layer end to end with a stubbed Claude transport:
 * the loop, real tool execution against real company state, delegation into a
 * sub-agent, the approval gate halting a run, report submission with a real
 * PDF, and resumption once the CEO decides.
 *
 * Run: npm run selftest
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.ANTHROPIC_API_KEY = "sk-ant-selftest";
process.env.FRIDAY_DATA_DIR = mkdtempSync(path.join(tmpdir(), "friday-selftest-"));

const { runAgent, resumeRun, __setClientForTesting } = await import("../src/server/agents/runner");
const { readState, mutate } = await import("../src/server/runtime/store");
const { renderReportPdf } = await import("../src/server/report-pdf");
const { getReport } = await import("../src/server/report-store");

type Block = Record<string, unknown>;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(` ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/** Canned turns, keyed by which agent the system prompt belongs to. */
const script: Record<string, Block[][]> = {
  COO: [
    [
      { type: "text", text: "承知しました。まず状況を確認します。" },
      { type: "tool_use", id: "t1", name: "log_progress", input: { message: "全社の状況を確認しています" } },
      { type: "tool_use", id: "t2", name: "get_company_data", input: { scope: "overview" } },
    ],
    [
      { type: "text", text: "調査はResearch Directorへ委譲します。" },
      {
        type: "tool_use",
        id: "t3",
        name: "delegate",
        input: { agentId: "research_director", objective: "美容業界の直近トレンドを3点にまとめて報告してください。" },
      },
    ],
    [
      { type: "text", text: "提携候補へメールを送る必要があります。承認を求めます。" },
      {
        type: "tool_use",
        id: "t4",
        name: "request_ceo_approval",
        input: {
          title: "提携候補2社へのメール送信",
          summary: "調査結果をもとに初回接触メールを送ります。",
          impact: "承認すると実在する企業へメールが送信されます。取り消せません。",
          risk: "high",
          priority: "urgent",
          kind: "email",
        },
      },
    ],
    // After the CEO approves:
    [{ type: "text", text: "送信しました。2社へ初回接触メールを送付済みです。" }],
  ],
  "Research Director": [
    [
      { type: "tool_use", id: "r1", name: "log_progress", input: { message: "市場トレンドを調査しています" } },
      { type: "tool_use", id: "r2", name: "search_knowledge", input: { query: "美容" } },
    ],
    [
      {
        type: "tool_use",
        id: "r3",
        name: "submit_report",
        input: {
          title: "美容業界トレンド — Research Report",
          type: "research",
          executiveSummary: "サステナビリティ関連セグメントが最も高い成長を示しています。",
          keyMetrics: [{ label: "Market Growth", value: "+4.2%", delta: "+0.4pt" }],
          findings: ["サステナ軸の成長率が全体を上回る", "競合A社に参入の兆候"],
          risks: [{ level: "medium", text: "競合A社の参入で先行優位が短縮する可能性" }],
          decisions: [],
          nextActions: ["A社の動きを週次で追跡する"],
        },
      },
    ],
    [{ type: "text", text: "トレンド3点をレポートにまとめ、提出しました。" }],
  ],
};

const cursor: Record<string, number> = {};

function roleFromSystem(system: unknown): string {
  const text = Array.isArray(system) ? String((system[0] as Block)?.text ?? "") : String(system ?? "");
  const match = text.match(/\[ROLE\] ([^—\n]+)/);
  return match ? match[1].trim() : "COO";
}

const stub = {
  messages: {
    stream(params: Record<string, unknown>) {
      const role = roleFromSystem(params.system);
      const turns = script[role] ?? [[{ type: "text", text: "（応答なし）" }]];
      const index = cursor[role] ?? 0;
      cursor[role] = index + 1;
      const content = turns[Math.min(index, turns.length - 1)];
      const hasToolUse = content.some((b) => b.type === "tool_use");

      return {
        async finalMessage() {
          return {
            content,
            stop_reason: hasToolUse ? "tool_use" : "end_turn",
            stop_details: null,
            usage: { input_tokens: 1200, output_tokens: 300 },
          };
        },
      };
    },
  },
} as never;

__setClientForTesting(stub);

console.log("\n=== Live agent workflow (stubbed transport) ===\n");

const result = await runAgent({
  agentId: "coo",
  objective: "美容業界のトレンドを調べて、提携候補へ接触してください。",
  canDelegate: true,
  canReport: true,
});

const state = readState();

check("COO run halts at the approval gate", result.status === "waiting_for_ceo", result.status);
check("approval was created", Boolean(result.approvalId));

const approval = state.approvals.find((a) => a.id === result.approvalId);
check("approval is pending and attributed", approval?.status === "pending" && approval?.requestedBy === "coo");
check("approval is marked urgent", approval?.priority === "urgent", approval?.priority);

check(
  "CEO was notified",
  state.notifications.some((n) => n.relatedApprovalId === result.approvalId && !n.read),
);

const subRun = state.runs.find((r) => r.agentId === "research_director");
check("delegation spawned a real sub-run", Boolean(subRun), subRun?.status);
check("sub-run completed", subRun?.status === "completed", subRun?.status);

const report = state.reports.find((r) => r.createdBy === "research_director");
check("delegate submitted a real report", Boolean(report), report?.title);
check("report is awaiting CEO review", report?.status === "PENDING_REVIEW");
check(
  "report content came from the agent",
  report?.content.findings.length === 2 && report.content.keyMetrics[0]?.value === "+4.2%",
);
check(
  "report structure was filled from real company state",
  (report?.content.departmentResults.length ?? 0) > 0 &&
    (report?.content.projectResults.length ?? 0) > 0,
);

check("report is registered for PDF rendering", Boolean(getReport(report!.id)));
const pdf = await renderReportPdf(report!);
check("report renders a real PDF", pdf.byteLength > 50_000, `${pdf.byteLength} bytes`);

check(
  "activity records the hand-off",
  state.activity.some((e) => e.kind === "agent.handoff" && e.targetAgentId === "research_director"),
);
check(
  "activity records agent progress",
  state.activity.some((e) => e.message.includes("全社の状況を確認")),
);
check("token usage was accumulated", state.usage.inputTokens > 0 && state.usage.outputTokens > 0);

// ── The CEO approves, and the blocked employee picks its work back up ───────
mutate((s) => {
  const target = s.approvals.find((a) => a.id === result.approvalId);
  if (target) {
    target.status = "approved";
    target.reviewedAt = Date.now();
    target.reviewedBy = "CEO";
  }
});

const resumed = await resumeRun(result.runId, "approved", "進めてください");
check("paused run resumes after approval", resumed?.status === "completed", resumed?.status);
check(
  "resumed run reports the completed action",
  Boolean(resumed?.text?.includes("送信")),
  resumed?.text?.slice(0, 40),
);

const after = readState();
check(
  "resumption is visible in the activity feed",
  after.activity.some((e) => e.message.includes("作業を再開")),
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);
