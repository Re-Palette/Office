import "server-only";

import { getConfig } from "@/server/runtime/config";
import { mutate, read } from "@/server/runtime/store";
import { runAgent } from "@/server/agents/runner";

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
  status: "ran" | "skipped" | "failed" | "not_due";
  detail: string;
}

/** Wall-clock JST, which is the timezone the whole company is authored in. */
function jstNow(at: number): { day: string; minutes: number } {
  const shifted = new Date(at + 9 * 3_600_000);
  return {
    day: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function parseHHMM(value: string): number {
  const [hh, mm] = value.split(":").map(Number);
  return hh * 60 + mm;
}

function alreadyRan(id: string, day: string): boolean {
  return read((s) => (s.jobs ?? []).some((j) => j.id === id && j.ranFor === day && j.ok));
}

function record(run: JobRun): void {
  mutate((s) => {
    s.jobs = [run, ...(s.jobs ?? [])].slice(0, 100);
  });
}

export function jobHistory(): JobRun[] {
  return read((s) => [...(s.jobs ?? [])]);
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
export async function runDailyNoteDraft(force = false): Promise<JobResult> {
  const cfg = getConfig();
  const at = Date.now();
  const { day, minutes } = jstNow(at);

  if (!cfg.hasApiKey) {
    return { id: NOTE_JOB, status: "skipped", detail: "デモ動作のためスキップしました。" };
  }
  if (!force && minutes < parseHHMM(cfg.note.dailyDraftAt)) {
    return { id: NOTE_JOB, status: "not_due", detail: `${cfg.note.dailyDraftAt} JST に実行します。` };
  }
  if (!force && alreadyRan(NOTE_JOB, day)) {
    return { id: NOTE_JOB, status: "skipped", detail: `${day} 分は作成済みです。` };
  }

  // Claimed before the work starts, so two triggers arriving together cannot
  // both decide they are the one to run it.
  const claimed = mutate((s) => {
    s.jobs ??= [];
    if (!force && s.jobs.some((j) => j.id === NOTE_JOB && j.ranFor === day)) return false;
    s.jobs = [
      { id: NOTE_JOB, ranFor: day, at, ok: false, detail: "実行中" },
      ...s.jobs,
    ].slice(0, 100);
    return true;
  });
  if (!claimed) {
    return { id: NOTE_JOB, status: "skipped", detail: `${day} 分は実行中または作成済みです。` };
  }

  const result = await runAgent({
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
  });

  const ok = result.status === "completed";
  record({
    id: NOTE_JOB,
    ranFor: day,
    at: Date.now(),
    ok,
    detail: ok ? result.text.slice(0, 160) : (result.error ?? result.status),
  });

  return {
    id: NOTE_JOB,
    status: ok ? "ran" : "failed",
    detail: ok ? "note記事の下書きを作成しました。" : (result.error ?? "実行に失敗しました。"),
  };
}

/** Everything due right now. The cron route and the dashboard both call this. */
export async function runDueJobs(): Promise<JobResult[]> {
  return [await runDailyNoteDraft()];
}
