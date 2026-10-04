import "server-only";

import { AGENTS_BY_ID } from "@/lib/company/agents";
import { PROJECTS_BY_ID } from "@/lib/company/projects";
import type { Task } from "@/lib/types";
import { quotaStatus } from "@/lib/ai/budget";
import { getConfig } from "@/server/runtime/config";
import { mutate, read } from "@/server/runtime/store";
import { runAgent } from "@/server/agents/runner";
import { pushActivity } from "@/server/agents/tools";

/**
 * The company working when nobody asked it to.
 *
 * Until now it only moved when the CEO spoke or a scheduled job fired. The
 * board had forty tasks on it, each assigned to an employee, and nothing ever
 * invoked those employees — so the tasks sat at whatever progress they were
 * seeded with, forever. A dashboard of work nobody is doing.
 *
 * This picks up tasks and has their own assignee advance them. The hard part
 * is not starting the work; it is stopping. On a free key the allowance is a
 * few hundred requests a day, one agent turn is one request, and forty tasks
 * run unattended would spend the day before breakfast — leaving nothing for
 * the CEO's own instructions, which is the one thing that must never be
 * crowded out. So every limit below is about restraint, and the engine stops
 * well before the wall rather than at it.
 */

/** How stale a task must be before it is picked up again. */
const DEFAULT_COOLDOWN_MIN = 90;

export interface AutonomySettings {
  enabled: boolean;
  /** Tasks advanced per tick. One tick is one HTTP invocation. */
  perTick: number;
  /** Ceiling on task advances in a JST day. */
  perDay: number;
  /**
   * The share of the day's request allowance autonomous work may use.
   * The remainder is reserved for the CEO's own commands and the scheduled
   * jobs, which must never queue behind the company talking to itself.
   */
  budgetShare: number;
  cooldownMs: number;
}

export function autonomySettings(): AutonomySettings {
  const int = (v: string | undefined, fallback: number) => {
    const n = Number.parseInt(v ?? "", 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const num = (v: string | undefined, fallback: number) => {
    const n = Number.parseFloat(v ?? "");
    return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
  };

  return {
    enabled: !/^(0|false|off|no)$/i.test((process.env.FRIDAY_AUTONOMY ?? "true").trim()),
    perTick: int(process.env.FRIDAY_TASKS_PER_TICK, 2),
    perDay: int(process.env.FRIDAY_MAX_TASKS_PER_DAY, 12),
    budgetShare: num(process.env.FRIDAY_AUTONOMY_BUDGET_SHARE, 0.6),
    cooldownMs: int(process.env.FRIDAY_TASK_COOLDOWN_MIN, DEFAULT_COOLDOWN_MIN) * 60_000,
  };
}

/** JST day, which is the day the rest of the company's counters use. */
function jstDay(at: number): string {
  return new Date(at + 9 * 3_600_000).toISOString().slice(0, 10);
}

export interface WorkResult {
  status: "worked" | "idle" | "off" | "throttled" | "no_budget";
  detail: string;
  advanced: { taskId: string; agent: string; outcome: string }[];
}

/**
 * Which tasks are worth a turn right now.
 *
 * Ordered by what a person would pick: the things that are late, then the
 * things that matter, then the things that have been untouched longest. A task
 * blocked on the CEO is never picked — running its agent again would only
 * reproduce the same halt and spend a request doing it.
 */
export function pickTasks(tasks: Task[], now: number, cooldownMs: number, limit: number): Task[] {
  const eligible = tasks.filter((t) => {
    if (!["QUEUED", "PLANNING", "RUNNING"].includes(t.status)) return false;
    if (t.blockedReason) return false;
    if (t.approvalId) return false;
    if (now - t.updatedAt < cooldownMs) return false;
    return Boolean(AGENTS_BY_ID[t.assignedAgent]);
  });

  const weight = { critical: 0, high: 1, normal: 2, low: 3 } as Record<string, number>;

  return eligible
    .slice()
    .sort((a, b) => {
      const overdueA = a.deadline && a.deadline < now ? 0 : 1;
      const overdueB = b.deadline && b.deadline < now ? 0 : 1;
      return (
        overdueA - overdueB ||
        (weight[a.priority] ?? 9) - (weight[b.priority] ?? 9) ||
        a.updatedAt - b.updatedAt
      );
    })
    .slice(0, limit);
}

/**
 * One tick of autonomous work.
 *
 * Sequential on purpose: these are the same requests the CEO's instructions
 * need, and running several agents at once is how a quiet morning costs the
 * whole day's allowance.
 */
export async function advanceWork(force = false): Promise<WorkResult> {
  const cfg = getConfig();
  const settings = autonomySettings();
  const now = Date.now();
  const day = jstDay(now);

  if (cfg.mode === "demo") {
    return { status: "off", detail: "デモ動作のため実行しません。", advanced: [] };
  }
  if (!settings.enabled && !force) {
    return {
      status: "off",
      detail: "自律実行は無効です（FRIDAY_AUTONOMY=false）。",
      advanced: [],
    };
  }

  // The reserve. Autonomous work gives way to the CEO and to the scheduled
  // jobs, so it stops at a fraction of the day rather than at the end of it.
  const quota = quotaStatus();
  if (quota.enabled && quota.budget > 0) {
    const ceiling = Math.floor(quota.budget * settings.budgetShare);
    if (quota.exhausted || quota.used >= ceiling) {
      return {
        status: "no_budget",
        detail:
          `本日の枠の${Math.round(settings.budgetShare * 100)}%（${quota.used}/${ceiling}）に達したため、` +
          "自律実行を止めています。残りはCEOの指示と定期ジョブのために確保しています。",
        advanced: [],
      };
    }
  }

  // The daily ceiling, claimed in the same place it is read so two ticks
  // arriving together cannot both believe there is room for a full batch.
  const room = mutate((s) => {
    s.autonomy ??= { day, advanced: 0 };
    if (s.autonomy.day !== day) s.autonomy = { day, advanced: 0 };
    const left = Math.max(0, settings.perDay - s.autonomy.advanced);
    return Math.min(left, settings.perTick);
  });

  if (room === 0) {
    return {
      status: "throttled",
      detail: `本日の自律実行は上限（${settings.perDay}件）に達しました。`,
      advanced: [],
    };
  }

  const picked = read((s) => pickTasks(s.tasks, now, force ? 0 : settings.cooldownMs, room));
  if (picked.length === 0) {
    return {
      status: "idle",
      detail: "いま着手すべきタスクはありません（全て承認待ち・停止中・または最近更新済み）。",
      advanced: [],
    };
  }

  const advanced: WorkResult["advanced"] = [];

  for (const task of picked) {
    const agent = AGENTS_BY_ID[task.assignedAgent];
    if (!agent) continue;

    // Counted before the work, not after: a run that times out still spent
    // its requests, and an uncounted one would be retried immediately.
    mutate((s) => {
      s.autonomy ??= { day, advanced: 0 };
      s.autonomy.advanced += 1;
    });

    pushActivity({
      kind: "task.assigned",
      agentId: task.assignedAgent,
      at: Date.now(),
      message: "自分の担当タスクに着手",
      detail: task.title.slice(0, 140),
      taskId: task.id,
    });

    const project = task.project ? PROJECTS_BY_ID[task.project]?.name : undefined;

    const result = await runAgent({
      agentId: task.assignedAgent,
      objective: [
        `あなたの担当タスクを実際に前へ進めてください。`,
        "",
        `タスクid: ${task.id}`,
        `題目: ${task.title}`,
        `内容: ${task.description}`,
        project ? `プロジェクト: ${project}` : "",
        `現在の進捗: ${task.progress}%`,
        "",
        "手順:",
        "1. get_company_data と search_knowledge で、このタスクに必要な前提を実際に読む。",
        "2. 今日できるところまで実際に作業する。考えるだけで終わらせない。",
        "3. 終わったら complete_task、途中なら update_task に進捗と「何をしたか」を記録する。",
        "4. 進められない理由があるなら update_task の blockedReason に書く。",
        "",
        "外部への送信・公開・支出・本番反映が必要になったら、自分で実行せず",
        "request_ceo_approval で止まってください。CEOは今あなたを見ていません。",
        "進捗の数字は、根拠を持って自分で判断した値だけを書いてください。",
      ]
        .filter(Boolean)
        .join("\n"),
      canDelegate: false,
      canReport: false,
    });

    advanced.push({
      taskId: task.id,
      agent: agent.role,
      outcome:
        result.status === "completed"
          ? result.text.slice(0, 160)
          : result.status === "waiting_for_ceo"
            ? "CEO承認待ちで停止"
            : (result.error ?? result.status),
    });

    // Touched either way, so a task whose agent failed is not retried on the
    // very next tick at the cost of the same requests.
    mutate((s) => {
      const stored = s.tasks.find((t) => t.id === task.id);
      if (stored && stored.updatedAt < now) stored.updatedAt = Date.now();
    });
  }

  return {
    status: "worked",
    detail: `${advanced.length}件のタスクを進めました。`,
    advanced,
  };
}

export interface AutonomyStatus {
  enabled: boolean;
  advancedToday: number;
  perDay: number;
  perTick: number;
  budgetShare: number;
  cooldownMinutes: number;
}

/** What the dashboard and the vice-president see. */
export function autonomyStatus(): AutonomyStatus {
  const settings = autonomySettings();
  const day = jstDay(Date.now());
  const used = read((s) => (s.autonomy?.day === day ? s.autonomy.advanced : 0));

  return {
    enabled: settings.enabled,
    advancedToday: used,
    perDay: settings.perDay,
    perTick: settings.perTick,
    budgetShare: settings.budgetShare,
    cooldownMinutes: Math.round(settings.cooldownMs / 60_000),
  };
}
