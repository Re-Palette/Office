/**
 * Workflow self-test.
 *
 * Exercises the live agent layer end to end with a stubbed Claude transport:
 * the loop, real tool execution against real company state, delegation into a
 * sub-agent, the approval gate halting a run, report submission with a real
 * PDF, resumption once the CEO decides, and the Gmail/Calendar integration —
 * including the guarantee that no mail reaches Google before approval.
 *
 * Run: npm run selftest
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.ANTHROPIC_API_KEY = "sk-ant-selftest";
// Pinned so the daily job is always past its hour: otherwise the scheduler
// checks report "not_due" whenever the suite happens to run before 17:00 JST.
process.env.NOTE_DAILY_DRAFT_AT = "00:00";
process.env.FRIDAY_DATA_DIR = mkdtempSync(path.join(tmpdir(), "friday-selftest-"));

const { runAgent, resumeRun, __setClientForTesting, describeBadRequest, buildSystem } =
  await import("../src/server/agents/runner");
const { __setGoogleClientForTesting, buildMime } = await import(
  "../src/server/integrations/google"
);
const { __setNoteClientForTesting, markdownToNoteHtml } = await import(
  "../src/server/integrations/note"
);
const { companyToolsFor } = await import("../src/server/agents/tools");
const { AGENTS } = await import("../src/lib/company/agents");
const { listDrafts, readDraftFile } = await import("../src/server/note-drafts");
const { runDailyNoteDraft } = await import("../src/server/scheduler");
const { readState, mutate, loadState, flushState, invalidate, storageStatus } = await import(
  "../src/server/runtime/store"
);
const { mergeState } = await import("../src/server/runtime/supabase-store");
const { diagnoseSupabase } = await import("../src/server/runtime/diagnose");
const { renderReportPdf } = await import("../src/server/report-pdf");
const { getReport } = await import("../src/server/report-store");

type Block = Record<string, unknown>;

/**
 * Google, stubbed. The point of the gate is that the model cannot reach this
 * — so the stub records every call, and the test asserts nothing arrives here
 * until the CEO has approved.
 */
const google = {
  sent: [] as { to: string[]; subject: string; body: string }[],
  events: [] as { summary: string; attendees: string[] }[],
  searches: [] as string[],
};

__setGoogleClientForTesting({
  async searchEmail(query: string) {
    google.searches.push(query);
    return [
      {
        id: "m1",
        threadId: "th1",
        from: "partner@example.com",
        to: "ceo@re-palette.test",
        subject: "提携のご相談",
        date: "Mon, 21 Sep 2026 09:12:00 +0900",
        snippet: "先日はありがとうございました。条件についてご相談があります。",
        unread: true,
      },
    ];
  },
  async sendEmail(input) {
    google.sent.push({ to: input.to, subject: input.subject, body: input.body });
    return { id: "sent-1", threadId: "th1", to: input.to, subject: input.subject };
  },
  async listEvents() {
    return [
      {
        id: "e1",
        summary: "役員定例",
        start: "2026-09-22T10:00:00+09:00",
        end: "2026-09-22T11:00:00+09:00",
        attendees: [],
        status: "confirmed",
      },
    ];
  },
  async createEvent(input) {
    google.events.push({ summary: input.summary, attendees: input.attendees ?? [] });
    return {
      id: "ev-1",
      summary: input.summary,
      start: input.start,
      end: input.end,
      attendees: input.attendees ?? [],
      status: "confirmed",
    };
  },
});

/**
 * note, stubbed. A draft is private, so it may be created before approval;
 * publishing must not happen until the CEO has decided.
 */
const note = {
  drafts: [] as { id: string; title: string; body: string }[],
  published: [] as { id: string; title: string; tags: string[] }[],
};

__setNoteClientForTesting({
  async verify() {
    return { id: "1", urlname: "re_palette", nickname: "Re-Palette" };
  },
  async createDraft(input) {
    const id = `d${note.drafts.length + 1}`;
    note.drafts.push({ id, title: input.title, body: input.body });
    return { id, key: `n${id}`, title: input.title, editUrl: `https://note.com/notes/n${id}/edit` };
  },
  async publish(id, input) {
    note.published.push({ id, title: input.title, tags: input.tags ?? [] });
    return {
      id,
      key: `n${id}`,
      title: input.title,
      editUrl: `https://note.com/notes/n${id}/edit`,
      url: `https://note.com/re_palette/n/n${id}`,
      publishedAt: new Date().toISOString(),
    };
  },
});

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
  "Content AI": [
    [
      { type: "tool_use", id: "c1", name: "search_knowledge", input: { query: "ブランド" } },
    ],
    [
      { type: "text", text: "note記事の原稿ができました。公開の承認をお願いします。" },
      {
        type: "tool_use",
        id: "c2",
        name: "write_note_article",
        input: {
          title: "AIだけの会社を、ひとりで経営するということ",
          body: [
            "## はじめに",
            "",
            "Re-Palette では、48名のAI社員が8つの部署に分かれて働いています。",
            "人間の社員はひとり、CEOの陽大だけです。",
            "",
            "## なぜこの形にしたのか",
            "",
            "- 判断の速さを落とさずに、実行だけを増やしたかった",
            "- **最終決定は必ず人間が行う**という原則を崩したくなかった",
            "- 外部に出るものは、すべて目を通してから出したかった",
            "",
            "> 自動化したいのは実行であって、意思決定ではない。",
            "",
            "この3つを満たす形を探した結果が、いまの構成です。",
            "詳しくは [Re-Palette](https://example.com) を見てください。",
          ].join("\n"),
          tags: ["AI", "経営", "スタートアップ"],
          reason: "会社の考え方を対外的に共有し、採用と提携の入口にします。",
        },
      },
    ],
    [{ type: "text", text: "記事を公開しました。" }],
  ],
  "Executive Assistant": [
    [
      { type: "tool_use", id: "e1", name: "read_email", input: { query: "is:unread newer_than:7d" } },
      {
        type: "tool_use",
        id: "e2",
        name: "list_calendar_events",
        input: { from: "2026-09-22T00:00:00+09:00", to: "2026-09-23T00:00:00+09:00" },
      },
    ],
    [
      { type: "text", text: "返信の文面を用意しました。送信の承認をお願いします。" },
      {
        type: "tool_use",
        id: "e3",
        name: "send_email",
        input: {
          to: ["partner@example.com"],
          subject: "Re: 提携のご相談",
          body: "ご連絡ありがとうございます。\n9月22日の午後であれば対応可能です。\n\nRe-Palette 陽大",
          inReplyToMessageId: "m1",
          reason: "提携候補からの問い合わせに返信し、日程を提示します。",
        },
      },
    ],
    [{ type: "text", text: "返信を送付し、先方へ日程を提示しました。" }],
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

// ── Gmail and Calendar: the employee reads freely and cannot send ──────────
console.log("\n=== Google integration (stubbed Gmail / Calendar) ===\n");

check(
  "MIME encodes a Japanese subject",
  buildMime(
    { to: ["a@example.com"], subject: "提携のご相談", body: "本文" },
    "Re-Palette <ceo@example.com>",
  ).includes("Subject: =?UTF-8?B?"),
);
// A newline smuggled into a recipient must stay inside the To value rather
// than starting a header line of its own.
check(
  "MIME refuses a forged header",
  !buildMime(
    { to: ["a@example.com\r\nBcc: attacker@example.com"], subject: "x", body: "y" },
    "me",
  )
    .split("\r\n")
    .some((line) => /^bcc:/i.test(line)),
);

const assistant = await runAgent({
  agentId: "chief_of_staff",
  objective: "未読メールを確認し、必要なら返信してください。",
  canDelegate: false,
  canReport: false,
});

check("assistant halted at the send gate", assistant.status === "waiting_for_ceo", assistant.status);
check("nothing was sent before approval", google.sent.length === 0, `${google.sent.length} sent`);
check("the inbox was actually read", google.searches.length === 1, google.searches[0]);

const sendApproval = readState().approvals.find((a) => a.id === assistant.approvalId);
check("send raised an email approval", sendApproval?.kind === "email", sendApproval?.kind);
check(
  "the CEO sees the exact text that would go out",
  sendApproval?.payload?.find((p) => p.label === "Body")?.value.includes("9月22日の午後") ?? false,
);
check(
  "the queued action is held on the run, not in the transcript",
  readState().runs.find((r) => r.id === assistant.runId)?.pendingAction?.tool === "send_email",
);

const delivered = await resumeRun(assistant.runId, "approved", "この内容で送ってください");

check("the server sent it once the CEO approved", google.sent.length === 1);
check(
  "what was sent is what was approved",
  google.sent[0]?.to[0] === "partner@example.com" &&
    google.sent[0]?.body.includes("9月22日の午後"),
);
check("the assistant finished after the send", delivered?.status === "completed", delivered?.status);
check(
  "the send is on the record",
  readState().activity.some((e) => e.message.includes("承認を受けてメールを送信")),
);

// A rejected request must leave nothing behind.
const second = await runAgent({
  agentId: "chief_of_staff",
  objective: "先方へもう一通送ってください。",
  canDelegate: false,
  canReport: false,
});
await resumeRun(second.runId, "rejected", "今回は送らないでください");
check("a rejected send never reaches Google", google.sent.length === 1, `${google.sent.length} sent`);

// ── note: a draft may exist before approval, a published article may not ───
console.log("\n=== note (stubbed) ===\n");

const html = markdownToNoteHtml(
  "## 見出し\n\n本文です。**強調**と[リンク](https://example.com)。\n\n- 一つ目\n- 二つ目\n\n> 引用",
);
check("Markdown becomes note's HTML subset", html.includes("<h2>見出し</h2>"), html.slice(0, 40));
check("lists survive the conversion", html.includes("<ul><li>一つ目</li><li>二つ目</li></ul>"));
check("links and emphasis survive", html.includes('<a href="https://example.com">リンク</a>'));
check("quotes survive", html.includes("<blockquote>引用</blockquote>"));
check("nothing leaks as raw Markdown", !html.includes("**") && !html.includes("## "));

// ── The default: the article becomes a document, and nothing touches note ──
const writer = await runAgent({
  agentId: "content_ai",
  objective: "会社の考え方を note の記事にしてください。",
  canDelegate: false,
  canReport: false,
});

check("the writer finishes without a gate", writer.status === "completed", writer.status);
check("nothing reached note at all", note.drafts.length === 0 && note.published.length === 0);

const saved = listDrafts()[0];
check("the article was saved as a draft", Boolean(saved), saved?.title);
check("it is waiting to be posted", saved?.status === "READY");
check("the author is recorded", saved?.createdBy === "content_ai");
check("tags came through", saved?.tags.length === 3);
check("the file is named by its JST day", /^\d{4}-\d{2}-\d{2}-/.test(saved?.file ?? ""), saved?.file);

const fileText = readDraftFile(saved!);
check("the file leads with the title, ready to paste", fileText.startsWith(`# ${saved!.title}`));
check("the body is in the file verbatim", fileText.includes("意思決定ではない"));
check("the tags line is in the file", fileText.includes("#AI"));

check(
  "the CEO is told an article is waiting",
  readState().notifications.some((n) => n.href === `/note/${saved!.id}` && !n.read),
);

// Writing the same title again on the same day refreshes it rather than piling up.
cursor["Content AI"] = 0;
await runAgent({
  agentId: "content_ai",
  objective: "同じ記事を書き直してください。",
  canDelegate: false,
  canReport: false,
});
check("rewriting the same day's article updates it", listDrafts().length === 1, `${listDrafts().length}`);

// ── The daily job ──────────────────────────────────────────────────────────
cursor["Content AI"] = 0;
const job = await runDailyNoteDraft(true);
check("the daily job writes an article", job.status === "ran", `${job.status}: ${job.detail}`);
check("the job is recorded so it cannot run twice", readState().jobs.some((j) => j.id === "note-daily-draft" && j.ok));

const repeat = await runDailyNoteDraft();
check("a second run the same day is a no-op", repeat.status === "skipped", repeat.status);

// ── Opting in to note's own endpoints ──────────────────────────────────────
process.env.NOTE_OUTPUT = "publish";
process.env.NOTE_AUTH_TOKEN = "selftest-cookie";
cursor["Content AI"] = 0;

const viaApi = await runAgent({
  agentId: "content_ai",
  objective: "note に直接下書きを作ってください。",
  canDelegate: false,
  canReport: false,
});

check("with NOTE_OUTPUT set, the run halts for approval", viaApi.status === "waiting_for_ceo", viaApi.status);
check("a private draft was saved to note", note.drafts.length === 1);
check("nothing was published before approval", note.published.length === 0);

const articleApproval = readState().approvals.find((a) => a.id === viaApi.approvalId);
check(
  "the CEO gets the draft link to preview on note",
  articleApproval?.payload?.some((p) => p.label === "note draft" && p.value.includes("/edit")) ??
    false,
);
check(
  "the CEO sees the whole article, not a summary",
  articleApproval?.payload?.find((p) => p.label === "Body")?.value.includes("意思決定ではない") ??
    false,
);

const published = await resumeRun(viaApi.runId, "approved", "公開してください");
check("the server published it after approval", note.published.length === 1);
check("tags went out with it", note.published[0]?.tags.length === 3);
check(
  "the publish is on the record",
  Boolean(published?.text) && readState().activity.some((e) => e.message.includes("note に公開")),
);

// A rejected article stays a draft — never published, never deleted.
cursor["Content AI"] = 0;
const spiked = await runAgent({
  agentId: "content_ai",
  objective: "もう一本書いてください。",
  canDelegate: false,
  canReport: false,
});
await resumeRun(spiked.runId, "rejected", "今回は出しません");
check("a rejected article is never published", note.published.length === 1);
check("but its draft is kept on note", note.drafts.length === 2);

delete process.env.NOTE_OUTPUT;
delete process.env.NOTE_AUTH_TOKEN;

// ── Supabase: the merge that stops a losing write from eating work ─────────
console.log("\n=== Supabase state store ===\n");

const base = readState();
// Later than anything the earlier scenarios wrote, so ordering is testable.
const t0 = Date.now() + 60_000;

/** Two instances that each added something while the other was working. */
const theirs = structuredClone(base);
theirs.activity = [
  { id: "act-theirs", kind: "agent.started", agentId: "coo", at: t0, message: "向こうの作業" },
  ...theirs.activity,
];
theirs.usage = { inputTokens: 900, outputTokens: 80, runs: 3 };

const ours = structuredClone(base);
ours.activity = [
  { id: "act-ours", kind: "agent.started", agentId: "cto", at: t0 + 1000, message: "こちらの作業" },
  ...ours.activity,
];
ours.noteDrafts = [
  {
    id: "nd-ours",
    title: "こちらが書いた記事",
    body: "本文",
    tags: [],
    rationale: "",
    createdBy: "content_ai",
    createdAt: t0,
    updatedAt: t0,
    status: "READY" as const,
    file: "2026-09-22-x.md",
  },
];
ours.usage = { inputTokens: 500, outputTokens: 120, runs: 2 };

const merged = mergeState(theirs, ours);

check(
  "a merge keeps both sides' activity",
  merged.activity.some((e) => e.id === "act-theirs") &&
    merged.activity.some((e) => e.id === "act-ours"),
);
check("newest activity stays first", merged.activity[0]?.id === "act-ours", merged.activity[0]?.id);
check(
  "the article written during the conflict survives",
  merged.noteDrafts.some((d) => d.id === "nd-ours"),
);
check(
  "counters take the higher reading rather than regressing",
  merged.usage.inputTokens === 900 && merged.usage.outputTokens === 120 && merged.usage.runs === 3,
  JSON.stringify(merged.usage),
);
check("nothing is duplicated", new Set(merged.activity.map((e) => e.id)).size === merged.activity.length);

// A finished job must beat one still marked in flight, whoever wrote it.
const withJobs = mergeState(
  { ...theirs, jobs: [{ id: "note-daily-draft", ranFor: "2026-09-22", at: 10, ok: false, detail: "実行中" }] },
  { ...ours, jobs: [{ id: "note-daily-draft", ranFor: "2026-09-22", at: 20, ok: true, detail: "完了" }] },
);
check(
  "a completed job wins over one still in flight",
  withJobs.jobs.length === 1 && withJobs.jobs[0].ok,
  JSON.stringify(withJobs.jobs),
);

// The employee seen most recently is the truer picture.
const withAgents = mergeState(
  { ...theirs, agents: { coo: { status: "idle" as const, lastActiveAt: 500, tasksCompleted: 1 } } },
  { ...ours, agents: { coo: { status: "working" as const, lastActiveAt: 900, tasksCompleted: 2 } } },
);
check(
  "the more recent view of an employee wins",
  withAgents.agents.coo.status === "working" && withAgents.agents.coo.tasksCompleted === 2,
);

// ── The real client, against a stand-in for PostgREST ──────────────────────
//
// The merge above is pure logic. This exercises the code that actually talks
// to Supabase — the URLs, the headers, the version check — by pointing it at a
// server that answers the way PostgREST does.
console.log("\n=== Supabase round trip (stubbed PostgREST) ===\n");

const { createServer } = await import("node:http");

let row: { version: number; state: Record<string, unknown> } | null = null;
let sawServiceKey = false;

const pg = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  sawServiceKey = req.headers.authorization === "Bearer service-key-for-test";

  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const readBody = async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };

  if (req.method === "GET") {
    return send(200, row ? [{ state: row.state, version: row.version }] : []);
  }

  if (req.method === "POST") {
    return void readBody().then((body) => {
      if (row) return send(201, []); // resolution=ignore-duplicates
      row = { version: 1, state: body.state };
      send(201, [{ version: 1 }]);
    });
  }

  if (req.method === "PATCH") {
    return void readBody().then((body) => {
      // PostgREST filters on version=eq.N; a stale writer matches no rows.
      const expected = Number(url.searchParams.get("version")?.replace("eq.", ""));
      if (!row || row.version !== expected) return send(200, []);
      row = { version: body.version, state: body.state };
      send(200, [{ version: row.version }]);
    });
  }

  send(405, {});
});

await new Promise<void>((resolve) => pg.listen(0, "127.0.0.1", resolve));
const port = (pg.address() as { port: number }).port;

process.env.SUPABASE_URL = `http://127.0.0.1:${port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key-for-test";

invalidate();
const first = await loadState();
check("an empty database gets seeded", Boolean(row), `version ${row?.version}`);
check("the service role key is sent", sawServiceKey);
check("the seed has the company in it", first.tasks.length > 0);

mutate((st) => {
  st.noteDrafts = [
    {
      id: "nd-supabase",
      title: "Supabase に保存される記事",
      body: "本文",
      tags: ["test"],
      rationale: "",
      createdBy: "content_ai",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "READY" as const,
      file: "2026-09-22-supabase.md",
    },
  ];
});
await flushState();

check("a change reaches the database", row!.version > 1, `version ${row?.version}`);

// A cold start: nothing in memory, everything from the row.
invalidate();
const reloaded = await loadState();
check(
  "it comes back on a fresh instance",
  reloaded.noteDrafts.some((d) => d.id === "nd-supabase"),
  `${reloaded.noteDrafts.length} draft(s)`,
);

// A read must not cost a write, or polling would fight the nightly job.
const versionBeforeRead = row!.version;
listDrafts();
await flushState();
check("reading does not bump the version", row!.version === versionBeforeRead, `${row?.version}`);

// Another instance writes while we hold a stale copy: nothing may be lost.
mutate((st) => {
  st.activity = [
    { id: "act-local", kind: "agent.started", agentId: "cto", at: Date.now(), message: "こちらの追記" },
    ...st.activity,
  ];
});
row = {
  version: row!.version + 1,
  state: {
    ...(row!.state as Record<string, unknown>),
    activity: [
      { id: "act-remote", kind: "agent.started", agentId: "coo", at: Date.now(), message: "別インスタンスの追記" },
      ...((row!.state as { activity: unknown[] }).activity ?? []),
    ],
  },
};
await flushState();

const settled = (row!.state as { activity: { id: string }[] }).activity;
check(
  "a conflicting write keeps both sides",
  settled.some((e) => e.id === "act-local") && settled.some((e) => e.id === "act-remote"),
  `${settled.length} events`,
);

check("a working database reports healthy", storageStatus().healthy, storageStatus().backend);

// A bad key must be visible, not silently fall back to memory and look fine.
pg.close();
invalidate();
await loadState();
const broken = storageStatus();
check(
  "an unreachable database reports unhealthy",
  broken.backend === "supabase" && !broken.healthy && Boolean(broken.error),
  broken.error?.slice(0, 50),
);
check("the company still runs on the fallback", readState().tasks.length > 0);

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
invalidate();
check("with no database configured it reports the file backend", storageStatus().backend === "file");

// The two mistakes this setup actually invites, caught from the settings
// themselves rather than from a failed request.
const misconfigurations: [string, string, string][] = [
  ["dashboard URL", "https://supabase.com/dashboard/project/abc", "sb_secret_x", ],
  ["URL with a path", "https://abc.supabase.co/rest/v1", "sb_secret_x"],
  ["publishable key", "https://abc.supabase.co", "sb_publishable_x"],
  ["http to a public host", "http://abc.supabase.co", "sb_secret_x"],
];

for (const [label, url, key] of misconfigurations) {
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  invalidate();
  const status = storageStatus();
  check(`a ${label} is reported, not silently retried`, !status.healthy && Boolean(status.error), status.error?.slice(0, 44));
}

process.env.SUPABASE_URL = "https://abc.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_looks_right";
invalidate();
check("settings that look right are not flagged", storageStatus().error === null, storageStatus().error ?? "");

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
invalidate();

// ── The tool payload the API actually receives ─────────────────────────────
//
// `strict: true` compiles every schema into a grammar against a complexity
// ceiling the whole request shares. Eight tools crossed it and the API
// answered "Schema is too complex" — every AI employee stopped working. This
// asserts the shape stays inside what the API accepts, for every employee,
// because the failure is invisible until a real request is made.
console.log("\n=== Tool payload ===\n");

let strictTools = 0;
let badSchemas = 0;
let widest = { agent: "", count: 0 };

for (const agent of AGENTS) {
  const tools = companyToolsFor({
    agentId: agent.id,
    canDelegate: agent.seniority === "executive",
    canReport: true,
  });

  const names = tools.map((t) => t.name);
  if (new Set(names).size !== names.length) {
    badSchemas += 1;
    console.log(`  duplicate tool name for ${agent.id}: ${names.join(", ")}`);
  }
  if (tools.length > widest.count) widest = { agent: agent.role, count: tools.length };

  for (const tool of tools) {
    if ((tool as unknown as Record<string, unknown>).strict === true) strictTools += 1;

    // Every object still declares additionalProperties:false and required —
    // the schemas are what tell the model what to send, so they stay correct
    // even though nothing compiles them any more.
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "object" || n.properties) {
        if (n.additionalProperties !== false || !Array.isArray(n.required)) {
          badSchemas += 1;
          console.log(`  ${tool.name} ${path}: malformed object schema`);
        }
      }
      for (const [k, v] of Object.entries((n.properties ?? {}) as Record<string, unknown>)) {
        walk(v, `${path}.${k}`);
      }
      if (n.items) walk(n.items, `${path}[]`);
    };
    walk(tool.input_schema, tool.name);
  }
}

check("no tool asks for strict schema compilation", strictTools === 0, `${strictTools} found`);
check("every tool schema is well formed", badSchemas === 0, `${badSchemas} problems`);
// Not an API limit — without strict there is none. This is the "too many
// tools confuses the model" guidance, and a tripwire if an integration ever
// starts handing everyone everything.
check(
  "no employee is handed an unfocused tool set",
  widest.count <= 16,
  `${widest.agent}: ${widest.count} tools`,
);

// ── The setup check ────────────────────────────────────────────────────────
//
// Its whole job is telling apart failures that look the same from outside: a
// key arriving as `anon` reads an empty table without error, exactly like a
// table that is simply empty. Each case gets a server that behaves that way.
console.log("\n=== Setup check ===\n");

async function diagnoseAgainst(
  handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void,
  key = "sb_secret_test",
) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const p = (server.address() as { port: number }).port;
  process.env.SUPABASE_URL = `http://127.0.0.1:${p}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  try {
    return await diagnoseSupabase();
  } finally {
    server.close();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
}

const send = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

// A healthy service_role key.
const healthy = await diagnoseAgainst((req, res) => {
  if (req.url?.includes("friday_whoami")) {
    return send(res, 200, { current_user: "service_role", bypasses_rls: true });
  }
  if (req.method === "GET") return send(res, 200, []);
  if (req.method === "POST") return send(res, 201, [{ version: 0 }]);
  return send(res, 200, []);
});
check("a working setup reports success", healthy.verdict.includes("正常"), healthy.verdict);
check("the key is never echoed", !JSON.stringify(healthy).includes("sb_secret_test"));
check("only the host is reported", healthy.host?.startsWith("127.0.0.1") ?? false, healthy.host ?? "");

// The case nothing else distinguishes: reads fine, but as the wrong role.
const wrongRole = await diagnoseAgainst((req, res) => {
  if (req.url?.includes("friday_whoami")) {
    return send(res, 200, { current_user: "anon", bypasses_rls: false });
  }
  return send(res, 200, []);
});
check(
  "a key arriving as anon is named, not read as an empty table",
  wrongRole.verdict.includes("anon") && wrongRole.verdict.includes("service_role"),
  wrongRole.verdict.slice(0, 60),
);

// Same thing where the probe function is absent: the write settles it.
const rlsRefusal = await diagnoseAgainst((req, res) => {
  if (req.url?.includes("friday_whoami")) return send(res, 404, {});
  if (req.method === "GET") return send(res, 200, []);
  return send(res, 403, {
    code: "42501",
    message: 'new row violates row-level security policy for table "work_state"',
  });
});
check(
  "an RLS refusal on write is explained",
  rlsRefusal.verdict.includes("行レベルセキュリティ"),
  rlsRefusal.verdict.slice(0, 60),
);

// A rejected key.
const badKey = await diagnoseAgainst((_req, res) => send(res, 401, { message: "Invalid API key" }));
check("a rejected key is reported as such", badKey.verdict.includes("401"), badKey.verdict.slice(0, 50));

// A missing table — the migration went to a different project.
const noTable = await diagnoseAgainst((_req, res) =>
  send(res, 404, { message: 'relation "public.work_state" does not exist' }),
);
check("a missing table is reported as such", noTable.verdict.includes("テーブル"), noTable.verdict.slice(0, 50));

// A publishable key never gets as far as a request.
const publishable = await diagnoseAgainst(
  (_req, res) => send(res, 200, []),
  "sb_publishable_wrong",
);
check(
  "a publishable key is caught before any request",
  publishable.probes.length === 0 && publishable.verdict.includes("Secret keys"),
  publishable.verdict.slice(0, 50),
);

// A value that is not an API key at all — the case actually hit in setup.
// It must be named by shape rather than sent and rejected with a bare 401.
const notAKey = await diagnoseAgainst(
  (_req, res) => send(res, 401, { message: "Invalid API key" }),
  "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo=",
);
check(
  "a value that is not a key is named, not just rejected",
  notAKey.probes.length === 0 && notAKey.verdict.includes("形式ではありません"),
  notAKey.verdict.slice(0, 50),
);
check("its shape is described without revealing it", notAKey.keyShape.length === 44);
check(
  "the value itself is never echoed",
  !JSON.stringify(notAKey).includes("Zm9vYmFy"),
);

// Quotes and a NAME= prefix survive a copy-paste; both are stripped.
process.env.SUPABASE_URL = "https://abc.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = '"sb_secret_quoted"';
invalidate();
check("surrounding quotes are stripped", storageStatus().error === null, storageStatus().error ?? "");

process.env.SUPABASE_SERVICE_ROLE_KEY = "SUPABASE_SERVICE_ROLE_KEY=sb_secret_pasted_whole";
invalidate();
check("a pasted .env line is stripped", storageStatus().error === null, storageStatus().error ?? "");

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
invalidate();

// ── What a failed API call tells the CEO ───────────────────────────────────
//
// A 400 covers both a request this code built wrong and an account that
// cannot be billed. They need opposite responses, so they must not read the
// same. Both messages were hit for real during setup.
console.log("\n=== API errors ===\n");

// Exactly what the SDK puts in error.message: the status and the JSON body.
const billing = describeBadRequest(
  '400 {"type":"error","error":{"type":"invalid_request_error","message":' +
    '"Your credit balance is too low to access the Anthropic API. ' +
    'Please go to Plans & Billing to upgrade or purchase credits."}}',
);
check("a billing failure says so, not 400", billing.includes("クレジット残高"), billing.slice(0, 32));
check("and points at where to fix it", billing.includes("Plans & Billing"));
check("without dumping JSON at the CEO", !billing.includes("invalid_request_error"));

const schema = describeBadRequest(
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"Schema is too complex."}}',
);
check(
  "a malformed request is owned as ours",
  schema.includes("実装側の問題") && schema.includes("Schema is too complex"),
  schema.slice(0, 40),
);

const model = describeBadRequest("400 model: claude-nonexistent does not exist");
check("an unavailable model names the way out", model.includes("FRIDAY_MODEL"), model.slice(0, 40));

const other = describeBadRequest("400 something unforeseen");
check("anything else keeps its detail", other.includes("something unforeseen"), other.slice(0, 40));

// ── What every employee is told about its own company ──────────────────────
//
// Agents used to be given a job and a department but never the company's
// name, so anything written about ARQO itself was invented. The brief rides
// in the cached system prompt, which means a leak here reaches all 48.
console.log("\n=== Company identity ===\n");

const brief = buildSystem("content_ai", false, false);
check("every employee is told the company name", brief.includes("ARQO Inc."));
check("and the mission verbatim", brief.includes("人と可能性の間に架け橋をつくる。"));
check("and all four businesses", ["Re-Palette", "Education", "Community & Events", "AI & Technology"].every((b) => brief.includes(b)));
check("and is told not to invent the rest", brief.includes("推測で書かない"));
check(
  "the homepage's placeholder contact never reaches an employee",
  !brief.includes("example.com"),
);
check(
  "the homepage's dummy news never reaches an employee",
  !brief.includes("Nuance Lounge"),
);

const exec = buildSystem("coo", true, true);
check("an executive gets the same brief", exec.includes("ミッション: 人と可能性の間に架け橋をつくる。"));

// ── NEWTONE 2027 ───────────────────────────────────────────────────────────
//
// The project is two-sided: brands on one side, visitors on the other. A task
// list that only covers the visitor half is the failure mode, so the shape of
// the seed is asserted rather than just its presence.
console.log("\n=== NEWTONE 2027 ===\n");

const { PROJECTS_BY_ID } = await import("../src/lib/company/projects");
const { TASKS, TASKS_BY_ID } = await import("../src/lib/company/tasks");
const { KNOWLEDGE } = await import("../src/lib/company/knowledge");

const newtone = PROJECTS_BY_ID["newtone"];
const newtoneTasks = TASKS.filter((t) => t.project === "newtone");

check("the project exists with an owner", newtone?.owner === "coo", newtone?.owner ?? "missing");
check("it is staffed across more than one department", newtone.departments.length >= 5, String(newtone.departments.length));
check("every assigned agent is on the project roster", newtoneTasks.every((t) => newtone.agents.includes(t.assignedAgent)), newtoneTasks.filter((t) => !newtone.agents.includes(t.assignedAgent)).map((t) => `${t.id}:${t.assignedAgent}`).join(",") || "ok");
check("it carries real work, not one placeholder", newtoneTasks.length >= 12, String(newtoneTasks.length));

// Brand recruitment is the lead indicator; without it there is nothing to sell.
check("someone is finding the brands", newtoneTasks.some((t) => t.assignedAgent === "lead_ai"));
check("someone owns the legal display check", newtoneTasks.some((t) => t.assignedAgent === "risk_ai"));
check("someone owns retail operations", newtoneTasks.some((t) => t.assignedAgent === "ops_strategy"));
check("and someone owns visitor turnout", newtoneTasks.some((t) => t.assignedAgent === "social_ai"));

// Approaching outside brands is an irreversible external send.
const outreach = TASKS_BY_ID["t-9002"];
check("brand outreach cannot be sent without the CEO", outreach.status === "WAITING_FOR_CEO", outreach.status);
check("and says why it is held", Boolean(outreach.blockedReason && outreach.approvalId), outreach.blockedReason ?? "none");

check(
  "the measured Nuance Lounge result is available to employees",
  KNOWLEDGE.some((d) => d.excerpt.includes("4.6") && d.excerpt.includes("4.4")),
);
check(
  "Re-Palette is no longer described as a sustainability brand",
  !PROJECTS_BY_ID["re_palette"].summary.includes("循環") &&
    PROJECTS_BY_ID["re_palette"].summary.includes("美容福祉"),
  PROJECTS_BY_ID["re_palette"].summary.slice(0, 30),
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);
