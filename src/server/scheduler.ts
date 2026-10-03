import "server-only";

import { getConfig } from "@/server/runtime/config";
import { mutate, read } from "@/server/runtime/store";
import { runAgent } from "@/server/agents/runner";
import { AGENTS_BY_ID, EXECUTIVE_IDS } from "@/lib/company/agents";
import { DEFAULT_SCHEDULE } from "@/lib/company/reports";
import type { MeetingReport } from "@/lib/types";

/**
 * The company's recurring work.
 *
 * Jobs are keyed by day, not by timer: a job records the JST day it last ran
 * for, and running it again that day is a no-op. That is what makes it safe to
 * trigger this from several places at once — a platform cron, the dashboard
 * while a tab is open, or the CEO pressing "Run now" — without ever doing the
 * work twice. Nothing here needs a process that stays alive between firings.
 */

export interface JobRun {
  id: string;
  ranFor: string;
  at: number;
  ok: boolean;
  detail: string;
}

export interface JobResult {
  id: string;
  /**
   * "waiting" is its own outcome. A job whose agent stopped at the approval
   * gate did its work — it produced a decision for the CEO — and calling that
   * a failure both reads as a bug and buries the thing being asked.
   */
  status: "ran" | "waiting" | "skipped" | "failed" | "not_due";
  detail: string;
}

/** Wall-clock JST, which is the timezone the whole company is authored in. */
function jstNow(at: number): { day: string; minutes: number; weekday: string } {
  const shifted = new Date(at + 9 * 3_600_000);
  return {
    day: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    weekday: WEEKDAYS[shifted.getUTCDay()],
  };
}

function parseHHMM(value: string): number {
  const [hh, mm] = value.split(":").map(Number);
  return hh * 60 + mm;
}

function record(run: JobRun): void {
  mutate((s) => {
    s.jobs = [run, ...(s.jobs ?? [])].slice(0, 100);
  });
}

export function jobHistory(): JobRun[] {
  return read((s) => [...(s.jobs ?? [])]);
}

/** Weekday names as the schedule config writes them. */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface JobSpec {
  id: string;
  /** JST "HH:MM" after which the job may run. */
  at: string;
  /**
   * Restricts the job to one weekday, as the schedule names it. The period key
   * is still the JST date, so a weekly job naturally dedupes on its own date.
   */
  weekday?: string;
  /** What to say when it runs. */
  label: string;
}

/**
 * Runs a job at most once per period, whoever asks.
 *
 * The period is the JST day, which is also the key a weekly job dedupes on —
 * its occurrence falls on one date, so the same mechanism covers both without
 * a second concept.
 *
 * The slot is claimed before the work starts, not after, so two triggers
 * arriving together cannot both decide they are the one to run it. That
 * matters more here than it looks: a platform cron, an open dashboard and the
 * CEO pressing a button can all ring this within the same second.
 */
async function runJob(
  spec: JobSpec,
  work: () => Promise<{ ok: boolean; detail: string; waiting?: boolean }>,
  force = false,
): Promise<JobResult> {
  const cfg = getConfig();
  const at = Date.now();
  const { day, minutes, weekday } = jstNow(at);

  if (!cfg.hasApiKey) {
    return { id: spec.id, status: "skipped", detail: "デモ動作のためスキップしました。" };
  }
  if (!force && spec.weekday && weekday !== spec.weekday) {
    return { id: spec.id, status: "not_due", detail: `毎週${spec.weekday}に実行します。` };
  }
  if (!force && minutes < parseHHMM(spec.at)) {
    return { id: spec.id, status: "not_due", detail: `${spec.at} JST に実行します。` };
  }

  const claimed = mutate((s) => {
    s.jobs ??= [];
    if (!force && s.jobs.some((j) => j.id === spec.id && j.ranFor === day)) return false;
    s.jobs = [{ id: spec.id, ranFor: day, at, ok: false, detail: "実行中" }, ...s.jobs].slice(0, 100);
    return true;
  });
  if (!claimed) {
    return { id: spec.id, status: "skipped", detail: `${day} 分は実行中または完了済みです。` };
  }

  try {
    const outcome = await work();
    record({ id: spec.id, ranFor: day, at: Date.now(), ok: outcome.ok, detail: outcome.detail.slice(0, 160) });
    return {
      id: spec.id,
      status: outcome.waiting ? "waiting" : outcome.ok ? "ran" : "failed",
      detail: outcome.waiting ? outcome.detail : outcome.ok ? spec.label : outcome.detail,
    };
  } catch (error) {
    const message = (error as Error).message ?? "unknown";
    record({ id: spec.id, ranFor: day, at: Date.now(), ok: false, detail: message.slice(0, 160) });
    return { id: spec.id, status: "failed", detail: message };
  }
}

/**
 * Turns an agent run into the outcome the job recorder wants.
 *
 * A run that halted at the approval gate counts as done: the job's output is
 * an approval request sitting in the CEO's queue. Recording it as a failure
 * would make a working gate look like a broken job, and would hide the ask.
 */
async function asJob(
  run: Promise<{ status: string; text: string; error?: string }>,
): Promise<{ ok: boolean; detail: string; waiting?: boolean }> {
  const result = await run;
  if (result.status === "completed") return { ok: true, detail: result.text };
  if (result.status === "waiting_for_ceo") {
    return { ok: true, waiting: true, detail: `CEO承認待ち: ${result.text}` };
  }
  return { ok: false, detail: result.error ?? result.status };
}

/* ── The daily note article ───────────────────────────────────────────────── */

const NOTE_JOB = "note-daily-draft";

/**
 * Every evening, Content AI writes the next note article.
 *
 * It goes out as a document for the CEO to post — note has no official write
 * API — so the job can run unattended without anything reaching the outside
 * world. The CEO finds a finished article waiting, not a prompt to write one.
 */
export function runDailyNoteDraft(force = false): Promise<JobResult> {
  return runJob(
    { id: NOTE_JOB, at: getConfig().note.dailyDraftAt, label: "note記事の下書きを作成しました。" },
    () =>
      asJob(
        runAgent({
          agentId: "content_ai",
          objective: [
            "今日の note 記事を1本書いてください。",
            "",
            "手順:",
            "1. search_knowledge でブランドの文体と過去に出した記事を確認する。同じ話を繰り返さない。",
            "2. get_company_data で会社の実際の動きを読み、書く価値のある題材を選ぶ。",
            "3. write_note_article に完成原稿を渡す。読者が最後まで読める長さにまとめる。",
            "",
            "会社の宣伝ではなく、読んだ人が持ち帰れるものがある記事にしてください。",
            "数字に触れるときは必ず実際に読んだデータだけを使ってください。",
          ].join("\n"),
          canDelegate: false,
          canReport: false,
        }),
      ),
    force,
  );
}

/* ── The morning briefing ─────────────────────────────────────────────────── */

const BRIEFING_JOB = "morning-briefing";

/**
 * What the CEO reads first.
 *
 * The dashboard has shown a scheduled morning briefing since the company was
 * built, and nothing ever produced one. It is written as a report because
 * that is the surface the schedule already links to — the briefing was a dead
 * link, not a missing screen.
 *
 * Deliberately not a summary of everything: the morning's value is the short
 * list of things only the CEO can decide, which is also the one thing a
 * dashboard full of panels does not say.
 */
export function runMorningBriefing(force = false): Promise<JobResult> {
  return runJob(
    { id: BRIEFING_JOB, at: DEFAULT_SCHEDULE.morningBriefing, label: "朝のブリーフィングを作成しました。" },
    () =>
      asJob(
        runAgent({
          agentId: "coo",
          objective: [
            "CEOが今日いちばん最初に読む「朝のブリーフィング」を作成してください。",
            "",
            "手順:",
            "1. get_company_data で overview・tasks・projects を実際に読む。",
            "2. CEOの承認を待っている項目、期限が迫っている項目、止まっている項目を特定する。",
            "3. submit_report で type=daily として提出する。タイトルは「朝のブリーフィング」で始める。",
            "",
            "全部を要約しないでください。CEOにしか決められないことを先に、",
            "次に今日の注意点、最後に各部署の状況を1行ずつ。",
            "読んだデータに無い数値は書かないでください。",
          ].join("\n"),
          canDelegate: false,
          canReport: true,
        }),
      ),
    force,
  );
}

/* ── The daily report ─────────────────────────────────────────────────────── */

const DAILY_JOB = "daily-report";

/** The day's result, written at the end of it. Also a dead link until now. */
export function runDailyReport(force = false): Promise<JobResult> {
  return runJob(
    { id: DAILY_JOB, at: DEFAULT_SCHEDULE.dailyReport, label: "日報を作成しました。" },
    () =>
      asJob(
        runAgent({
          agentId: "coo",
          objective: [
            "今日の日報を作成してください。",
            "",
            "手順:",
            "1. get_company_data で overview・tasks・analytics を実際に読む。",
            "2. 今日完了したこと、進まなかったこと、その理由を分けて書く。",
            "3. submit_report で type=daily として提出する。",
            "",
            "結論から書き、明日の最優先を1つだけ挙げてください。",
            "数値は読み取った値だけを使ってください。",
          ].join("\n"),
          canDelegate: false,
          canReport: true,
        }),
      ),
    force,
  );
}

/* ── The weekly board meeting ─────────────────────────────────────────────── */

const BOARD_JOB = "weekly-board";

/**
 * Eight executives reporting a week, which does not fit in one request.
 *
 * Each section is a whole agent run, and eight of them in sequence would pass
 * the function's time limit long before the last one finished. So the meeting
 * is assembled over several invocations: each call takes the next few
 * executives who have not reported yet, and the meeting closes when the last
 * one is in. Whatever rings the scheduler next — the cron, an open dashboard,
 * the CEO — carries it forward, which is the same property the day-keyed jobs
 * already rely on.
 *
 * It is keyed by the date of its own occurrence, so a part-finished meeting is
 * resumed rather than restarted.
 */
const BOARD_BATCH = 2;

export async function runWeeklyBoard(force = false): Promise<JobResult> {
  const cfg = getConfig();
  const { day, minutes, weekday } = jstNow(Date.now());

  if (!cfg.hasApiKey) {
    return { id: BOARD_JOB, status: "skipped", detail: "デモ動作のためスキップしました。" };
  }
  if (!force && weekday !== DEFAULT_SCHEDULE.weeklyBoardDay) {
    return {
      id: BOARD_JOB,
      status: "not_due",
      detail: `毎週${DEFAULT_SCHEDULE.weeklyBoardDay}に実行します。`,
    };
  }
  if (!force && minutes < parseHHMM(DEFAULT_SCHEDULE.weeklyBoard)) {
    return { id: BOARD_JOB, status: "not_due", detail: `${DEFAULT_SCHEDULE.weeklyBoard} JST に実行します。` };
  }

  const id = `board-${day}`;

  // The meeting record is created on first touch, then filled in across calls.
  const existing = mutate((s) => {
    s.meetings ??= [];
    let meeting = s.meetings.find((m) => m.id === id);
    if (!meeting) {
      meeting = {
        id,
        title: `Weekly Board Meeting — ${day}`,
        at: Date.now(),
        status: "scheduled",
        reports: [],
        summary: "",
        decisions: [],
      };
      s.meetings = [meeting, ...s.meetings].slice(0, 30);
    }
    return { done: meeting.reports.map((r) => r.agentId), status: meeting.status };
  });

  if (existing.status === "completed" && !force) {
    return { id: BOARD_JOB, status: "skipped", detail: `${day} の役員会は完了しています。` };
  }

  const pending = EXECUTIVE_IDS.filter((agentId) => !existing.done.includes(agentId));

  // Each batch is one invocation's worth of work.
  for (const agentId of pending.slice(0, BOARD_BATCH)) {
    const result = await runAgent({
      agentId,
      objective: [
        "週次の役員会で、CEOへ1週間の結果を報告してください。",
        "",
        "手順:",
        "1. get_company_data で自分の担当範囲のタスク・プロジェクト・分析データを実際に読む。",
        "2. 次の形式そのままで答える。前置きも結びも書かない。",
        "",
        "1行目: 見出し（この1週間を1文で。40字以内）",
        "2行目以降: 箇条書きで3点まで。各行を「- 」で始める。",
        "最終行: 「指標: ラベル=値」の形で、読み取った数値を1つだけ。",
        "",
        "読んだデータに無い数値は書かないでください。",
      ].join("\n"),
      canDelegate: false,
      canReport: false,
    });

    // An executive who could not report still takes its slot, saying why.
    // Skipping it would leave the meeting one section short of closing, and
    // every later ring would retry the same stuck run — a board meeting that
    // can never finish, for the rest of the week.
    const section =
      result.status === "completed" && result.text.trim()
        ? parseBoardSection(agentId, result.text)
        : {
            agentId,
            area: AGENTS_BY_ID[agentId]?.department ?? "strategy",
            headline:
              result.status === "waiting_for_ceo"
                ? "報告がCEO承認待ちで止まりました"
                : `報告できませんでした（${result.error ?? result.status}）`,
            points: [],
          };

    mutate((s) => {
      const meeting = s.meetings?.find((m) => m.id === id);
      if (meeting && !meeting.reports.some((r) => r.agentId === agentId)) {
        meeting.reports.push(section);
      }
    });
  }

  const remaining = mutate((s) => {
    const meeting = s.meetings?.find((m) => m.id === id);
    return EXECUTIVE_IDS.length - (meeting?.reports.length ?? 0);
  });

  if (remaining > 0) {
    record({
      id: BOARD_JOB,
      ranFor: day,
      at: Date.now(),
      ok: false,
      detail: `${EXECUTIVE_IDS.length - remaining}/${EXECUTIVE_IDS.length} 名が報告済み（続きは次回）`,
    });
    return {
      id: BOARD_JOB,
      status: "ran",
      detail: `役員会を進行中: ${EXECUTIVE_IDS.length - remaining}/${EXECUTIVE_IDS.length} 名が報告済み。`,
    };
  }

  // Everyone has reported; the minutes close the meeting.
  const sections = read((s) =>
    (s.meetings?.find((m) => m.id === id)?.reports ?? [])
      .map((r) => `【${AGENTS_BY_ID[r.agentId]?.role ?? r.agentId}】${r.headline}\n${r.points.map((pt) => `- ${pt}`).join("\n")}`)
      .join("\n\n"),
  );

  const minutes_ = await runAgent({
    agentId: "minutes_ai",
    objective: [
      "週次役員会の議事録をまとめてください。各役員の報告は以下のとおりです。",
      "",
      sections,
      "",
      "次の形式そのままで答えてください。",
      "1行目: 要約（この1週間を2文で）",
      "2行目以降: 「決定: 」で始める行を、CEOが判断すべき事項ごとに1行。最大5件。",
      "",
      "報告に書かれていないことを足さないでください。",
    ].join("\n"),
    canDelegate: false,
    canReport: false,
  });

  const { summary, decisions } = parseMinutes(minutes_.text);
  const absent = read(
    (s) =>
      s.meetings
        ?.find((m) => m.id === id)
        ?.reports.filter((r) => r.points.length === 0)
        .map((r) => AGENTS_BY_ID[r.agentId]?.role ?? r.agentId) ?? [],
  );
  mutate((s) => {
    const meeting = s.meetings?.find((m) => m.id === id);
    if (meeting) {
      meeting.summary =
        absent.length > 0 ? `${summary}（未報告: ${absent.join("・")}）` : summary;
      meeting.decisions = decisions;
      meeting.status = "completed";
      meeting.at = Date.now();
    }
  });

  record({ id: BOARD_JOB, ranFor: day, at: Date.now(), ok: true, detail: summary.slice(0, 160) });
  return { id: BOARD_JOB, status: "ran", detail: "週次役員会をまとめました。" };
}

/**
 * Reads an executive's reply into a meeting section.
 *
 * A model asked for a fixed shape mostly produces it and sometimes decorates
 * it, so the parser is lenient: bullets lose their markers, a missing metric is
 * simply absent, and anything unrecognised still lands as a point rather than
 * being dropped. Exported for the self-test, which is where the shapes that
 * actually arrive get pinned down.
 */
export function parseBoardSection(agentId: string, text: string): MeetingReport {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const metricLine = lines.find((l) => /^指標[:：]/.test(l));
  const body = lines.filter((l) => l !== metricLine);

  const headline = (body[0] ?? "報告").replace(/^[-・*\s]+/, "").slice(0, 120);
  const points = body
    .slice(1)
    .map((l) => l.replace(/^[-・*\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 3);

  let metric: MeetingReport["metric"];
  if (metricLine) {
    const raw = metricLine.replace(/^指標[:：]\s*/, "");
    const [label, value] = raw.split("=").map((v) => v?.trim());
    if (label && value) metric = { label, value };
  }

  return {
    agentId,
    area: AGENTS_BY_ID[agentId]?.department ?? "strategy",
    headline,
    points,
    ...(metric ? { metric } : {}),
  };
}

export function parseMinutes(text: string): { summary: string; decisions: string[] } {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const decisions = lines
    .filter((l) => /^決定[:：]/.test(l))
    .map((l) => l.replace(/^決定[:：]\s*/, ""))
    .filter(Boolean)
    .slice(0, 5);

  const summary = lines.filter((l) => !/^決定[:：]/.test(l)).join(" ").slice(0, 400);
  return { summary: summary || "（要約なし）", decisions };
}

/* ── The dispatcher ───────────────────────────────────────────────────────── */

/**
 * Everything due right now.
 *
 * Every trigger calls this, not a specific job, which is what makes a late
 * ring still useful: a job that was due at 08:00 and is first asked about at
 * 22:00 runs then. That matters because the platform's free plan allows very
 * few scheduled firings, so most days some of these are picked up late rather
 * than on the minute.
 *
 * Sequential on purpose. These are the same requests the CEO's own commands
 * need, and running four agents at once against a free allowance is how a
 * morning briefing costs the whole day.
 */
export async function runDueJobs(): Promise<JobResult[]> {
  const results: JobResult[] = [];
  for (const job of [runMorningBriefing, runDailyNoteDraft, runDailyReport, runWeeklyBoard]) {
    results.push(await job());
  }
  return results;
}

/** Jobs the dashboard offers as "run now", in the order they are shown. */
export const JOBS = [
  { id: BRIEFING_JOB, label: "朝のブリーフィング", at: DEFAULT_SCHEDULE.morningBriefing, run: runMorningBriefing },
  { id: NOTE_JOB, label: "note記事の下書き", at: "17:00", run: runDailyNoteDraft },
  { id: DAILY_JOB, label: "日報", at: DEFAULT_SCHEDULE.dailyReport, run: runDailyReport },
  { id: BOARD_JOB, label: "週次役員会", at: DEFAULT_SCHEDULE.weeklyBoard, run: runWeeklyBoard },
] as const;
