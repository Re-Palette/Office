import "server-only";

import { getConfig } from "@/server/runtime/config";
import { mutate, read } from "@/server/runtime/store";
import { quota, quotaStatus } from "@/lib/ai/budget";
import { autonomyStatus } from "@/server/autonomy";
import { jobs, runDueJobs, type JobResult } from "@/server/scheduler";

/**
 * The company's heartbeat, for the hours nobody is watching.
 *
 * The dashboard used to be the clock. While a tab was open it rang the
 * scheduler and the company worked; closed, the only thing left was the
 * platform cron — and on the free plan that fires twice a day. So the CEO's
 * experience was that work happened while he watched it and stopped when he
 * looked away, which is the opposite of what a company is for.
 *
 * A single invocation cannot cover a day either: it has a few minutes before
 * the platform kills it. So an invocation does what it can and then hands
 * over to a fresh one, and the chain runs until the day's work is actually
 * finished rather than until the clock runs out.
 *
 * The chain is the dangerous part of this file. A function that calls itself
 * can run away, and on a metered key that costs real money, so it is fenced
 * on four sides and every fence is a stop rather than a slowdown:
 *
 *   1. There has to be work left. "Nothing is due" ends the chain, which is
 *      the normal way a day finishes.
 *   2. The day's request allowance has to have room, and the API's own
 *      daily refusal ends it outright.
 *   3. A hard cap on links per day, so a bug cannot spin even if the three
 *      other conditions somehow stay true.
 *   4. A minimum gap between links, so a failure that looks like progress
 *      cannot become a tight loop.
 *
 * Nothing here decides *what* work happens; that stays with the scheduler and
 * the autonomy engine, which already keep their own daily ceilings.
 */

/** Links per Pacific day. Far above a normal day, low enough to be a fence. */
const MAX_CHAINS_PER_DAY = 40;

/** The shortest gap between one link and the next. */
const MIN_CHAIN_GAP_MS = 10_000;

/**
 * How long one invocation keeps working before handing over.
 *
 * Under the route's own maxDuration, with room left to fire the next link —
 * a chain that dies before it can hand over stops the day.
 */
const WORK_BUDGET_MS = 210_000;

export interface TickResult {
  passes: number;
  results: JobResult[];
  chained: boolean;
  /** Why the chain continued or stopped, in the CEO's language. */
  reason: string;
}

/** The chain's own bookkeeping, rolled over with the request allowance. */
function chainState(): { day: string; chains: number; lastAt: number } {
  const day = quota().day;
  const stored = read((s) => s.tick);
  return stored && stored.day === day ? stored : { day, chains: 0, lastAt: 0 };
}

/**
 * Whether anything is actually owed.
 *
 * Deliberately generous about "due": a job held after a rate limit counts,
 * because that hold clearing is the whole reason to come back. Deliberately
 * strict about autonomy: once the day's task ceiling is reached the company
 * is done whether or not allowance remains.
 */
export function workRemaining(): { yes: boolean; why: string } {
  const allowance = quotaStatus();
  if (allowance.exhausted) {
    return { yes: false, why: "本日のAPI枠を使い切ったため停止します。" };
  }
  if (allowance.enabled && allowance.remaining <= 0) {
    return { yes: false, why: "本日の自主上限に達したため停止します。" };
  }

  const day = jstDay(Date.now());
  const history = read((s) => s.jobs ?? []);
  const pending = jobs().filter((job) => {
    const run = history.find((j) => j.id === job.id && j.ranFor === day);
    if (!run) return true; // never attempted today
    return run.retryAt !== undefined; // held after a transient stop
  });

  const autonomy = autonomyStatus();
  const tasksLeft =
    autonomy.enabled && (autonomy.perDay === 0 || autonomy.advancedToday < autonomy.perDay);
  const tasksRemaining = autonomy.perDay === 0 ? null : autonomy.perDay - autonomy.advancedToday;

  if (pending.length === 0 && !tasksLeft) {
    return { yes: false, why: "本日の予定業務と自律作業はすべて終わりました。" };
  }

  const parts: string[] = [];
  if (pending.length > 0) parts.push(`未了の予定業務 ${pending.length} 件`);
  if (tasksLeft) {
    parts.push(
      tasksRemaining === null ? "自律作業" : `自律作業の残り ${tasksRemaining} 件`,
    );
  }
  return { yes: true, why: `${parts.join("・")}が残っています。` };
}

function jstDay(at: number): string {
  return new Date(at + 9 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Where to reach ourselves.
 *
 * The per-deployment URL would pin the chain to the build that started it, so
 * the stable production domain is preferred: a deploy mid-chain should hand
 * over to the new code, not keep the old one alive.
 */
function selfUrl(): string | null {
  const explicit = process.env.FRIDAY_SELF_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const host =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  return host ? `https://${host.replace(/\/+$/, "")}` : null;
}

/**
 * Fires the next link and does not wait for it.
 *
 * Awaiting would nest the invocations inside each other and hit the platform
 * timeout on the outermost one, so this is deliberately fire-and-forget: the
 * next link's own result is recorded by the next link.
 */
async function fireNextLink(secret: string): Promise<boolean> {
  const base = selfUrl();
  if (!base) {
    console.warn("[friday] 自分のURLが分からないため連鎖を止めます（FRIDAY_SELF_URL）。");
    return false;
  }

  // The dashboard sits behind the host's access protection, so a request from
  // our own server needs the automation secret the platform provides for it.
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();

  try {
    const response = await fetch(`${base}/api/cron?chain=1`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        ...(bypass
          ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "false" }
          : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });

    // Only the handover matters here, not the work: a link that starts is a
    // link that will record its own outcome.
    if (!response.ok && response.status !== 504) {
      console.warn(`[friday] 連鎖の起動が ${response.status} で拒否されました。`);
      return false;
    }
    return true;
  } catch (error) {
    // A timeout means the next link is running and simply has not answered,
    // which is the expected case for work that outlives the request.
    if ((error as Error)?.name === "TimeoutError") return true;
    console.warn(`[friday] 連鎖を起動できませんでした: ${(error as Error).message}`);
    return false;
  }
}

/**
 * One invocation's worth of work, plus the decision to hand over.
 *
 * Returns once its time budget is spent or there is nothing left to do. The
 * caller is expected to let this finish after the response has been sent.
 */
export async function runTick(): Promise<TickResult> {
  const started = Date.now();
  const results: JobResult[] = [];
  let passes = 0;

  let remaining = workRemaining();

  // Work until the budget for this invocation is gone. A pass that advances
  // nothing still counts, because the next decision is about whether work is
  // owed rather than about whether this pass happened to do any.
  while (remaining.yes && Date.now() - started < WORK_BUDGET_MS) {
    passes += 1;
    results.push(...(await runDueJobs()));
    remaining = workRemaining();
  }

  if (!remaining.yes) {
    return { passes, results, chained: false, reason: remaining.why };
  }

  const guard = chainGuard();
  if (!guard.ok) return { passes, results, chained: false, reason: guard.why };

  const fired = await fireNextLink(guard.secret);
  return {
    passes,
    results,
    chained: fired,
    reason: fired
      ? `${remaining.why} ${guard.why}`
      : `${remaining.why} ただし連鎖を起動できませんでした。`,
  };
}

/**
 * Whether another link may fire, and books its place in the cap if so.
 *
 * Separated from the work and from the network so the fences can be tested
 * for what they are: the only thing standing between a self-calling function
 * and a runaway one. Booking before firing is deliberate — over-counting
 * ends a chain early, under-counting lets one escape, and only the first of
 * those is recoverable.
 */
export function chainGuard(): { ok: true; secret: string; why: string } | { ok: false; why: string } {
  if (getConfig().mode === "demo") {
    return { ok: false, why: "デモ動作のため連鎖しません。" };
  }

  // Without the shared secret the next link could not authenticate, and an
  // endpoint that chained without one could be driven by anybody.
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      why:
        "CRON_SECRET が未設定のため連鎖しません。" +
        "設定すると、ダッシュボードを閉じている間も作業が続きます。",
    };
  }

  const now = Date.now();
  const chain = chainState();
  if (chain.chains >= MAX_CHAINS_PER_DAY) {
    return { ok: false, why: `本日の連続実行の上限（${MAX_CHAINS_PER_DAY}回）に達しました。` };
  }
  if (now - chain.lastAt < MIN_CHAIN_GAP_MS) {
    return { ok: false, why: "直前に起動したため連鎖を見送ります。" };
  }

  mutate((s) => {
    const current = s.tick && s.tick.day === chain.day ? s.tick : (s.tick = { ...chain });
    current.chains += 1;
    current.lastAt = now;
  });

  return {
    ok: true,
    secret,
    why: `続きを引き継ぎました（本日 ${chain.chains + 1}/${MAX_CHAINS_PER_DAY} 回目）。`,
  };
}
