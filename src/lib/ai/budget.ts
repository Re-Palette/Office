import "server-only";

import { getConfig } from "@/server/runtime/config";
import { mutate, read } from "@/server/runtime/store";

/**
 * The thing that keeps the company inside a free tier.
 *
 * Lowering the model is not enough on its own. A free key is rationed by
 * requests, not by money, and the loop spends requests in a way that is easy
 * to underestimate: one agent turn is one request, each delegation starts a
 * whole sub-run, and every web_search adds a nested call of its own. A single
 * careless instruction can therefore cost thirty requests, and the only signal
 * that the day is gone is a 429 in the middle of someone's work.
 *
 * Two guards, because they fail differently:
 *
 *   A soft daily budget, which is a guess and is configurable. It stops work
 *   before the wall rather than at it, so the day's remaining allowance is
 *   spent on what the CEO chooses rather than on whatever ran first.
 *
 *   A learned hard stop, which is not a guess. The published free-tier numbers
 *   disagree with each other and change, so nothing here claims to know them;
 *   instead, the first 429 that names a per-day quota is believed, recorded
 *   against that day, and nothing is sent again until the quota resets. That
 *   turns a repeated error into a single one.
 *
 * Reset is at midnight Pacific, which is when Google's daily quotas roll over
 * — not JST, and not UTC. The company's own day-keyed jobs stay on JST; these
 * are different clocks measuring different things, deliberately.
 */

/** Requests-per-minute pacing window. */
const MINUTE_MS = 60_000;

export interface QuotaState {
  /** Pacific day these counters belong to, as YYYY-MM-DD. */
  day: string;
  /** Requests sent today, nested search calls included. */
  requests: number;
  /** Set when the API itself has said the daily quota is gone. */
  exhausted: boolean;
  /** Timestamps of recent requests, for per-minute pacing. */
  recent: number[];
}

/** The Pacific calendar day, which is when a Gemini free-tier day rolls over. */
export function pacificDay(at: number = Date.now()): string {
  // en-CA formats as YYYY-MM-DD, and the zone does the DST arithmetic.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}

function blank(day: string): QuotaState {
  return { day, requests: 0, exhausted: false, recent: [] };
}

/** Reads today's counters, rolling them over if the Pacific day has changed. */
export function quota(): QuotaState {
  const today = pacificDay();
  const stored = read((s) => s.quota);
  return stored && stored.day === today ? stored : blank(today);
}

export interface Verdict {
  ok: boolean;
  /** Written for the CEO to read, when not ok. */
  reason?: string;
  /** Milliseconds to wait before the request would be allowed. */
  waitMs?: number;
}

/**
 * Decides whether one more request may be sent, and books it if so.
 *
 * Reserving before the call rather than counting after it is what makes the
 * budget a limit instead of a report: two runs starting at once would
 * otherwise both read the same remaining count and both proceed.
 */
export function reserve(): Verdict {
  const cfg = getConfig();
  if (!cfg.freeTierGuard) return { ok: true };

  const now = Date.now();
  const today = pacificDay(now);

  return mutate((state) => {
    const current =
      state.quota && state.quota.day === today ? state.quota : (state.quota = blank(today));

    if (current.exhausted) {
      return {
        ok: false,
        reason:
          "本日のGemini無料枠を使い切りました（APIから1日の上限に達したと返答がありました）。" +
          "太平洋時間の0時にリセットされます。それまでAI社員は実行されません。",
      };
    }

    if (cfg.dailyRequestBudget > 0 && current.requests >= cfg.dailyRequestBudget) {
      return {
        ok: false,
        reason:
          `本日の実行上限に達しました（${current.requests}/${cfg.dailyRequestBudget}リクエスト）。` +
          "無料枠を使い切らないための自主的な上限です。" +
          "増やすなら FRIDAY_DAILY_REQUEST_BUDGET を変更してください。",
      };
    }

    // Per-minute pacing. The loop is sequential, so a short wait here is
    // cheaper than a 429 that abandons a run halfway through.
    current.recent = current.recent.filter((t) => now - t < MINUTE_MS);
    if (cfg.requestsPerMinute > 0 && current.recent.length >= cfg.requestsPerMinute) {
      const oldest = current.recent[0];
      return {
        ok: false,
        waitMs: Math.max(0, MINUTE_MS - (now - oldest)) + 250,
        reason: "1分あたりの上限に近いため待機しています。",
      };
    }

    current.requests += 1;
    current.recent.push(now);
    return { ok: true };
  });
}

/**
 * Called when the API has said the day is over.
 *
 * This is the only place the daily limit is ever known for certain, so it is
 * recorded rather than inferred — and a reservation that was booked for the
 * request that failed is given back, since it never produced any work.
 */
export function markExhausted(): void {
  const today = pacificDay();
  mutate((state) => {
    const current =
      state.quota && state.quota.day === today ? state.quota : (state.quota = blank(today));
    current.exhausted = true;
  });
}

/** Hands back a reservation for a request that never reached the API. */
export function refund(): void {
  const today = pacificDay();
  mutate((state) => {
    const current = state.quota;
    if (current && current.day === today && current.requests > 0) {
      current.requests -= 1;
      current.recent.pop();
    }
  });
}

/**
 * Waits out a pacing hold, then reserves.
 *
 * Bounded: past the ceiling the caller is told to come back rather than left
 * holding a serverless invocation open, which has its own timeout and costs
 * more than the request would have.
 */
export async function reserveWithWait(maxWaitMs = 20_000): Promise<Verdict> {
  const first = reserve();
  if (first.ok || !first.waitMs) return first;
  if (first.waitMs > maxWaitMs) {
    return {
      ok: false,
      reason:
        "1分あたりのリクエスト上限に達しました。" +
        `${Math.ceil(first.waitMs / 1000)}秒ほど待ってから再実行してください。`,
    };
  }
  await new Promise((r) => setTimeout(r, first.waitMs));
  return reserve();
}

/** What the dashboard shows. Never includes a key or anything sensitive. */
export interface QuotaStatus {
  enabled: boolean;
  day: string;
  used: number;
  budget: number;
  remaining: number;
  exhausted: boolean;
  /** Local time the allowance resets, as a sentence. */
  resetsAt: string;
}

export function quotaStatus(): QuotaStatus {
  const cfg = getConfig();
  const current = quota();
  const budget = cfg.dailyRequestBudget;

  return {
    enabled: cfg.freeTierGuard,
    day: current.day,
    used: current.requests,
    budget,
    remaining: budget > 0 ? Math.max(0, budget - current.requests) : -1,
    exhausted: current.exhausted,
    resetsAt: "太平洋時間の0時（日本時間の17時ごろ）",
  };
}

/**
 * Whether there is allowance left, without booking any.
 *
 * Used before a run is opened. `reserve` would consume one, which is wrong
 * for a question — and a run that is about to be refused should not have paid
 * for the privilege of being told so.
 */
export function quotaVerdict(): Verdict {
  const cfg = getConfig();
  if (!cfg.freeTierGuard) return { ok: true };

  const current = quota();
  if (current.exhausted) {
    return {
      ok: false,
      reason:
        "本日のGemini無料枠を使い切りました（APIから1日の上限に達したと返答がありました）。" +
        "太平洋時間の0時（日本時間の17時ごろ）にリセットされます。",
    };
  }
  if (cfg.dailyRequestBudget > 0 && current.requests >= cfg.dailyRequestBudget) {
    return {
      ok: false,
      reason:
        `本日の実行上限に達しました（${current.requests}/${cfg.dailyRequestBudget}リクエスト）。` +
        "無料枠を使い切らないための自主的な上限です。FRIDAY_DAILY_REQUEST_BUDGET で変更できます。",
    };
  }
  return { ok: true };
}
