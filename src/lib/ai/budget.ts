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

/**
 * The longest this will hold an invocation waiting for the pacer.
 *
 * A per-minute hold is at most one window, so the ceiling has to be above a
 * window or the wait is pointless — which it was at 20s: any burst that
 * filled the minute early was reported to the CEO as a stop instead of being
 * waited out. Above this the caller is told when it will resume, and the
 * scheduler picks the work up on its next tick.
 */
const MAX_PACING_WAIT_MS = 70_000;

export interface QuotaState {
  /** Pacific day these counters belong to, as YYYY-MM-DD. */
  day: string;
  /** Requests sent today, nested search calls included. */
  requests: number;
  /** Set when the API itself has said the daily quota is gone. */
  exhausted: boolean;
  /** Timestamps of recent requests, for per-minute pacing. */
  recent: number[];
  /**
   * Set when the service itself refused for the per-minute ceiling.
   *
   * Our pacing counts what this company sent. The service counts everything
   * the key was charged for, which can include another app sharing it. When
   * the two disagree the service is right, so its refusal parks every caller
   * until the hold it named has passed.
   */
  pausedUntil?: number;
  /**
   * The per-minute ceiling the service has actually enforced today.
   *
   * Learned the only way it can be: by being refused. Floored, because a
   * single burst from elsewhere should slow the company down, not stop it,
   * and cleared with the Pacific day along with the rest of this state.
   */
  learnedRpm?: number;
}

/** Never pace below this, however often the service refuses. */
const MIN_LEARNED_RPM = 5;

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

    // A hold the service asked for outranks our own arithmetic.
    if (current.pausedUntil && current.pausedUntil > now) {
      return {
        ok: false,
        waitMs: current.pausedUntil - now,
        reason: "APIが1分あたりの上限と返したため待機しています。",
      };
    }

    // Per-minute pacing. The loop is sequential, so a short wait here is
    // cheaper than a 429 that abandons a run halfway through.
    current.recent = current.recent.filter((t) => now - t < MINUTE_MS);
    // The configured rate is always the cap. The floor applies only to what
    // was *learned* from a refusal, so one bad minute cannot throttle the
    // company to nothing — it must never raise a limit the operator set.
    const learned =
      current.learnedRpm === undefined ? null : Math.max(MIN_LEARNED_RPM, current.learnedRpm);
    const ceiling =
      learned === null ? cfg.requestsPerMinute : Math.min(cfg.requestsPerMinute, learned);
    if (cfg.requestsPerMinute > 0 && current.recent.length >= ceiling) {
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
 * Called when the API has said the minute is full.
 *
 * Two things follow. Every caller parks until the hold the service named has
 * passed, so a burst does not keep walking into the same wall. And the
 * ceiling we pace against drops below the count that was refused, because
 * being refused is the only way to find out what the real limit is — the
 * published number is per project and not guaranteed.
 *
 * Unlike the daily stop this is not a verdict, just a slowdown: it clears
 * with the Pacific day and never falls below MIN_LEARNED_RPM.
 */
export function notePerMinuteLimit(retryAfterMs: number | null): void {
  const now = Date.now();
  const today = pacificDay(now);

  mutate((state) => {
    const current =
      state.quota && state.quota.day === today ? state.quota : (state.quota = blank(today));

    const hold = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : 20_000;
    current.pausedUntil = Math.max(current.pausedUntil ?? 0, now + hold);

    const inWindow = current.recent.filter((t) => now - t < MINUTE_MS).length;
    if (inWindow > 0) {
      const refusedAt = Math.max(MIN_LEARNED_RPM, inWindow - 1);
      current.learnedRpm = Math.min(current.learnedRpm ?? refusedAt, refusedAt);
    }
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
export async function reserveWithWait(maxWaitMs = MAX_PACING_WAIT_MS): Promise<Verdict> {
  let waited = 0;

  // Several passes, because the slot a wait frees can be taken by another
  // invocation before this one wakes. Giving up after a single retry was
  // reported as the company stopping the moment it got busy.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const verdict = reserve();
    if (verdict.ok || !verdict.waitMs) return verdict;

    const hold = verdict.waitMs;
    if (waited + hold > maxWaitMs) {
      return {
        ok: false,
        reason:
          "1分あたりのリクエスト上限が続いています。" +
          `${Math.ceil(hold / 1000)}秒後に自動で再開します。`,
        waitMs: hold,
      };
    }
    waited += hold;
    await new Promise((r) => setTimeout(r, hold));
  }

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
