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

process.env.GEMINI_API_KEY = "AIza-selftest";
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
const { AGENTS, AGENTS_BY_ID, EXECUTIVE_IDS } = await import("../src/lib/company/agents");
const { listDrafts, readDraftFile } = await import("../src/server/note-drafts");
const {
  jobs,
  parseBoardSection,
  parseMinutes,
  runDailyNoteDraft,
  runDailyReport,
  runDueJobs,
  runMorningBriefing,
  runWeeklyBoard,
  schedule: scheduleNow,
  validateSchedule,
} = await import("../src/server/scheduler");
const { readState, mutate, loadState, flushState, invalidate, storageStatus } = await import(
  "../src/server/runtime/store"
);
const { mergeState } = await import("../src/server/runtime/supabase-store");
const { diagnoseSupabase } = await import("../src/server/runtime/diagnose");
const {
  __clearSubstitutionsForTesting,
  createGeminiProvider,
  describeGeminiError,
  parseRetryDelay,
  foldChunks,
  modelSubstitutions,
  parseModelId,
  pickModel,
  toGeminiContents,
  toGeminiSchema,
} = await import("../src/lib/ai/gemini");
const { checkFetchUrl, htmlToText } = await import("../src/lib/ai/server-tools");
const { createAnthropicProvider, toAnthropicMessages } = await import("../src/lib/ai/anthropic");
const { createOpenAiProvider, fromCompletion, toOpenAiMessages } = await import(
  "../src/lib/ai/openai"
);
const { getConfig } = await import("../src/server/runtime/config");
const { ProviderError } = await import("../src/lib/ai/types");
const { markExhausted, notePerMinuteLimit, pacificDay, quota, quotaVerdict, reserve, reserveWithWait } =
  await import("../src/lib/ai/budget");
const { chainGuard, workRemaining } = await import("../src/server/runtime/tick");
const { advanceWork, autonomySettings, autonomyStatus, pickTasks } = await import(
  "../src/server/autonomy"
);
const { renderReportPdf } = await import("../src/server/report-pdf");
const { __clearRuntimeForTesting, getReport, putReport } = await import(
  "../src/server/report-store"
);
const { processSegment, uid } = await import("../src/server/runtime/uid");
const { agentTokenSource, authorise } = await import("../src/server/vp/auth");
const { VP_TOOLS, toolsFor } = await import("../src/server/vp/tools");
const { SEED_REPORTS } = await import("../src/lib/company/report-seed");

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
  // The scheduled jobs run the COO alone, with no delegation: it reads the
  // company and files a report. Keyed separately because the same role
  // behaves differently depending on what it is handed.
  "COO (solo)": [
    [
      { type: "tool_use", id: "b1", name: "log_progress", input: { message: "会社の状況を確認しています" } },
      { type: "tool_use", id: "b2", name: "get_company_data", input: { scope: "overview" } },
    ],
    [
      {
        type: "tool_use",
        id: "b3",
        name: "submit_report",
        input: {
          title: "朝のブリーフィング — 2026-10-03",
          type: "daily",
          executiveSummary: "CEOの承認待ちが3件、期限が迫っているタスクが2件あります。",
          keyMetrics: [{ label: "承認待ち", value: "3件" }],
          findings: ["NEWTONEの出展募集が未着手", "認証基盤は80%で停滞"],
          risks: [{ level: "medium", text: "出展確保の遅れが集客計画を止める" }],
          decisions: [],
          nextActions: ["出展ブランドへの初回接触を承認する"],
        },
      },
    ],
    [{ type: "text", text: "ブリーフィングを提出しました。" }],
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

function roleFromSystem(system: string): string {
  const match = system.match(/\[ROLE\] ([^—\n]+)/);
  return match ? match[1].trim() : "COO";
}

/**
 * The scripted model, in the provider's own shape.
 *
 * It implements the same interface Gemini does, so everything between the
 * route and the tool — the loop, the gate, delegation, resumption — is the
 * real code under test and not a parallel path.
 */
const stub = {
  id: "stub" as const,
  async send(request: { system: string; tools: { name: string }[] }) {
    const role = roleFromSystem(request.system);
    // Same employee, different job: the stub picks by what it was handed,
    // exactly as the real transport does.
    const solo = `${role} (solo)`;
    const key =
      !request.tools.some((t) => t.name === "delegate") && script[solo] ? solo : role;
    const turns = script[key] ?? [[{ type: "text", text: "（応答なし）" }]];
    const index = cursor[key] ?? 0;
    cursor[key] = index + 1;
    const content = turns[Math.min(index, turns.length - 1)];
    const hasToolUse = content.some((b) => b.type === "tool_use");

    return {
      blocks: content,
      stopReason: hasToolUse ? ("tool_use" as const) : ("end" as const),
      usage: { inputTokens: 1200, outputTokens: 300, cachedTokens: 0, thoughtTokens: 0 },
    };
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

// ── The vice-president's access ────────────────────────────────────────────
//
// An outside agent now holds keys to the company. The two things that must
// not be wrong: the token is actually checked, and operate scope cannot
// release an irreversible action.
console.log("\n=== Vice-president access ===\n");

const TOKEN = "f".repeat(48);
function vpReq(token?: string, actor?: string): Request {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (actor) headers["x-friday-actor"] = actor;
  return new Request("https://example.com/api/mcp", { method: "POST", headers });
}

// Nothing is reachable until access is deliberately configured.
const unset = envScope({ FRIDAY_AGENT_TOKEN: undefined }, () => authorise(vpReq(TOKEN)));
check("with no token configured, nothing is granted", unset.ok === false);
check("and it says what to set", !unset.ok && unset.reason.includes("FRIDAY_AGENT_TOKEN"));

// A guessable token is not a lock, and pretending otherwise is worse than
// refusing: the whole company sits behind this one string.
const short = envScope({ FRIDAY_AGENT_TOKEN: "hunter2" }, () => authorise(vpReq("hunter2")));
check("a short token is refused even when it matches", short.ok === false);
check("and says how long it must be", !short.ok && short.reason.includes("32"));

const good = envScope({ FRIDAY_AGENT_TOKEN: TOKEN }, () => authorise(vpReq(TOKEN)));
check("a correct token is granted", good.ok === true);
check("read and operate by default", good.ok && good.scopes.join(",") === "read,operate");
// The default must not include the scope that reaches outside.
check("but never approval by default", good.ok && !good.scopes.includes("approve"));

for (const [label, presented] of [
  ["a wrong token", "g".repeat(48)],
  ["a truncated token", "f".repeat(47)],
  ["an empty token", ""],
] as const) {
  const denied = envScope({ FRIDAY_AGENT_TOKEN: TOKEN }, () => authorise(vpReq(presented || undefined)));
  check(`${label} is refused`, denied.ok === false, denied.ok ? "granted" : String(denied.status));
}

const noHeader = envScope({ FRIDAY_AGENT_TOKEN: TOKEN }, () =>
  authorise(new Request("https://example.com/api/mcp", { method: "POST" })),
);
check("a missing Authorization header is a 401", !noHeader.ok && noHeader.status === 401);

// Scopes decide the tool list, so a token without approve never even sees
// the tool — it cannot be called by a model that was not offered it.
const readOnly = envScope(
  { FRIDAY_AGENT_TOKEN: TOKEN, FRIDAY_AGENT_SCOPES: "read" },
  () => authorise(vpReq(TOKEN)),
);
check("scopes can be narrowed to read", readOnly.ok && readOnly.scopes.join(",") === "read");

const readTools = readOnly.ok ? toolsFor(readOnly).map((t) => t.name) : [];
check("a read token sees the status tool", readTools.includes("company_status"));
check("and cannot instruct the company", !readTools.includes("instruct_company"));
check("and cannot decide an approval", !readTools.includes("decide_approval"));

const operateTools = good.ok ? toolsFor(good).map((t) => t.name) : [];
check("an operate token can instruct", operateTools.includes("instruct_company"));
check("and run a scheduled job", operateTools.includes("run_job"));
// The whole point of the separation.
check("and still cannot decide an approval", !operateTools.includes("decide_approval"));

const full = envScope(
  { FRIDAY_AGENT_TOKEN: TOKEN, FRIDAY_AGENT_SCOPES: "read,operate,approve" },
  () => authorise(vpReq(TOKEN)),
);
check("approval is available only when granted explicitly", full.ok && toolsFor(full).map((t) => t.name).includes("decide_approval"));

// Nonsense in the scope list must not silently become more access.
const garbage = envScope(
  { FRIDAY_AGENT_TOKEN: TOKEN, FRIDAY_AGENT_SCOPES: "admin,root,*" },
  () => authorise(vpReq(TOKEN)),
);
check("unrecognised scopes fall back to the safe default", garbage.ok && !garbage.scopes.includes("approve"), garbage.ok ? garbage.scopes.join(",") : "denied");

// The actor name travels into the activity feed, so it is bounded.
const actorName = envScope({ FRIDAY_AGENT_TOKEN: TOKEN }, () => authorise(vpReq(TOKEN, "x".repeat(400))));
check("the caller's name cannot flood the feed", actorName.ok && actorName.actor.length <= 60, actorName.ok ? String(actorName.actor.length) : "denied");

// Minting the key in the app, because the CEO does not use a terminal — and
// because a hosting dashboard never shows a saved secret again, so a value
// set that way is unrecoverable the moment it is needed twice.
mutate((st) => {
  st.agentAccess = undefined;
});

check("with nothing set up, no source is reported", envScope({ FRIDAY_AGENT_TOKEN: undefined }, () => agentTokenSource()) === "none");

const minted = "a".repeat(64);
mutate((st) => {
  st.agentAccess = { token: minted, createdAt: Date.now(), label: "FRIDAY（副社長）" };
});

const appToken = envScope({ FRIDAY_AGENT_TOKEN: undefined }, () => authorise(vpReq(minted)));
check("a key minted in the app authenticates", appToken.ok === true);
check("and is reported as coming from the app", envScope({ FRIDAY_AGENT_TOKEN: undefined }, () => agentTokenSource()) === "app");
check(
  "a wrong key is still refused",
  envScope({ FRIDAY_AGENT_TOKEN: undefined }, () => authorise(vpReq("b".repeat(64)))).ok === false,
);

// Someone who deliberately sets an environment variable means it, so that
// wins — otherwise a stored key could quietly override a deployment's own.
const envWins = envScope({ FRIDAY_AGENT_TOKEN: TOKEN }, () => ({
  source: agentTokenSource(),
  storedRejected: authorise(vpReq(minted)).ok,
  envAccepted: authorise(vpReq(TOKEN)).ok,
}));
check("an environment variable takes precedence", envWins.source === "env");
check("and the stored key stops working while it is set", envWins.storedRejected === false);
check("while the environment one is accepted", envWins.envAccepted === true);

mutate((st) => {
  st.agentAccess = undefined;
});

/* The tools themselves, against the real company state. */
const vpGrant = { ok: true as const, actor: "FRIDAY（副社長）", scopes: ["read", "operate", "approve"] as const };
const byName = (n: string) => VP_TOOLS.find((t) => t.name === n)!;

const snapshot = (await byName("company_status").run({}, vpGrant as never)) as Record<string, never>;
const snap = snapshot as unknown as {
  canWork: boolean;
  needsCeo: { id: string; impact: string }[];
  tasks: { active: number; total: number };
  schedule: { morningBriefing: string };
};
check("status answers whether the company can work at all", typeof snap.canWork === "boolean");
check("and counts the company's tasks", snap.tasks.total > 0, String(snap.tasks.total));
check("and reports the schedule in effect", snap.schedule.morningBriefing.includes(":"));

// The approval list must carry the impact and the exact payload, because the
// agent reads those to the CEO — a summary is how consent gets manufactured.
const approvals = (await byName("list_approvals").run({}, vpGrant as never)) as {
  id: string;
  impact: string;
  payload: unknown;
}[];
check("the approval list reaches the agent", Array.isArray(approvals));
check(
  "each approval carries what would happen on approval",
  approvals.every((a) => typeof a.impact === "string" && a.impact.length > 0),
);

// The payload is the text that would actually go out. Constructed rather
// than hoped for, because this is the field that stops an agent from
// paraphrasing an email into consent the CEO never gave.
mutate((st) => {
  st.approvals = [
    {
      id: "ap-vp-test",
      title: "外部送信の承認",
      summary: "提携候補へ初回接触メールを送ります。",
      impact: "承認した瞬間に送信されます。取り消せません。",
      kind: "email",
      risk: "high",
      priority: "urgent",
      status: "pending",
      requestedBy: "outreach_ai",
      requestedAt: Date.now(),
    },
    ...st.approvals,
  ];
  st.runs = [
    {
      id: "run-vp-test",
      agentId: "outreach_ai",
      objective: "提携候補へ接触する",
      status: "waiting_for_ceo",
      startedAt: Date.now(),
      steps: 2,
      usage: { inputTokens: 0, outputTokens: 0 },
      toolCalls: [],
      approvalId: "ap-vp-test",
      pendingAction: {
        tool: "send_email",
        input: { to: ["partner@example.com"], subject: "ご提案", body: "本文そのまま" },
      },
    },
    ...st.runs,
  ];
});

const withPayload = (await byName("list_approvals").run({}, vpGrant as never)) as {
  id: string;
  payload: { body?: string } | null;
}[];
const queued = withPayload.find((a) => a.id === "ap-vp-test");
check("a queued action's exact payload reaches the agent", queued?.payload?.body === "本文そのまま", JSON.stringify(queued?.payload));

// An approval with no queued action reports none rather than inventing one.
const seeded = withPayload.find((a) => a.id !== "ap-vp-test");
check("and an approval without one says so", seeded ? seeded.payload === null : true);

// Every tool must declare a scope, or it would default to being offered.
check("every tool declares a scope", VP_TOOLS.every((t) => ["read", "operate", "approve"].includes(t.scope)));
check("only one tool can release an action", VP_TOOLS.filter((t) => t.scope === "approve").length === 1);
check(
  "every tool has a schema the protocol can advertise",
  VP_TOOLS.every((t) => t.schema && (t.schema as { type?: string }).type === "object"),
);
check(
  "and a description long enough to pick it by",
  VP_TOOLS.every((t) => t.description.length > 60),
  String(Math.min(...VP_TOOLS.map((t) => t.description.length))),
);

// ── Opening a report's PDF from a different instance ──────────────────────
//
// The reported failure: every report an AI employee wrote opened as "Report
// not found" and told the CEO to regenerate it — which produced another
// report that also would not open. The registry was an in-memory Map, and on
// serverless the instance asked for the PDF is almost never the one that
// wrote the report.
console.log("\n=== Report PDF lookup ===\n");

cursor["Research Director"] = 0;
const authored = await runAgent({
  agentId: "research_director",
  objective: "市場の状況をレポートにまとめてください。",
  canDelegate: false,
  canReport: true,
});
const reportId = authored.reportId ?? "";
check("the agent's report has an id", reportId.length > 0, reportId);
check("and is found while its own instance is warm", Boolean(getReport(reportId)));

// Exactly what a second instance looks like: the Map is empty and the state
// has to come back from the backend.
__clearRuntimeForTesting();
invalidate();
await loadState();

const cold = getReport(reportId);
check("a cold instance still finds it", Boolean(cold), cold ? "found" : "not found");
check("with its content intact, so the PDF can render", Boolean(cold?.content?.executiveSummary));
check("and its title preserved", (cold?.title ?? "").length > 0, cold?.title);

// The PDF renderer is the thing the route actually calls.
const coldPdf = cold ? await renderReportPdf(cold) : new Uint8Array();
check("the PDF renders from the persisted copy", coldPdf.byteLength > 1000, `${coldPdf.byteLength} bytes`);
check("and is a real PDF", new TextDecoder().decode(coldPdf.slice(0, 5)) === "%PDF-");

// Seeded reports must keep resolving, since the demo links to them.
check("seeded reports still resolve", Boolean(getReport(SEED_REPORTS[0].id)), SEED_REPORTS[0].id);
check("an unknown id is still not found", getReport("rep-does-not-exist") === undefined);

// Re-storing a report updates it rather than adding a second copy — the CEO's
// review decision arrives this way.
const copiesBefore = readState().reports.filter((r) => r.id === reportId).length;
putReport({ ...(cold as typeof SEED_REPORTS[number]), status: "APPROVED" });
const copiesAfter = readState().reports.filter((r) => r.id === reportId);
check(
  "storing it again does not duplicate it",
  copiesBefore === 1 && copiesAfter.length === 1,
  `${copiesBefore} → ${copiesAfter.length}`,
);
check("and the update is what is read back", getReport(reportId)?.status === "APPROVED");

// Ids are generated per instance. Two instances starting their counters at
// zero in the same millisecond used to produce the same id, and the state
// merge unions by id — so a collision silently fused two different records.
const ids = new Set(Array.from({ length: 500 }, () => uid("rep")));
check("ids are unique within a process", ids.size === 500, `${ids.size}/500`);
check("and carry a per-process segment", uid("rep").includes(processSegment()), processSegment());

// ── The company's other recurring work ────────────────────────────────────
//
// The dashboard has advertised a morning briefing, a daily report and a
// weekly board meeting since the company was built, and none of them existed.
// These are the checks that they now actually produce something.
console.log("\n=== Scheduled jobs ===\n");

check(
  "every advertised job exists",
  ["morning-briefing", "note-daily-draft", "daily-report", "weekly-board"].every((id) =>
    jobs().some((j) => j.id === id),
  ),
  jobs().map((j) => j.id).join(", "),
);

// The schedule is company state, so the suite sets it rather than depending
// on the hour it happens to run at. An earlier version of these checks
// asserted "already ran today" and got "not due yet" whenever the suite ran
// before 08:00 JST — the same wall-clock dependency the note job already had
// pinned away.
mutate((st) => {
  st.schedule = {
    morningBriefing: "00:00",
    dailyReport: "00:00",
    weeklyBoard: "00:00",
    weeklyBoardDay: new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: "Asia/Tokyo",
    }).format(new Date()),
  };
});
check("the jobs run on the CEO's schedule, not a constant", jobs()[0].at === "00:00", jobs()[0].at);

const reportsBefore = readState().reports.length;
cursor["COO (solo)"] = 0;
const briefing = await runMorningBriefing(true);
check("the morning briefing runs", briefing.status === "ran", `${briefing.status}: ${briefing.detail}`);
check("and leaves a report the CEO can open", readState().reports.length > reportsBefore);
check("it is recorded, so it cannot run twice", readState().jobs.some((j) => j.id === "morning-briefing" && j.ok));
check("a second call the same day declines", (await runMorningBriefing()).status === "skipped");

cursor["COO (solo)"] = 0;
const daily = await runDailyReport(true);
check("the daily report runs", daily.status === "ran", `${daily.status}: ${daily.detail}`);
check("and is recorded separately from the briefing", readState().jobs.some((j) => j.id === "daily-report" && j.ok));

// Eight executives do not fit in one request, so the meeting is assembled
// across several — a part-finished meeting is normal, not broken.
for (const id of EXECUTIVE_IDS) cursor[AGENTS_BY_ID[id]?.role ?? id] = 0;
const firstPass = await runWeeklyBoard(true);
check("the board meeting starts", firstPass.status === "ran", `${firstPass.status}: ${firstPass.detail}`);

const partial = readState().meetings?.[0];
check("a meeting record is created", Boolean(partial), partial?.id);
check("with only the first batch reporting", (partial?.reports.length ?? 0) > 0 && (partial?.reports.length ?? 0) < EXECUTIVE_IDS.length, `${partial?.reports.length}/${EXECUTIVE_IDS.length}`);
check("and is not yet closed", partial?.status === "scheduled", partial?.status);

// Each further ring carries it forward rather than starting again.
let guard = 0;
while ((readState().meetings?.[0]?.reports.length ?? 0) < EXECUTIVE_IDS.length && guard < 12) {
  guard += 1;
  for (const id of EXECUTIVE_IDS) cursor[AGENTS_BY_ID[id]?.role ?? id] = 0;
  await runWeeklyBoard(true);
}
const finished = readState().meetings?.[0];
check("further calls resume the same meeting, never restart it", readState().meetings?.length === 1, `${readState().meetings?.length} meeting(s)`);
check("every executive ends up reporting exactly once", finished?.reports.length === EXECUTIVE_IDS.length, `${finished?.reports.length}/${EXECUTIVE_IDS.length}`);
check("no executive reports twice", new Set(finished?.reports.map((r) => r.agentId)).size === EXECUTIVE_IDS.length);
check("the meeting closes once everyone is in", finished?.status === "completed", finished?.status);
check("with minutes attached", Boolean(finished?.summary && finished.summary !== "（要約なし）"), finished?.summary?.slice(0, 40));

// The executives answer in prose; the parser has to survive the decoration a
// model adds to a format it was given.
const section = parseBoardSection("cto", [
  "認証基盤が80%に到達しました",
  "- Supabase Auth の実装が完了",
  "- E2Eの再実行で劣化なし",
  "- 残りは権限判定のみ",
  "- 4点目は捨てられる",
  "指標: 進捗=80%",
].join("\n"));
check("the headline is the first line", section.headline === "認証基盤が80%に到達しました");
check("bullets lose their markers", section.points[0] === "Supabase Auth の実装が完了");
check("at most three points are kept", section.points.length === 3, String(section.points.length));
check("the metric is pulled out of the body", section.metric?.value === "80%", JSON.stringify(section.metric));
check("the agent's department becomes the area", section.area === AGENTS_BY_ID["cto"]?.department);

// A reply that ignores the format must still produce something usable.
const sloppy = parseBoardSection("cmo", "今週はInstagramの保存率が伸びました。");
check("an unformatted reply still yields a section", sloppy.headline.length > 0 && sloppy.points.length === 0);
check("and no invented metric", sloppy.metric === undefined);

const minutes = parseMinutes([
  "全体として前進しました。認証基盤とSNSが伸びています。",
  "決定: NEWTONEの出展募集を今週中に開始する",
  "決定: 提携候補3社へ接触する",
].join("\n"));
check("the minutes separate summary from decisions", minutes.decisions.length === 2, String(minutes.decisions.length));
check("decisions lose their prefix", minutes.decisions[0].startsWith("NEWTONE"), minutes.decisions[0]);
check("the summary is the rest", minutes.summary.includes("前進"));

// The dispatcher is what every trigger calls, so a late ring still works.
const due = await runDueJobs();
// The scheduled jobs, plus the company's own work — which is reported in the
// same list so one trigger drives everything.
check(
  "the dispatcher reports on every scheduled job",
  jobs().every((j) => due.some((r) => r.id === j.id)),
  due.map((r) => r.id).join(" "),
);
check("and on the autonomous work", due.some((r) => r.id === "autonomous-work"));
check(
  "and never runs a scheduled job twice in a day",
  due
    .filter((r) => r.id !== "autonomous-work")
    .every((r) => r.status === "skipped" || r.status === "not_due"),
  due.map((r) => `${r.id}:${r.status}`).join(" "),
);

// ── A stop that is not the job's fault ────────────────────────────────────
//
// The CEO reported that hitting the per-minute ceiling stopped the company
// for the rest of the day, and he was right. A job claims its slot for the
// day before it starts, so two triggers cannot both run it — and that claim
// used to survive a rate-limit failure. One brush with a ceiling that clears
// in under a minute therefore retired the job until tomorrow.
//
// A transient stop now leaves the slot claimable again and reports "waiting"
// rather than "failed", because the work is still owed.
const throwingStub = {
  id: "stub" as const,
  async send() {
    throw new ProviderError(
      "Gemini APIの1分あたりの回数上限に達しました。20秒待って自動で再実行します。",
      429,
      true,
      20_000,
    );
  },
} as never;

mutate((st) => {
  st.jobs = (st.jobs ?? []).filter((j) => j.id !== "daily-report");
});
__setClientForTesting(throwingStub);
const limited = await runDailyReport(true);
__setClientForTesting(stub);

check("a rate-limited job is not called a failure", limited.status === "waiting", `${limited.status}: ${limited.detail}`);
check("and says it resumes by itself", limited.detail.includes("自動で再開"), limited.detail.slice(0, 50));

const heldRun = readState().jobs.find((j) => j.id === "daily-report");
check("the attempt is recorded with a hold", typeof heldRun?.retryAt === "number", String(heldRun?.retryAt));
check("and the hold is in the future", (heldRun?.retryAt ?? 0) > Date.now());

// Still held: a trigger arriving during the hold must not pile on.
check("a trigger during the hold is declined", (await runDailyReport()).status === "skipped");

// Hold passed: the next trigger picks the work up, with nobody asking.
mutate((st) => {
  const run = (st.jobs ?? []).find((j) => j.id === "daily-report");
  if (run) run.retryAt = Date.now() - 1;
});
cursor["COO (solo)"] = 0;
const afterHold = await runDailyReport();
check("once the hold passes the work resumes on its own", afterHold.status === "ran", `${afterHold.status}: ${afterHold.detail}`);
check("and the hold is cleared so it cannot loop", readState().jobs.find((j) => j.id === "daily-report")?.retryAt === undefined);

// A genuine failure is different: repeating it would just repeat the error,
// so it keeps its slot and waits for a person.
const brokenStub = {
  id: "stub" as const,
  async send() {
    throw new ProviderError("GEMINI_API_KEY が無効です。", 400, false);
  },
} as never;
mutate((st) => {
  st.jobs = (st.jobs ?? []).filter((j) => j.id !== "daily-report");
});
__setClientForTesting(brokenStub);
const hardFail = await runDailyReport(true);
__setClientForTesting(stub);
check("a real failure is still a failure", hardFail.status === "failed", hardFail.status);
check("and keeps its slot rather than retrying all day", readState().jobs.find((j) => j.id === "daily-report")?.retryAt === undefined);


// ── Working with nobody watching ───────────────────────────────────────────
//
// The board had forty tasks on it, each assigned to an employee, and nothing
// ever invoked those employees. The hard part is not starting that work — it
// is stopping, because on a free key one agent turn is one request and forty
// tasks unattended would spend the day before breakfast.
console.log("\n=== Autonomous work ===\n");

const nowMs = Date.now();
const task = (over: Partial<(typeof readState)["prototype"]> | Record<string, unknown>) =>
  ({
    id: "x",
    title: "t",
    description: "d",
    status: "RUNNING",
    priority: "normal",
    assignedAgent: "market_ai",
    department: "research",
    createdAt: nowMs - 86_400_000,
    updatedAt: nowMs - 86_400_000,
    subTasks: [],
    progress: 10,
    ...over,
  }) as never;

const pool = [
  task({ id: "t-old", updatedAt: nowMs - 86_400_000 }),
  task({ id: "t-fresh", updatedAt: nowMs - 60_000 }),
  task({ id: "t-blocked", blockedReason: "承認待ち" }),
  task({ id: "t-awaiting", approvalId: "ap-1" }),
  task({ id: "t-done", status: "COMPLETED" }),
  task({ id: "t-failed", status: "FAILED" }),
  task({ id: "t-nobody", assignedAgent: "does_not_exist" }),
  task({ id: "t-critical", priority: "critical", updatedAt: nowMs - 7_200_000 }),
  task({ id: "t-overdue", deadline: nowMs - 3_600_000, updatedAt: nowMs - 7_200_000 }),
];

const queueOrder = pickTasks(pool, nowMs, 90 * 60_000, 10).map((t) => t.id);

// An overdue task outranks a merely important one, which outranks age.
check("the overdue task is picked first", queueOrder[0] === "t-overdue", queueOrder.join(" "));
check("then the critical one", queueOrder[1] === "t-critical", queueOrder.join(" "));
check("a long-untouched task is eligible", queueOrder.includes("t-old"));

// Each exclusion is a request not spent.
check("a task touched minutes ago is left alone", !queueOrder.includes("t-fresh"));
// Running its agent again would reproduce the same halt and pay for it.
check("a task waiting on the CEO is never picked up", !queueOrder.includes("t-awaiting"));
check("nor one its own agent said it is stuck on", !queueOrder.includes("t-blocked"));
check("finished work is not redone", !queueOrder.includes("t-done") && !queueOrder.includes("t-failed"));
check("a task assigned to nobody is skipped", !queueOrder.includes("t-nobody"));

check("the batch size is respected", pickTasks(pool, nowMs, 90 * 60_000, 2).length === 2);
// Forcing is for "do it now", and must not also mean "ignore the ceilings".
check("forcing clears only the cooldown", pickTasks(pool, nowMs, 0, 10).some((t) => t.id === "t-fresh"));

/* The ceilings, against the real engine. */

check("autonomy is on by default", envScope({ FRIDAY_AUTONOMY: undefined }, () => autonomySettings().enabled));
check("and can be turned off", !envScope({ FRIDAY_AUTONOMY: "false" }, () => autonomySettings().enabled));
check(
  "the allowance share leaves room for the CEO",
  envScope({ FRIDAY_AUTONOMY_BUDGET_SHARE: undefined }, () => autonomySettings().budgetShare) < 1,
);
check(
  "a nonsensical share falls back rather than becoming unlimited",
  envScope({ FRIDAY_AUTONOMY_BUDGET_SHARE: "9" }, () => autonomySettings().budgetShare) <= 1,
);

const off = await envScope({ FRIDAY_AUTONOMY: "false" }, () => advanceWork());
check("disabled means nothing runs", off.status === "off", off.status);
check("and it says so rather than looking idle", off.detail.includes("FRIDAY_AUTONOMY"));

// The reserve: autonomous work stops at a fraction of the day, so the CEO's
// own instructions and the scheduled jobs are never queued behind it.
mutate((st) => {
  st.quota = { day: pacificDay(), requests: 400, exhausted: false, recent: [] };
  st.autonomy = undefined;
});
const starved = await envScope(
  { FRIDAY_DAILY_REQUEST_BUDGET: "500", FRIDAY_AUTONOMY_BUDGET_SHARE: "0.6", FRIDAY_FREE_TIER: "true", GEMINI_API_KEY: "AIza-x", FRIDAY_TEST_TRANSPORT: "1" },
  () => advanceWork(),
);
check("past its share of the day, autonomous work stops", starved.status === "no_budget", starved.status);
check("and says what it is leaving for the CEO", starved.detail.includes("CEOの指示"));

// The daily ceiling, which is claimed before the work so two ticks arriving
// together cannot both believe there is room for a full batch.
mutate((st) => {
  st.quota = undefined;
  st.autonomy = { day: new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10), advanced: 12 };
});
const capped = await envScope({ FRIDAY_MAX_TASKS_PER_DAY: "12" }, () => advanceWork());
check("the daily ceiling stops the work", capped.status === "throttled", capped.status);
check("and names the limit", capped.detail.includes("12"));

// A new JST day is a new allowance.
mutate((st) => {
  if (st.autonomy) st.autonomy.day = "2000-01-01";
});
const fresh = autonomyStatus();
check("a new day resets the count", fresh.advancedToday === 0, String(fresh.advancedToday));

/* End to end: an employee actually advances its own task. */
mutate((st) => {
  st.autonomy = undefined;
  st.quota = undefined;
  // Only this one, so the assertion is about the engine rather than about
  // which of the company's real tasks happens to sort first.
  st.tasks = [
    task({
      id: "t-autonomy",
      title: "美容業界の最新動向を1枚にまとめる",
      description: "一次情報を読んで、CEOが3分で読める形にする。",
      assignedAgent: "market_ai",
      updatedAt: Date.now() - 86_400_000,
    }),
  ];
});
cursor["Market Research AI"] = 0;

const worked = await envScope({ FRIDAY_TASKS_PER_TICK: "1" }, () => advanceWork());
check("the company works unprompted", worked.status === "worked", `${worked.status}: ${worked.detail}`);
check("exactly one task per tick, as configured", worked.advanced.length === 1, String(worked.advanced.length));
check("the assignee is the one who did it", worked.advanced[0]?.agent === "Market Research AI", worked.advanced[0]?.agent);
check(
  "and the CEO can see it happened",
  readState().activity.some((e) => e.message.includes("自分の担当タスクに着手")),
);
// Touched either way, so a failed run is not retried on the very next tick
// at the cost of the same requests.
check(
  "the task is marked as touched",
  (readState().tasks.find((t) => t.id === "t-autonomy")?.updatedAt ?? 0) > Date.now() - 60_000,
);
check("and the day's count went up", autonomyStatus().advancedToday === 1, String(autonomyStatus().advancedToday));

// Immediately after, the same task is in cooldown — so a tight polling loop
// cannot spend the allowance on one task over and over.
const again = await advanceWork();
check(
  "a tick straight after does not redo the same task",
  again.status === "idle" && again.advanced.length === 0,
  `${again.status}: ${again.detail}`,
);

// A rate limit is not the task's turn being spent. The run did no work, so
// charging it a slot and a cooldown would quietly eat the day's allowance
// and leave the company looking idle while having done nothing — which is
// what the CEO saw. The slot is given back and the task left untouched, so
// the next tick picks the same one up.
mutate((st) => {
  st.autonomy = undefined;
  st.quota = undefined;
  st.tasks = [
    task({
      id: "t-throttled",
      title: "止まったときに取り返せるか",
      description: "レート制限は作業の失敗ではない。",
      assignedAgent: "market_ai",
      updatedAt: Date.now() - 86_400_000,
    }),
  ];
});
const untouchedBefore = readState().tasks.find((t) => t.id === "t-throttled")?.updatedAt ?? 0;
__setClientForTesting(throwingStub);
const throttled = await envScope({ FRIDAY_TASKS_PER_TICK: "1" }, () => advanceWork());
__setClientForTesting(stub);

check("a rate-limited tick is not reported as work done", throttled.status === "throttled", `${throttled.status}: ${throttled.detail}`);
check("and says it resumes by itself", throttled.detail.includes("自動で再開"), throttled.detail.slice(0, 48));
check("the day's task allowance is given back", autonomyStatus().advancedToday === 0, String(autonomyStatus().advancedToday));
check(
  "and the task is left for the next tick, not put on cooldown",
  (readState().tasks.find((t) => t.id === "t-throttled")?.updatedAt ?? 0) === untouchedBefore,
);

// Which means the retry actually happens, with nobody asking.
cursor["Market Research AI"] = 0;
const retried = await envScope({ FRIDAY_TASKS_PER_TICK: "1" }, () => advanceWork());
check("so the next tick does the work", retried.status === "worked", `${retried.status}: ${retried.detail}`);
check("on the same task", retried.advanced[0]?.taskId === "t-throttled", retried.advanced[0]?.taskId);

// ── The background heartbeat ──────────────────────────────────────────────
//
// The dashboard used to be the clock: while a tab was open the company
// worked, and closed it stopped. The platform cron fires twice a day on the
// free plan, which is nowhere near a day's work, so an invocation now hands
// over to a fresh one until the day's work is actually finished.
//
// A function that calls itself is the dangerous thing in this codebase, so
// these checks are about the fences, not the work. Every one of them must be
// a stop rather than a slowdown.
console.log("\n=== Background heartbeat ===\n");

const tickEnv = { GEMINI_API_KEY: "AIza-tick", CRON_SECRET: "s".repeat(40) };

// Nothing owed is the normal way a day ends.
mutate((st) => {
  st.tick = undefined;
  st.quota = undefined;
  st.autonomy = { day: new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10), advanced: 99 };
  st.jobs = jobs().map((j) => ({
    id: j.id,
    ranFor: new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10),
    at: Date.now(),
    ok: true,
    detail: "done",
  }));
});
const allDone = envScope({ ...tickEnv, FRIDAY_MAX_TASKS_PER_DAY: "12" }, () => workRemaining());
check("with everything done, the chain ends", allDone.yes === false, allDone.why);
check("and says so plainly", allDone.why.includes("すべて終わりました"), allDone.why);

// A job held after a rate limit is work owed — that hold clearing is the
// entire reason to come back.
mutate((st) => {
  const run = (st.jobs ?? [])[0];
  if (run) run.retryAt = Date.now() + 1_000;
});
const owed = envScope({ ...tickEnv, FRIDAY_MAX_TASKS_PER_DAY: "12" }, () => workRemaining());
check("a held job counts as work still owed", owed.yes === true, owed.why);

// The day's allowance is a hard stop, whatever else is pending.
mutate((st) => {
  st.quota = { day: pacificDay(), requests: 0, exhausted: true, recent: [] };
});
const spent = envScope(tickEnv, () => workRemaining());
check("an exhausted allowance ends the chain", spent.yes === false, spent.why);
mutate((st) => {
  st.quota = undefined;
});

// Fence 1: no shared secret, no chain — otherwise the endpoint could be
// driven by anybody.
mutate((st) => {
  st.tick = undefined;
});
const noSecret = envScope({ GEMINI_API_KEY: "AIza-tick", CRON_SECRET: undefined }, () => chainGuard());
check("without CRON_SECRET nothing chains", noSecret.ok === false, noSecret.why);
check("and the reason tells the CEO what to set", noSecret.why.includes("CRON_SECRET"));

// Fence 2: the cap binds, and is counted across instances rather than in
// memory — each link is a different machine, so an in-process counter would
// reset on every hop and never bind at all.
mutate((st) => {
  st.tick = { day: pacificDay(), chains: 40, lastAt: 0 };
});
const capReached = envScope(tickEnv, () => chainGuard());
check("the daily chain cap is a hard stop", capReached.ok === false, capReached.why);
check("and names the cap", capReached.why.includes("40"));

// Fence 3: a minimum gap, so a failure that looks like progress cannot
// become a tight loop.
mutate((st) => {
  st.tick = { day: pacificDay(), chains: 1, lastAt: Date.now() };
});
const tooSoon = envScope(tickEnv, () => chainGuard());
check("a link fired just now is not fired again", tooSoon.ok === false, tooSoon.why);

// And in the ordinary case it hands over, booking its place as it goes.
mutate((st) => {
  st.tick = { day: pacificDay(), chains: 3, lastAt: Date.now() - 60_000 };
});
const handover = envScope(tickEnv, () => chainGuard());
check("otherwise the work is handed over", handover.ok === true, handover.why);
check("and the link is counted before it fires", readState().tick?.chains === 4, String(readState().tick?.chains));

// A new Pacific day is a new chain allowance, like the request budget it is
// bounded by.
mutate((st) => {
  st.tick = { day: "2000-01-01", chains: 40, lastAt: 0 };
});
const newDay = envScope(tickEnv, () => chainGuard());
check("a new day restores the chain allowance", newDay.ok === true, newDay.why);

mutate((st) => {
  st.autonomy = undefined;
});

// ── The schedule is a real setting ─────────────────────────────────────────
//
// Settings has offered these times as editable fields since the company was
// built, and the jobs read a hardcoded constant — so changing the morning
// briefing's time changed nothing. This is the check that it now does.
console.log("\n=== Schedule ===\n");

mutate((st) => {
  st.schedule = {
    morningBriefing: "06:30",
    dailyReport: "23:15",
    weeklyBoard: "19:00",
    weeklyBoardDay: "Friday",
  };
});

const advertised = jobs();
check("the briefing runs when the CEO said", advertised.find((j) => j.id === "morning-briefing")?.at === "06:30");
check("so does the daily report", advertised.find((j) => j.id === "daily-report")?.at === "23:15");
check("and the board meeting", advertised.find((j) => j.id === "weekly-board")?.at === "19:00");
check("the board's day comes from the schedule too", scheduleNow().weeklyBoardDay === "Friday");

// A job compares the clock against this string. An unparseable value makes
// that comparison NaN, which is false — so the job would silently never run
// again. That has to be refused, not stored.
for (const bad of ["25:00", "8:00", "08:0", "morning", "", "08:60"]) {
  const verdict = validateSchedule({ morningBriefing: bad });
  check(`"${bad}" is refused as a time`, verdict !== null, verdict ?? "accepted");
}
check("a well-formed time is accepted", validateSchedule({ morningBriefing: "08:00" }) === null);
check("midnight is accepted", validateSchedule({ dailyReport: "00:00" }) === null);
check("a bad weekday is refused", validateSchedule({ weeklyBoardDay: "Someday" }) !== null);
check("a real weekday is accepted", validateSchedule({ weeklyBoardDay: "Sunday" }) === null);

// Back to something the rest of the suite can rely on.
mutate((st) => {
  st.schedule = undefined;
});
check("with nothing set, the defaults apply", scheduleNow().morningBriefing === "08:00", scheduleNow().morningBriefing);

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
// On a free-tier key the quota error is the one that will actually happen, and
// it must not read like a bug. The two kinds of 429 then part company: the
// per-minute ceiling clears on its own and is waited out, while the daily one
// has nothing to wait for and stops the company until the quota rolls over.
// Treating both as fatal is what made one busy minute retire a job for a day.
console.log("\n=== API errors ===\n");

const perMinute = describeGeminiError(
  429,
  '{"error":{"code":429,"message":"Quota exceeded for quota metric \'Generate requests per minute\'","status":"RESOURCE_EXHAUSTED"}}',
);
check("a rate limit says to wait, not that it broke", perMinute.message.includes("1分あたり"), perMinute.message.slice(0, 30));
check("and it is retried automatically", perMinute.retryable === true);
check("and says it will resume by itself", perMinute.message.includes("自動で再実行"));
check("and carries a wait even when the service names none", (perMinute.retryAfterMs ?? 0) > 0, String(perMinute.retryAfterMs));

// The service's own RetryInfo beats any guess: our pacing counts what this
// company sent, while the service counts everything the key was charged for.
const withDelay = describeGeminiError(
  429,
  '{"error":{"code":429,"message":"Quota exceeded for quota metric \'Generate requests per minute\'","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"41s"}]}}',
);
check("the service's own retry delay is honoured", withDelay.retryAfterMs === 41_250, String(withDelay.retryAfterMs));
check("and it is reported in seconds", withDelay.message.includes("42秒"), withDelay.message.slice(0, 40));
check("a fractional delay parses", parseRetryDelay('{"retryDelay":"1.5s"}') === 1_750, String(parseRetryDelay('{"retryDelay":"1.5s"}')));
check("an absurd delay is capped", parseRetryDelay('{"retryDelay":"99999s"}') === 120_000);
check("no delay at all reads as none", parseRetryDelay('{"error":{}}') === null);
// "per day" wins over the per-minute reading even when both could match,
// because waiting out a minute for an exhausted day is a wasted request.
const bothKinds = describeGeminiError(
  429,
  '{"error":{"message":"Quota exceeded for metric requests per day","details":[{"retryDelay":"30s"}]}}',
);
check("a daily quota is never treated as a pause", bothKinds.retryable === false, bothKinds.message.slice(0, 20));

const perDay = describeGeminiError(
  429,
  '{"error":{"code":429,"message":"You exceeded your current quota: requests per day","status":"RESOURCE_EXHAUSTED"}}',
);
check("a daily cap is told apart from a per-minute one", perDay.message.includes("1日あたり"), perDay.message.slice(0, 30));
check("and says when it comes back", perDay.message.includes("太平洋時間"));
check("and is also never retried", perDay.retryable === false);

const rejectedKey = describeGeminiError(400, '{"error":{"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}');
check("an invalid key names the variable", rejectedKey.message.includes("GEMINI_API_KEY"), rejectedKey.message.slice(0, 30));
check("and where to get one", rejectedKey.message.includes("aistudio.google.com"));

const missingModel = describeGeminiError(404, '{"error":{"message":"models/gemini-9-ultra is not found"}}');
check("an unavailable model names the way out", missingModel.message.includes("GEMINI_MODEL"), missingModel.message.slice(0, 40));

const transient = describeGeminiError(503, "The model is overloaded.");
check("a transient fault is the only retryable one", transient.retryable === true);

// A 5xx is worth one more attempt; everything else is not.
check("a 400 is not retried", describeGeminiError(400, "bad").retryable === false);
check("a 403 is not retried", describeGeminiError(403, "denied").retryable === false);

// Anything reaching the loop by another route still gets classified.
const viaLoop = describeBadRequest('{"error":{"status":"RESOURCE_EXHAUSTED","message":"quota"}}');
check("the loop classifies a quota error too", viaLoop.includes("無料枠"), viaLoop.slice(0, 24));
const unknown = describeBadRequest("something unforeseen");
check("anything else keeps its detail", unknown.includes("something unforeseen"), unknown.slice(0, 40));

// ── Talking to Gemini: the two shape differences that bite ─────────────────
//
// Both were taken from the published discovery document rather than memory,
// and both fail silently-ish if got wrong: a lowercase type is rejected, and
// a dropped thought signature makes the *next* turn fail.
console.log("\n=== Gemini wire format ===\n");

const converted = toGeminiSchema({
  type: "object",
  properties: {
    scope: { type: "string", enum: ["tasks", "projects"] },
    depth: { type: "integer", description: "how deep" },
    items: { type: "array", items: { type: "string" } },
  },
  required: ["scope"],
  additionalProperties: false,
}) as Record<string, Record<string, Record<string, unknown>>>;

check("types are uppercased for Gemini's enum", converted.type === "OBJECT");
check("nested property types too", converted.properties.scope.type === "STRING");
check("and array item types", (converted.properties.items.items as Record<string, unknown>).type === "STRING");
check("enums survive", Array.isArray(converted.properties.scope.enum));
check("descriptions survive", converted.properties.depth.description === "how deep");
check("required survives", Array.isArray(converted.required));
// Gemini's Schema has no such field and rejects unknown ones.
check("additionalProperties is dropped, not sent", !("additionalProperties" in converted));

// Every real tool must convert without emitting a key Gemini would refuse.
const allowed = new Set([
  "type", "format", "title", "description", "nullable", "enum", "items",
  "properties", "required", "minimum", "maximum", "minItems", "maxItems",
  "minLength", "maxLength", "pattern", "default", "anyOf", "propertyOrdering",
]);
function keysAreLegal(schema: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(schema)) {
    if (!allowed.has(key)) return false;
    if (key === "properties") {
      for (const v of Object.values(value as Record<string, Record<string, unknown>>)) {
        if (!keysAreLegal(v)) return false;
      }
    }
    if (key === "items" && !keysAreLegal(value as Record<string, unknown>)) return false;
  }
  return true;
}
const everyTool = AGENTS.flatMap((a) =>
  companyToolsFor({ agentId: a.id, canDelegate: true, canReport: true }),
);
check(
  "every tool schema converts to something Gemini accepts",
  everyTool.every((t) => keysAreLegal(toGeminiSchema(t.parameters) as Record<string, unknown>)),
  `${everyTool.length} tool definitions`,
);

// A thinking model's function call carries a signature, and Gemini rejects
// the follow-up turn if it does not come back (MISSING_THOUGHT_SIGNATURE).
const contents = toGeminiContents([
  { role: "user", content: "調べて" },
  {
    role: "assistant",
    content: [
      { type: "text", text: "調べます" },
      { type: "tool_use", id: "c1", name: "web_search", input: { query: "x" }, signature: "SIG" },
    ],
  },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", name: "web_search", content: "結果" }] },
]) as { role: string; parts: Record<string, Record<string, unknown>>[] }[];

check("the assistant turn is relabelled 'model'", contents[1].role === "model");
check("a thought signature is echoed back", contents[1].parts[1].thoughtSignature === "SIG");
check("a tool result becomes a functionResponse", Boolean(contents[2].parts[0].functionResponse));
check("keyed by function name, as Gemini requires", contents[2].parts[0].functionResponse.name === "web_search");

// A transcript persisted before this migration has no `name` on its results.
// Those runs must still resume, so the name is recovered from the call.
const legacy = toGeminiContents([
  { role: "assistant", content: [{ type: "tool_use", id: "old1", name: "log_progress", input: {} }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "old1", content: "ok" }] },
]) as { parts: Record<string, Record<string, unknown>>[] }[];
check(
  "a pre-migration transcript still resolves its tool names",
  legacy[1].parts[0].functionResponse.name === "log_progress",
);

// Streaming: text arrives in pieces, a call arrives whole, and reasoning
// parts must be dropped rather than fed back as content.
const folded = foldChunks([
  { candidates: [{ content: { parts: [{ text: "前半" }] } }] },
  { candidates: [{ content: { parts: [{ text: "後半" }, { text: "内心", thought: true }] } }] },
  {
    candidates: [
      {
        content: { parts: [{ functionCall: { name: "log_progress", args: { message: "m" } } }] },
        finishReason: "STOP",
      },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 7 },
  },
]);
check("streamed text is reassembled in order", folded.blocks[0].type === "text" && folded.blocks[0].text === "前半後半");
check("the model's reasoning is not fed back as content", !JSON.stringify(folded.blocks).includes("内心"));
check("a function call becomes a tool_use", folded.blocks[1]?.type === "tool_use");
check("a tool call wins over the reported finish reason", folded.stopReason === "tool_use");
check("reasoning tokens are reported", folded.usage.thoughtTokens === 7);

const refused = foldChunks([{ candidates: [{ finishReason: "SAFETY" }] }]);
check("a safety stop reads as a refusal", refused.stopReason === "refusal");
const malformed = foldChunks([{ candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL" }] }]);
check("an unparseable call is its own outcome, not a retry", malformed.stopReason === "malformed_tool_call");

// ── The provider, end to end over a fake socket ───────────────────────────
//
// Everything above tests the pieces. This drives createGeminiProvider itself
// with a scripted fetch, so the request body is asserted as the API would see
// it — that is the part no unit test of a helper can catch, and the part that
// fails as a 400 with a real key.
console.log("\n=== Gemini provider round trip ===\n");

let sentUrl = "";
let sentBody: Record<string, never> = {} as never;
let sentHeaders: Record<string, string> = {};

function sse(events: unknown[]): Response {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const fakeFetch = (async (url: string, init: RequestInit) => {
  sentUrl = String(url);
  sentHeaders = init.headers as Record<string, string>;
  sentBody = JSON.parse(String(init.body)) as never;
  return sse([
    { candidates: [{ content: { parts: [{ text: "確認します。" }] } }] },
    {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: { name: "log_progress", args: { message: "開始しました" } },
                thoughtSignature: "SIG-1",
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 2100, candidatesTokenCount: 40, thoughtsTokenCount: 120 },
    },
  ]);
}) as unknown as typeof fetch;

const provider = createGeminiProvider({ apiKey: "AIza-test", fetchImpl: fakeFetch });
const turn = await provider.send({
  model: "gemini-2.5-flash",
  system: "[ROLE] COO — テスト",
  messages: [{ role: "user", content: "状況を教えて" }],
  tools: companyToolsFor({ agentId: "coo", canDelegate: true, canReport: true }),
  maxOutputTokens: 4096,
  thinking: "medium",
});

const body = sentBody as unknown as {
  contents: { role: string; parts: { text?: string }[] }[];
  systemInstruction?: { parts: { text: string }[] };
  tools?: { functionDeclarations: { name: string; parameters: Record<string, unknown> }[] }[];
  toolConfig?: { functionCallingConfig: { mode: string } };
  generationConfig: { maxOutputTokens: number; thinkingConfig: { thinkingBudget: number } };
};

check("it streams rather than buffering one response", sentUrl.includes(":streamGenerateContent"));
check("as server-sent events", sentUrl.includes("alt=sse"));
check("the model id is in the path, where Gemini wants it", sentUrl.includes("/models/gemini-2.5-flash:"));
// A key on the query string lands in access logs and proxy caches.
check("the key travels as a header, not in the URL", !sentUrl.includes("AIza-test"));
check("and is sent as x-goog-api-key", sentHeaders["x-goog-api-key"] === "AIza-test");

check("the system prompt becomes systemInstruction", body.systemInstruction?.parts[0].text?.includes("[ROLE] COO"));
check("the user turn is carried as contents", body.contents[0].parts[0].text === "状況を教えて");
check("tools are sent as functionDeclarations", (body.tools?.[0].functionDeclarations.length ?? 0) > 5);
check("function calling is left to the model", body.toolConfig?.functionCallingConfig.mode === "AUTO");
check("the output ceiling is passed through", body.generationConfig.maxOutputTokens === 4096);
check("thinking becomes a finite budget, never unlimited", body.generationConfig.thinkingConfig.thinkingBudget === 4096);

// The eleven company tools must survive the conversion with their names.
const names = new Set(body.tools?.[0].functionDeclarations.map((d) => d.name));
check("the approval gate is still offered to the model", names.has("request_ceo_approval"));
check("delegation is still offered", names.has("delegate"));
// The adapter's tools are handed out on exactly the equipment the registry
// records, which is the same gate the provider-hosted versions used. The COO
// has analytics but not web_research, so it gets one and not the other.
check("the COO gets compute, which its registry entry equips it for", names.has("code_execution"));
check("and not web search, which it is not equipped for", !names.has("web_search"));

const researchTools = new Set(
  companyToolsFor({ agentId: "market_ai", canDelegate: false, canReport: true }).map((t) => t.name),
);
check("a researcher gets web search as an ordinary function", researchTools.has("web_search"));
check("and page reading with it", researchTools.has("web_fetch"));

check("streamed text is returned", turn.blocks[0].type === "text");
check("the function call is returned as a tool_use", turn.blocks[1]?.type === "tool_use");
check(
  "its thought signature is kept for the next turn",
  turn.blocks[1]?.type === "tool_use" && turn.blocks[1].signature === "SIG-1",
);
check("usage is read from the last chunk", turn.usage.inputTokens === 2100 && turn.usage.thoughtTokens === 120);

// A quota failure must surface immediately, not after retrying into the wall.
let attempts = 0;
const quotaFetch = (async () => {
  attempts += 1;
  return new Response(JSON.stringify({ error: { code: 429, message: "quota exceeded: requests per day" } }), {
    status: 429,
  });
}) as unknown as typeof fetch;

let quotaMessage = "";
try {
  await createGeminiProvider({ apiKey: "k", fetchImpl: quotaFetch }).send({
    model: "m", system: "s", messages: [{ role: "user", content: "x" }],
    tools: [], maxOutputTokens: 100, thinking: "off",
  });
} catch (error) {
  quotaMessage = (error as Error).message;
}
check("a quota error is raised, not swallowed", quotaMessage.includes("1日あたり"), quotaMessage.slice(0, 24));
check("and the request was made exactly once", attempts === 1, `${attempts} attempt(s)`);

// A 5xx is the one case worth a second try, and only one.
let serverAttempts = 0;
const flakyFetch = (async () => {
  serverAttempts += 1;
  if (serverAttempts === 1) return new Response("overloaded", { status: 503 });
  return sse([{ candidates: [{ content: { parts: [{ text: "回復しました" }] } }, ] }]);
}) as unknown as typeof fetch;

const recovered = await createGeminiProvider({ apiKey: "k", fetchImpl: flakyFetch }).send({
  model: "m", system: "s", messages: [{ role: "user", content: "x" }],
  tools: [], maxOutputTokens: 100, thinking: "off",
});
check("a transient fault is retried once and recovers", serverAttempts === 2, `${serverAttempts} attempt(s)`);
check("and the recovered turn is returned", recovered.blocks[0].type === "text");

// The per-minute ceiling is the common failure on a free key, and the one
// the CEO reported as "work stops immediately". It has to be waited out
// rather than raised, and the pacer has to hear about it so the other agents
// slow down instead of each discovering the same wall.
let pacedAttempts = 0;
const noticed: (number | null)[] = [];
const rateLimitedFetch = (async () => {
  pacedAttempts += 1;
  if (pacedAttempts === 1) {
    return new Response(
      '{"error":{"code":429,"message":"Quota exceeded for quota metric \'Generate requests per minute\'","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"0s"}]}}',
      { status: 429 },
    );
  }
  return sse([{ candidates: [{ content: { parts: [{ text: "待ってから書けました" }] } }] }]);
}) as unknown as typeof fetch;

const afterWait = await createGeminiProvider({
  apiKey: "k",
  fetchImpl: rateLimitedFetch,
  onRateLimit: (ms) => noticed.push(ms),
}).send({
  model: "m", system: "s", messages: [{ role: "user", content: "x" }],
  tools: [], maxOutputTokens: 100, thinking: "off",
});
check("a per-minute limit is waited out, not reported as a stop", pacedAttempts === 2, `${pacedAttempts} attempt(s)`);
check("and the work completes", afterWait.blocks[0].type === "text");
check("and the pacer is told, so other agents slow down", noticed.length === 1, JSON.stringify(noticed));

// A ceiling that never clears must still end, or the invocation is killed
// by the platform with nothing recorded — strictly worse than reporting it.
let foreverAttempts = 0;
const alwaysLimited = (async () => {
  foreverAttempts += 1;
  return new Response(
    '{"error":{"code":429,"message":"per minute","details":[{"retryDelay":"0s"}]}}',
    { status: 429 },
  );
}) as unknown as typeof fetch;
let gaveUp = "";
try {
  await createGeminiProvider({ apiKey: "k", fetchImpl: alwaysLimited }).send({
    model: "m", system: "s", messages: [{ role: "user", content: "x" }],
    tools: [], maxOutputTokens: 100, thinking: "off",
  });
} catch (error) {
  gaveUp = (error as Error).message;
}
check("an unclearing limit gives up rather than hanging", gaveUp.includes("1分あたり"), gaveUp.slice(0, 24));
check("and it stopped after a bounded number of tries", foreverAttempts > 1 && foreverAttempts <= 4, `${foreverAttempts} attempt(s)`);

// ── web_fetch is ours now, so its safety is ours too ───────────────────────
//
// An agent can be handed a URL by a page it just read, so the target is
// checked rather than trusted. The link-local range is the one that matters:
// on a cloud host it serves the instance's credentials.
console.log("\n=== web_fetch safety ===\n");

for (const blocked of [
  "http://localhost:3000/admin",
  "http://127.0.0.1/",
  "http://169.254.169.254/latest/meta-data/",
  "http://10.0.0.5/",
  "http://192.168.1.1/",
  "http://172.16.0.1/",
  "http://[::1]/",
  "file:///etc/passwd",
  "http://user:pw@example.com/",
]) {
  check(`refuses ${blocked}`, checkFetchUrl(blocked).ok === false);
}
check("allows an ordinary public page", checkFetchUrl("https://example.com/a").ok === true);

const text = htmlToText(
  "<html><head><title>記事</title><style>body{color:red}</style></head>" +
    "<body><script>alert(1)</script><h1>見出し</h1><p>本文&amp;続き</p></body></html>",
);
check("the title is kept", text.startsWith("記事"));
check("script and style are stripped", !text.includes("alert") && !text.includes("color:red"));
check("entities are decoded", text.includes("本文&続き"));

// ── Staying inside a free allowance ────────────────────────────────────────
//
// A free key is rationed by requests, not money, and the loop spends them
// faster than it looks: one turn is one request, a delegation is a whole
// sub-run, and every web_search adds a nested call. These are the guards that
// make "無料枠だけで回す" a property of the code rather than a hope.
console.log("\n=== Free-tier guard ===\n");

function envScope<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const before: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const noKeys = { GEMINI_API_KEY: undefined, GOOGLE_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined, OPENAI_API_KEY: undefined, FRIDAY_PROVIDER: undefined, FRIDAY_MODEL: undefined, FRIDAY_WORKER_MODEL: undefined, FRIDAY_SEARCH_PROVIDER: undefined, FRIDAY_TEST_TRANSPORT: undefined };


// Allowances reset at midnight Pacific — not JST, not UTC. Getting this wrong
// means the counter rolls over at the wrong time and overshoots.
check(
  "the quota day is the Pacific day, not the local one",
  // 2026-07-01 05:00 UTC is still 2026-06-30 in Los Angeles (UTC-7).
  pacificDay(Date.UTC(2026, 6, 1, 5, 0)) === "2026-06-30",
  pacificDay(Date.UTC(2026, 6, 1, 5, 0)),
);
check(
  "and rolls over at Pacific midnight",
  pacificDay(Date.UTC(2026, 6, 1, 8, 0)) === "2026-07-01",
  pacificDay(Date.UTC(2026, 6, 1, 8, 0)),
);
// JST is the company's own clock for its daily jobs; these must not be the
// same value, or one of them is using the wrong zone.
check(
  "the company's JST day is tracked separately",
  pacificDay(Date.UTC(2026, 6, 1, 5, 0)) !== "2026-07-01",
);

mutate((st) => {
  st.quota = undefined;
});

// The budget must be booked on reserve, not counted afterwards: two runs
// starting together would otherwise both see the same remaining count.
const budgetEnv = {
  FRIDAY_FREE_TIER: "true",
  FRIDAY_DAILY_REQUEST_BUDGET: "3",
  FRIDAY_REQUESTS_PER_MINUTE: "0",
  FRIDAY_TEST_TRANSPORT: undefined,
  GEMINI_API_KEY: "AIza-x",
};

const verdicts = envScope(budgetEnv, () => [reserve(), reserve(), reserve(), reserve()]);
check("requests inside the budget are allowed", verdicts.slice(0, 3).every((v) => v.ok));
check("the one past it is refused", verdicts[3].ok === false);
check("and says why, with the numbers", verdicts[3].reason?.includes("3/3") === true, verdicts[3].reason?.slice(0, 40));
check("the count is persisted, not held in memory", quota().requests === 3, String(quota().requests));

// Asking is not spending. A run about to be refused should not pay for being
// told so.
const asked = envScope(budgetEnv, () => quotaVerdict());
check("checking the allowance consumes none of it", asked.ok === false && quota().requests === 3);

// A run must be refused before it opens, not three steps in with half-done
// work and requests already spent.
const refusedRun = await envScope(budgetEnv, () =>
  runAgent({ agentId: "market_ai", objective: "市場を調べて", canDelegate: false, canReport: false }),
);
check("a run is refused before it starts", refusedRun.status === "failed", refusedRun.status);
check("without opening a run record", refusedRun.runId === "", refusedRun.runId);
check("and the reason names the limit", refusedRun.error?.includes("上限") === true, refusedRun.error?.slice(0, 40));
check(
  "the CEO sees it in the activity feed",
  readState().activity.some((e) => e.message.includes("無料枠の上限のため")),
);

// The published free-tier numbers disagree and move, so the hard stop is not
// guessed: the API's own 429 is believed and ends the day.
mutate((st) => {
  st.quota = undefined;
});
const beforeLearning = envScope({ ...budgetEnv, FRIDAY_DAILY_REQUEST_BUDGET: "1000" }, () =>
  quotaVerdict(),
);
check("with budget to spare, work proceeds", beforeLearning.ok === true);
markExhausted();
const afterLearning = envScope({ ...budgetEnv, FRIDAY_DAILY_REQUEST_BUDGET: "1000" }, () =>
  quotaVerdict(),
);
check("a daily 429 from the API stops the rest of the day", afterLearning.ok === false);
check("even with budget left on the self-imposed limit", afterLearning.reason?.includes("使い切りました") === true, afterLearning.reason?.slice(0, 30));
check("and says when it comes back", afterLearning.reason?.includes("太平洋時間") === true);

// A new Pacific day is a new allowance, including after an API-reported cap.
mutate((st) => {
  if (st.quota) st.quota.day = "2000-01-01";
});
const nextDay = envScope(budgetEnv, () => quotaVerdict());
check("a new Pacific day clears the stop", nextDay.ok === true);

// Per-minute pacing: waiting a few seconds beats a 429 that abandons a run.
mutate((st) => {
  st.quota = undefined;
});
const paced = envScope(
  { ...budgetEnv, FRIDAY_DAILY_REQUEST_BUDGET: "0", FRIDAY_REQUESTS_PER_MINUTE: "2" },
  () => [reserve(), reserve(), reserve()],
);
check("requests within the per-minute rate pass", paced[0].ok && paced[1].ok);
check("the next one is held rather than refused outright", paced[2].ok === false && typeof paced[2].waitMs === "number");
check("and the wait is under a minute", (paced[2].waitMs ?? 0) <= 60_250, String(paced[2].waitMs));

// Pacing *at* the published ceiling was the mistake: the service counts
// everything the key was charged for, including another app sharing it, so
// the real limit is only ever discovered by being refused. The refusal parks
// every caller for the hold the service named and lowers the rate we pace
// against — but it must never raise a rate the operator set, and never
// collapse to nothing because of one bad minute.
mutate((st) => {
  st.quota = undefined;
});
const learned = envScope(
  { ...budgetEnv, FRIDAY_DAILY_REQUEST_BUDGET: "0", FRIDAY_REQUESTS_PER_MINUTE: "12" },
  () => {
    reserve();
    reserve();
    reserve();
    notePerMinuteLimit(1_000);
    return reserve();
  },
);
check("a refusal parks the next request", learned.ok === false, learned.reason?.slice(0, 24));
check("for the hold the service named", (learned.waitMs ?? 0) <= 1_500, String(learned.waitMs));
check("and the learned rate drops below where it was refused", (quota().learnedRpm ?? 99) < 12, String(quota().learnedRpm));
check("but never collapses to nothing", (quota().learnedRpm ?? 0) >= 5, String(quota().learnedRpm));

// The floor protects the learned value only. A rate the operator set
// explicitly is a cap, and nothing in here may lift it.
mutate((st) => {
  st.quota = { day: pacificDay(), requests: 0, exhausted: false, recent: [], learnedRpm: 1 };
});
const explicitCap = envScope(
  { ...budgetEnv, FRIDAY_DAILY_REQUEST_BUDGET: "0", FRIDAY_REQUESTS_PER_MINUTE: "2" },
  () => [reserve(), reserve(), reserve()],
);
check("an explicit rate still binds under a learned floor", explicitCap[0].ok && explicitCap[1].ok && explicitCap[2].ok === false);

// A hold that outlasts the caller's ceiling is reported with when it comes
// back, rather than holding a serverless invocation open past its deadline.
mutate((st) => {
  st.quota = {
    day: pacificDay(),
    requests: 0,
    exhausted: false,
    recent: [],
    pausedUntil: Date.now() + 600_000,
  };
});
const tooLong = await envScope({ ...budgetEnv, FRIDAY_DAILY_REQUEST_BUDGET: "0" }, () =>
  reserveWithWait(1_000),
);
check("a hold past the ceiling is reported, not waited out", tooLong.ok === false);
check("and says it resumes by itself", tooLong.reason?.includes("自動で再開") === true, tooLong.reason?.slice(0, 40));

// The guard belongs to the free tier; a paid key should not be throttled.
const paid = envScope(
  { ...budgetEnv, FRIDAY_FREE_TIER: undefined, GEMINI_API_KEY: undefined, ANTHROPIC_API_KEY: "sk-ant-x" },
  () => getConfig(),
);
check("a paid provider is not guarded by default", paid.freeTierGuard === false);
const freeByDefault = envScope(
  { ...budgetEnv, FRIDAY_FREE_TIER: undefined, ANTHROPIC_API_KEY: undefined },
  () => getConfig(),
);
check("and Gemini is, without being asked", freeByDefault.freeTierGuard === true);

// Two instances spending one allowance must not lose count. Erring upward is
// the safe direction: under-counting overshoots the quota.
const mergedQuota = mergeState(
  { ...readState(), quota: { day: "2026-07-01", requests: 40, exhausted: false, recent: [] } },
  { ...readState(), quota: { day: "2026-07-01", requests: 25, exhausted: true, recent: [] } },
);
check("concurrent counts merge upward, never down", mergedQuota.quota?.requests === 40, String(mergedQuota.quota?.requests));
check("and an API-reported cap survives the merge", mergedQuota.quota?.exhausted === true);

mutate((st) => {
  st.quota = undefined;
});

// Lite everywhere by default: it is the cheapest model with the largest
// request allowance, which is what actually binds on a free key.
const lite = envScope(
  { ...noKeys, GEMINI_API_KEY: "AIza-x" },
  () => getConfig(),
);
// Asserted as a property rather than a string: the exact id will change
// again, and a test pinned to it would fail for the wrong reason.
const isLite = (id: string) => id.includes("flash-lite") && !id.startsWith("gemini-2.");
check("the executives run on Flash-Lite by default", isLite(lite.model), lite.model);
check("so do the specialists", isLite(lite.workerModel), lite.workerModel);
check("and so do the nested search calls", isLite(lite.searchModel), lite.searchModel);
// Reasoning tokens bill as output and eat the per-minute token allowance.
check("thinking defaults to low, not medium", lite.thinking === "low", lite.thinking);
// Raising only the executives must stay possible.
const raised = envScope(
  { ...noKeys, GEMINI_API_KEY: "AIza-x", GEMINI_MODEL: "gemini-3.6-flash" },
  () => getConfig(),
);
check(
  "the executives can be raised on their own",
  raised.model === "gemini-3.6-flash" && isLite(raised.workerModel),
  `${raised.model} / ${raised.workerModel}`,
);

// ── Surviving a retired model id ───────────────────────────────────────────
//
// This is the failure that already happened once: the 2.5 line this shipped
// against was announced for October and was already 404ing for new projects
// months earlier. A pinned id is a dated fuse, so a 404 is answered from the
// live model list instead of ending the run.
console.log("\n=== Retired model recovery ===\n");

const lineup = [
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.1-pro-preview",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
];

check("a live id is returned unchanged", pickModel("gemini-3.1-flash-lite", lineup) === "gemini-3.1-flash-lite");
// A full listing carries version suffixes the config would not name.
check("a version-suffixed listing still matches", pickModel("gemini-3.1-flash-lite", ["gemini-3.1-flash-lite-001"]) === "gemini-3.1-flash-lite-001");

// The replacement must stay in the same tier. Repairing a Flash-Lite outage
// with a Pro model would work and quietly cost ten times as much.
check(
  "a retired Flash-Lite is replaced by the newest Flash-Lite",
  pickModel("gemini-2.5-flash-lite", lineup) === "gemini-3.5-flash-lite",
  String(pickModel("gemini-2.5-flash-lite", lineup)),
);
check(
  "never by a more expensive tier",
  pickModel("gemini-2.5-flash-lite", ["gemini-3.1-pro-preview", "gemini-3.5-flash-lite"]) === "gemini-3.5-flash-lite",
);
// Only when the tier is gone entirely does it move, and then downward in cost.
check(
  "with no Flash-Lite at all it falls to Flash, not Pro",
  pickModel("gemini-2.5-flash-lite", ["gemini-3.6-flash", "gemini-3.1-pro-preview"]) === "gemini-3.6-flash",
);
check(
  "stable is preferred over preview",
  pickModel("gemini-9-flash", ["gemini-3.6-flash", "gemini-4-flash-preview"]) === "gemini-3.6-flash",
  String(pickModel("gemini-9-flash", ["gemini-3.6-flash", "gemini-4-flash-preview"])),
);
check("a preview is taken when nothing stable exists", pickModel("gemini-9-flash", ["gemini-4-flash-preview"]) === "gemini-4-flash-preview");
check("an empty list is reported, not guessed around", pickModel("gemini-3.1-flash-lite", []) === null);

check("versions parse, including minor ones", parseModelId("gemini-3.1-flash-lite").version === 3.1);
check("and the tier is read from the id", parseModelId("gemini-3.5-flash-lite").tier === "flash-lite");
check("flash-lite is not mistaken for flash", parseModelId("gemini-3.6-flash").tier === "flash");

/* End to end: a 404 becomes a working call, once, and is remembered. */
__clearSubstitutionsForTesting();

let calls: string[] = [];
const retiringFetch = (async (url: string) => {
  const path = String(url);
  if (path.includes("/models?")) {
    return new Response(
      JSON.stringify({
        models: lineup.map((m) => ({
          name: `models/${m}`,
          supportedGenerationMethods: ["generateContent"],
        })),
      }),
      { status: 200 },
    );
  }
  const asked = /models\/([^:]+):/.exec(path)?.[1] ?? "";
  calls.push(asked);
  if (asked.startsWith("gemini-2.5")) {
    return new Response(JSON.stringify({ error: { code: 404, message: "models/x is not found" } }), {
      status: 404,
    });
  }
  return new Response('data: {"candidates":[{"content":{"parts":[{"text":"動きました"}]},"finishReason":"STOP"}]}\n\n', {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}) as unknown as typeof fetch;

const retiring = createGeminiProvider({
  apiKey: "k",
  searchModel: "gemini-2.5-flash-lite",
  fetchImpl: retiringFetch,
});

const req = {
  model: "gemini-2.5-flash-lite",
  system: "s",
  messages: [{ role: "user" as const, content: "x" }],
  tools: [],
  maxOutputTokens: 256,
  thinking: "off" as const,
};

const after404 = await retiring.send(req);
check("a retired model does not end the run", after404.blocks[0]?.type === "text", after404.stopReason);
check("the retired id was tried, then the replacement", calls.join(" → ") === "gemini-2.5-flash-lite → gemini-3.5-flash-lite", calls.join(" → "));
check("and the swap is recorded, not hidden", modelSubstitutions()["gemini-2.5-flash-lite"] === "gemini-3.5-flash-lite");

// The lookup happens once: a per-request 404 would double every call.
calls = [];
await retiring.send(req);
check("the next call goes straight to the replacement", calls.join("") === "gemini-3.5-flash-lite", calls.join(" → "));

__clearSubstitutionsForTesting();

// The default must not be a model that is already being retired.
const current = envScope({ ...noKeys, GEMINI_API_KEY: "AIza-x" }, () => getConfig());
check(
  "the default model is not from the retired 2.5 line",
  !current.model.startsWith("gemini-2.5"),
  current.model,
);
check("and is a Flash-Lite", current.model.includes("flash-lite"), current.model);

// ── Changing provider later ────────────────────────────────────────────────
//
// The point of the provider seam: a different backend is a setting, not an
// edit. Each of the three is exercised through the same interface the loop
// uses, so "it compiles" is not the standard being met here.
console.log("\n=== Switching provider ===\n");

// Setting a key is enough — the provider does not have to be named twice.
const auto = envScope({ ...noKeys, GEMINI_API_KEY: "AIza-x" }, () => getConfig());
check("a Gemini key alone selects Gemini", auto.provider === "gemini", auto.provider);
check("and brings Gemini's model defaults", auto.model.startsWith("gemini-"), auto.model);

const autoClaude = envScope({ ...noKeys, ANTHROPIC_API_KEY: "sk-ant-x" }, () => getConfig());
check("an Anthropic key alone selects Claude", autoClaude.provider === "anthropic", autoClaude.provider);
// Model ids only mean something to their own provider, so the defaults move too.
check("and brings Claude's model defaults", autoClaude.model.startsWith("claude-"), autoClaude.model);
check("including a cheaper model for delegated work", autoClaude.workerModel.startsWith("claude-"), autoClaude.workerModel);

// Naming it explicitly wins over detection, even with several keys present.
const named = envScope(
  { ...noKeys, GEMINI_API_KEY: "AIza-x", ANTHROPIC_API_KEY: "sk-ant-x", FRIDAY_PROVIDER: "anthropic" },
  () => getConfig(),
);
check("FRIDAY_PROVIDER overrides detection", named.provider === "anthropic", named.provider);
check("and the key for that provider is the one used", named.apiKey === "sk-ant-x");
const aliased = envScope({ ...noKeys, ANTHROPIC_API_KEY: "k", FRIDAY_PROVIDER: "claude" }, () => getConfig());
check("the name people actually say also works", aliased.provider === "anthropic", aliased.provider);

// A leftover model id from the previous backend must not be passed through:
// it would 404 in a way that reads like a bug rather than a stale setting.
const stale = envScope(
  { ...noKeys, ANTHROPIC_API_KEY: "k", FRIDAY_PROVIDER: "anthropic", FRIDAY_MODEL: "gemini-2.5-flash" },
  () => getConfig(),
);
check("a stale Gemini id is ignored when on Claude", stale.model.startsWith("claude-"), stale.model);
const staleBack = envScope(
  { ...noKeys, GEMINI_API_KEY: "k", FRIDAY_PROVIDER: "gemini", FRIDAY_MODEL: "claude-opus-5" },
  () => getConfig(),
);
check("and a stale Claude id is ignored when on Gemini", staleBack.model.startsWith("gemini-"), staleBack.model);
// A deliberate id for the active provider is of course honoured.
const chosen = envScope(
  { ...noKeys, GEMINI_API_KEY: "k", FRIDAY_MODEL: "gemini-2.5-pro" },
  () => getConfig(),
);
check("an explicit model for the active provider is honoured", chosen.model === "gemini-2.5-pro", chosen.model);

// One file serves every OpenAI-compatible endpoint, so the base URL is the
// whole of "switching to that service" — including a model on this machine.
const local = envScope(
  {
    ...noKeys,
    OPENAI_API_KEY: "k",
    FRIDAY_PROVIDER: "openai",
    OPENAI_BASE_URL: "http://localhost:11434/v1",
    OPENAI_LABEL: "Ollama (ローカル)",
    FRIDAY_MODEL: "llama3.1",
  },
  () => getConfig(),
);
check("an OpenAI-compatible endpoint is reachable by URL alone", local.openAiBaseUrl === "http://localhost:11434/v1");
check("with its own label for the dashboard", local.openAiLabel === "Ollama (ローカル)");
check("and its own model name", local.model === "llama3.1");

// Capability is not universal. An endpoint without search borrows one if a
// key that has it is present, rather than offering a tool that always fails.
const borrowed = envScope(
  { ...noKeys, OPENAI_API_KEY: "k", GEMINI_API_KEY: "AIza-x", FRIDAY_PROVIDER: "openai", FRIDAY_MODEL: "m" },
  () => getConfig(),
);
check("search is borrowed from a provider that has it", borrowed.searchProvider === "gemini", String(borrowed.searchProvider));
const noSearch = envScope(
  { ...noKeys, OPENAI_API_KEY: "k", FRIDAY_PROVIDER: "openai", FRIDAY_MODEL: "m" },
  () => getConfig(),
);
check("and is simply absent when nothing can supply it", noSearch.searchProvider === null, String(noSearch.searchProvider));

// A blank key is not an absent key. This is the bug that made the company run
// on a provider nobody chose: an empty GEMINI_API_KEY fell through to a
// leftover Claude key with no credit on it, and the error then named a billing
// problem for a service that was no longer in use.
const blank = envScope(
  { ...noKeys, GEMINI_API_KEY: "", ANTHROPIC_API_KEY: "sk-ant-leftover" },
  () => getConfig(),
);
check("a blank key does not hand the company to another provider", blank.provider === "gemini", blank.provider);
check("and is reported as blank, not missing", blank.keyBlank === true);
check("so the company stays in demo mode rather than billing elsewhere", blank.mode === "demo", blank.mode);
check("the leftover key is still visible as leftover", blank.keyStatus.anthropic === "set", blank.keyStatus.anthropic);

// Whitespace is the same mistake with a different shape.
const spaces = envScope({ ...noKeys, GEMINI_API_KEY: "   ", ANTHROPIC_API_KEY: "sk-ant-x" }, () => getConfig());
check("whitespace counts as blank too", spaces.provider === "gemini" && spaces.keyBlank === true);

// A genuinely absent variable should still fall through, which is the feature.
const absent = envScope({ ...noKeys, ANTHROPIC_API_KEY: "sk-ant-x" }, () => getConfig());
check("an absent key still falls through as intended", absent.provider === "anthropic", absent.provider);
check("and is not called blank", absent.keyBlank === false);

// Asking for a provider explicitly always wins, blank or not.
const explicit = envScope(
  { ...noKeys, GEMINI_API_KEY: "", ANTHROPIC_API_KEY: "sk-ant-x", FRIDAY_PROVIDER: "anthropic" },
  () => getConfig(),
);
check("an explicit choice is still honoured", explicit.provider === "anthropic" && explicit.mode === "live");

// The run must say the key is blank, not that it is unset — the difference is
// the whole fix, since "unset" sends someone to create a key they already have.
const blankRun = await envScope({ ...noKeys, GEMINI_API_KEY: "", ANTHROPIC_API_KEY: "sk-ant-x" }, () =>
  runAgent({ agentId: "coo", objective: "状況を教えて", canDelegate: false, canReport: false }),
);
check("the failure says the key is blank", blankRun.error?.includes("値が空") === true, blankRun.error?.slice(0, 40));
check("and that a redeploy is needed", blankRun.error?.includes("再デプロイ") === true);

/* The three providers, each driven through the loop's own interface. */

const anthropicProvider = createAnthropicProvider({
  apiKey: "sk-ant-test",
  searchModel: "claude-haiku-4-5-20251001",
  searchTool: "web_search_20260209",
  executeTool: "code_execution_20260521",
  fetchImpl: (async (_u: string, init: RequestInit) => {
    claudeBody = JSON.parse(String(init.body));
    claudeHeaders = init.headers as Record<string, string>;
    return new Response(
      JSON.stringify({
        content: [
          { type: "text", text: "承知しました。" },
          { type: "tool_use", id: "toolu_1", name: "log_progress", input: { message: "開始" } },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 2000, output_tokens: 50, cache_read_input_tokens: 1800 },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch,
});

let claudeBody: Record<string, never> = {} as never;
let claudeHeaders: Record<string, string> = {};

const claudeTurn = await anthropicProvider.send({
  model: "claude-opus-5",
  system: "[ROLE] COO — テスト",
  messages: [
    { role: "user", content: "状況を教えて" },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "log_progress", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", name: "log_progress", content: "ok" }] },
  ],
  tools: companyToolsFor({ agentId: "coo", canDelegate: true, canReport: true }),
  maxOutputTokens: 4096,
  thinking: "high",
});

const cb = claudeBody as unknown as {
  system: { type: string; text: string; cache_control?: unknown }[];
  tools?: { name: string; input_schema: Record<string, unknown> }[];
  messages: { role: string; content: unknown }[];
};
check("Claude gets the key as x-api-key", claudeHeaders["x-api-key"] === "sk-ant-test");
check("and the required version header", claudeHeaders["anthropic-version"] === "2023-06-01");
// The 48 employees re-send a long system prompt every turn; caching it is the
// largest saving available on this provider.
check("the shared system prompt is marked cacheable", Boolean(cb.system[0].cache_control));
// Unlike Gemini, this API takes JSON Schema as written.
check("tool schemas pass through untouched", "additionalProperties" in (cb.tools?.[0].input_schema ?? {}));
check("tool results stay keyed by id", JSON.stringify(cb.messages[2]).includes("t1"));
check("a tool call comes back as a tool_use", claudeTurn.blocks[1]?.type === "tool_use");
check("cache reads are reported", claudeTurn.usage.cachedTokens === 1800);

let oaiBody: Record<string, never> = {} as never;
const openAiProvider = createOpenAiProvider({
  apiKey: "k",
  baseUrl: "http://localhost:11434/v1",
  label: "Ollama",
  fetchImpl: (async (_u: string, init: RequestInit) => {
    oaiBody = JSON.parse(String(init.body));
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: "確認します",
              tool_calls: [
                { id: "call_1", function: { name: "log_progress", arguments: '{"message":"開始"}' } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 900, completion_tokens: 30 },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch,
});

const oaiTurn = await openAiProvider.send({
  model: "llama3.1",
  system: "[ROLE] COO — テスト",
  messages: [
    { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "log_progress", input: { a: 1 } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", name: "log_progress", content: "ok" }] },
  ],
  tools: [{ name: "log_progress", description: "d", parameters: { type: "object", properties: {} } }],
  maxOutputTokens: 1024,
  thinking: "off",
});

const ob = oaiBody as unknown as {
  messages: { role: string; content?: unknown; tool_calls?: { function: { arguments: string } }[] }[];
  tools?: { type: string; function: { name: string } }[];
};
check("the system prompt becomes a system message", ob.messages[0].role === "system");
// This shape differs most: calls hang off the assistant message with
// stringified arguments, and each result is its own role:"tool" message.
check("tool call arguments are stringified", typeof ob.messages[1].tool_calls?.[0].function.arguments === "string");
check("each tool result becomes its own message", ob.messages[2].role === "tool");
check("tools are wrapped as type:function", ob.tools?.[0].type === "function");
check("a tool call comes back as a tool_use", oaiTurn.blocks[1]?.type === "tool_use");
check("and keeps the endpoint's own call id", oaiTurn.blocks[1]?.type === "tool_use" && oaiTurn.blocks[1].id === "call_1");
check("this backend declares no search", openAiProvider.capabilities.search === false);
check("so the tool is withheld rather than offered broken", typeof openAiProvider.search !== "function");

// Unparseable arguments are the same failure Gemini reports as
// MALFORMED_FUNCTION_CALL, and must stop the run rather than loop.
const brokenArgs = fromCompletion({
  choices: [
    {
      finish_reason: "tool_calls",
      message: { tool_calls: [{ id: "x", function: { name: "f", arguments: "{not json" } }] },
    },
  ],
});
check("broken arguments stop the run, not loop it", brokenArgs.stopReason === "malformed_tool_call");

// The transcript shape is the reason a paused run survives a provider change.
const paused: Parameters<typeof toAnthropicMessages>[0] = [
  { role: "assistant", content: [{ type: "tool_use", id: "t9", name: "send_email", input: { to: ["a@b.c"] } }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "t9", name: "send_email", content: "承認待ち" }] },
];
check("a transcript paused on one provider converts for Claude", JSON.stringify(toAnthropicMessages(paused)).includes("send_email"));
check("and for Gemini", JSON.stringify(toGeminiContents(paused)).includes("send_email"));
check("and for an OpenAI-compatible endpoint", JSON.stringify(toOpenAiMessages("s", paused)).includes("send_email"));

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
