import "server-only";

import { AGENTS_BY_ID, EXECUTIVE_IDS } from "@/lib/company/agents";
import { PROJECTS_BY_ID } from "@/lib/company/projects";
import type { ScheduleConfig } from "@/lib/types";
import { quotaStatus } from "@/lib/ai/budget";
import { getConfig } from "@/server/runtime/config";
import { read } from "@/server/runtime/store";
import { runAgent, resumeRun } from "@/server/agents/runner";
import { applyDecision, type Decision } from "@/server/decisions";
import { getReport } from "@/server/report-store";
import { jobs, schedule, validateSchedule } from "@/server/scheduler";
import { pushActivity } from "@/server/agents/tools";
import { has, type Grant, type Scope } from "./auth";

/**
 * What the vice-president can do.
 *
 * The CEO talks to an external agent; that agent talks to the company
 * through these. They are written for something that will read the result and
 * decide what to say — so each one answers a question completely rather than
 * returning a slice of a database and leaving the caller to join it.
 *
 * Two rules shape the whole set. Every irreversible action still goes through
 * the approval gate, so `instruct` cannot send an email however it is
 * phrased; and `decide` — the one tool that releases such an action — needs a
 * scope the CEO has to grant deliberately.
 */

export interface VpTool {
  name: string;
  description: string;
  scope: Scope;
  schema: Record<string, unknown>;
  run: (input: Record<string, unknown>, grant: Grant) => Promise<unknown>;
}

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

/* ── Reading ──────────────────────────────────────────────────────────────── */

/**
 * The whole company in one answer.
 *
 * Deliberately a summary rather than the state: a vice-president asked "how
 * are we doing" needs what is blocked, what is waiting on the CEO and whether
 * the company can run at all — not four hundred activity events.
 */
function status() {
  const cfg = getConfig();
  const quota = quotaStatus();

  return read((s) => {
    const pending = s.approvals.filter((a) => a.status === "pending");
    const running = s.runs.filter((r) => r.status === "running");
    const waiting = s.runs.filter((r) => r.status === "waiting_for_ceo");
    const live = new Set(["QUEUED", "PLANNING", "RUNNING", "WAITING", "REVIEW"]);
    const active = s.tasks.filter((t) => live.has(t.status));
    const blocked = s.tasks.filter((t) => t.blockedReason);
    const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

    return {
      canWork: cfg.mode === "live",
      why: cfg.mode === "live" ? null : "APIキーが未設定のため、AI社員は実行されません。",
      provider: cfg.provider,
      model: cfg.model,
      allowance: quota.enabled
        ? {
            used: quota.used,
            budget: quota.budget,
            remaining: quota.remaining,
            exhausted: quota.exhausted,
            resetsAt: quota.resetsAt,
          }
        : null,
      // What the CEO would want said first.
      needsCeo: pending.map((a) => ({
        id: a.id,
        title: a.title,
        requestedBy: AGENTS_BY_ID[a.requestedBy]?.role ?? a.requestedBy,
        kind: a.kind,
        risk: a.risk,
        priority: a.priority,
        impact: a.impact,
        at: a.requestedAt,
      })),
      inFlight: running.map((r) => ({
        agent: AGENTS_BY_ID[r.agentId]?.role ?? r.agentId,
        objective: r.objective.slice(0, 160),
        steps: r.steps,
        startedAt: r.startedAt,
      })),
      pausedForApproval: waiting.length,
      tasks: { active: active.length, blocked: blocked.length, total: s.tasks.length },
      blocked: blocked.slice(0, 10).map((t) => ({
        id: t.id,
        title: t.title,
        agent: AGENTS_BY_ID[t.assignedAgent]?.role ?? t.assignedAgent,
        reason: t.blockedReason,
      })),
      reportsAwaitingReview: s.reports.filter((r) => r.status === "PENDING_REVIEW").length,
      jobsToday: (s.jobs ?? [])
        .filter((j) => j.ranFor === today)
        .map((j) => ({ id: j.id, ok: j.ok, detail: j.detail })),
      schedule: schedule(),
      usage: s.usage,
    };
  });
}

/* ── The tools ────────────────────────────────────────────────────────────── */

export const VP_TOOLS: VpTool[] = [
  {
    name: "company_status",
    description:
      "Everything the CEO would want to know in one answer: whether the company can run at all, what is waiting on the CEO's decision, what is in flight, what is blocked and why, today's scheduled jobs, and how much of the day's API allowance is left. Call this first for any question about how the company is doing.",
    scope: "read",
    schema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => status(),
  },

  {
    name: "list_approvals",
    description:
      "The decisions waiting for the CEO, in full — including exactly what would happen the moment each is approved. Use this when the CEO asks what needs deciding, and read the impact out rather than summarising it away.",
    scope: "read",
    schema: { type: "object", properties: {}, additionalProperties: false },
    run: async () =>
      read((s) =>
        s.approvals
          .filter((a) => a.status === "pending")
          .map((a) => ({
            id: a.id,
            title: a.title,
            summary: a.summary,
            impact: a.impact,
            kind: a.kind,
            risk: a.risk,
            priority: a.priority,
            requestedBy: AGENTS_BY_ID[a.requestedBy]?.role ?? a.requestedBy,
            requestedAt: a.requestedAt,
            /** The exact text or payload that would go out. */
            payload: s.runs.find((r) => r.approvalId === a.id)?.pendingAction?.input ?? null,
          })),
      ),
  },

  {
    name: "list_tasks",
    description:
      "The company's tasks. Filter by status (RUNNING, PLANNING, WAITING, WAITING_FOR_CEO, REVIEW, COMPLETED, FAILED), by project id, or by the AI employee's id.",
    scope: "read",
    schema: {
      type: "object",
      properties: {
        status: { type: "string" },
        project: { type: "string" },
        agent: { type: "string" },
      },
      additionalProperties: false,
    },
    run: async (input) =>
      read((s) =>
        s.tasks
          .filter((t) => {
            if (input.status && t.status !== str(input.status)) return false;
            if (input.project && t.project !== str(input.project)) return false;
            if (input.agent && t.assignedAgent !== str(input.agent)) return false;
            return true;
          })
          .slice(0, 60)
          .map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            progress: t.progress,
            agent: AGENTS_BY_ID[t.assignedAgent]?.role ?? t.assignedAgent,
            project: t.project ? (PROJECTS_BY_ID[t.project]?.name ?? t.project) : null,
            blockedReason: t.blockedReason ?? null,
            deadline: t.deadline ?? null,
          })),
      ),
  },

  {
    name: "list_activity",
    description:
      "What the AI employees have been doing, newest first. Use it to answer 'what happened' or to check whether an instruction actually got picked up.",
    scope: "read",
    schema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
    run: async (input) => {
      const limit = typeof input.limit === "number" ? Math.min(100, input.limit) : 30;
      return read((s) =>
        s.activity.slice(0, limit).map((e) => ({
          at: e.at,
          kind: e.kind,
          agent: AGENTS_BY_ID[e.agentId]?.role ?? e.agentId,
          message: e.message,
          detail: e.detail ?? null,
        })),
      );
    },
  },

  {
    name: "list_reports",
    description:
      "Reports the AI employees have written, newest first. Returns ids and status; use read_report for the contents.",
    scope: "read",
    schema: {
      type: "object",
      properties: { status: { type: "string" } },
      additionalProperties: false,
    },
    run: async (input) =>
      read((s) =>
        s.reports
          .filter((r) => !input.status || r.status === str(input.status))
          .slice(0, 40)
          .map((r) => ({
            id: r.id,
            title: r.title,
            type: r.type,
            status: r.status,
            author: AGENTS_BY_ID[r.createdBy]?.role ?? r.createdBy,
            createdAt: r.createdAt,
            pdfUrl: r.pdfUrl,
          })),
      ),
  },

  {
    name: "read_report",
    description:
      "The full contents of one report: summary, metrics, findings, risks and next actions. Use this to brief the CEO on a report rather than describing that one exists.",
    scope: "read",
    schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (input) => {
      const report = getReport(str(input.id));
      if (!report) return { error: `レポート ${str(input.id)} は見つかりません。` };
      return {
        id: report.id,
        title: report.title,
        type: report.type,
        status: report.status,
        author: AGENTS_BY_ID[report.createdBy]?.role ?? report.createdBy,
        createdAt: report.createdAt,
        content: report.content,
      };
    },
  },

  /* ── Operating ──────────────────────────────────────────────────────────── */

  {
    name: "ask_company",
    description:
      "Ask the company a question and wait for the answer. The COO reads the company's real data and replies; it may delegate to a specialist first. Use this for questions that need judgement or synthesis rather than a lookup — a plain lookup is cheaper through the read tools. Costs API allowance.",
    scope: "operate",
    schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "What to ask, in Japanese." },
      },
      required: ["question"],
      additionalProperties: false,
    },
    run: async (input, grant) => {
      const question = str(input.question).trim();
      if (!question) return { error: "question は必須です。" };

      pushActivity({
        kind: "agent.started",
        agentId: "coo",
        at: Date.now(),
        message: `${grant.actor} からの質問`,
        detail: question.slice(0, 140),
      });

      const result = await runAgent({
        agentId: "coo",
        objective: question,
        context:
          `CEOの秘書である${grant.actor}からの質問です。` +
          "会社の実際のデータを読んだうえで、簡潔に答えてください。レポートの提出は不要です。",
        canDelegate: true,
        canReport: false,
      });

      return {
        status: result.status,
        answer: result.text,
        error: result.error ?? null,
        steps: result.steps,
      };
    },
  },

  {
    name: "instruct_company",
    description:
      "Give the company work to do. The COO decomposes it and delegates to the right AI employees. Returns as soon as the work has started — follow it with company_status or list_activity. Anything irreversible (sending email, publishing, spending, deploying) still stops for the CEO's approval, so this cannot act outside the company by itself. Costs API allowance.",
    scope: "operate",
    schema: {
      type: "object",
      properties: {
        instruction: { type: "string", description: "The instruction, in Japanese." },
        wait: {
          type: "boolean",
          description: "Wait for completion instead of returning once started. Slow; use sparingly.",
        },
      },
      required: ["instruction"],
      additionalProperties: false,
    },
    run: async (input, grant) => {
      const instruction = str(input.instruction).trim();
      if (!instruction) return { error: "instruction は必須です。" };

      const options = {
        agentId: "coo",
        objective: instruction,
        context:
          `CEO（鈴木陽大）の指示を、秘書の${grant.actor}が伝えています。` +
          "必要に応じて他のAI社員へ委譲し、最終的にあなたが1つの報告へ統合してください。",
        canDelegate: true,
        canReport: true,
      };

      pushActivity({
        kind: "task.assigned",
        agentId: "coo",
        at: Date.now(),
        message: `${grant.actor} 経由のCEO指示`,
        detail: instruction.slice(0, 140),
        severity: "important",
      });

      if (input.wait === true) {
        const result = await runAgent(options);
        return {
          status: result.status,
          text: result.text,
          approvalId: result.approvalId ?? null,
          reportId: result.reportId ?? null,
          error: result.error ?? null,
        };
      }

      // Not awaited on purpose, and not dropped either: the MCP route keeps
      // the invocation alive so this finishes after the response.
      return { started: true, handOff: runAgent(options) };
    },
  },

  {
    name: "run_job",
    description:
      "Run one of the company's scheduled jobs now, without waiting for its hour: the morning briefing, the note article draft, the daily report, or the weekly board meeting. Use the ids from company_status.schedule or from the error this returns.",
    scope: "operate",
    schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (input) => {
      const wanted = str(input.id);
      const job = jobs().find((j) => j.id === wanted);
      if (!job) {
        return { error: `不明なジョブです: ${wanted}`, jobs: jobs().map((j) => j.id) };
      }
      return job.run(true);
    },
  },

  {
    name: "set_schedule",
    description:
      "Change when the recurring work runs. Times are JST, HH:MM. Only the fields given are changed.",
    scope: "operate",
    schema: {
      type: "object",
      properties: {
        morningBriefing: { type: "string" },
        dailyReport: { type: "string" },
        weeklyBoard: { type: "string" },
        weeklyBoardDay: { type: "string" },
      },
      additionalProperties: false,
    },
    run: async (input) => {
      const patch = input as Partial<ScheduleConfig>;
      const problem = validateSchedule(patch);
      if (problem) return { error: problem };
      const { mutate } = await import("@/server/runtime/store");
      const { DEFAULT_SCHEDULE } = await import("@/lib/company/reports");
      return {
        schedule: mutate((s) => {
          s.schedule = { ...(s.schedule ?? DEFAULT_SCHEDULE), ...patch };
          return s.schedule;
        }),
      };
    },
  },

  {
    name: "advance_work",
    description:
      "Have the company work on its own queued tasks now: each AI employee picks up what it has been assigned and actually moves it forward. Returns what was advanced. Bounded per call and per day, and it stops once autonomous work has used its share of the day's API allowance so the CEO's own instructions are never crowded out. Call this periodically to keep the company running in the background.",
    scope: "operate",
    schema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      const { advanceWork } = await import("@/server/autonomy");
      return advanceWork();
    },
  },

  {
    name: "work_settings",
    description:
      "How much autonomous work the company is allowed: whether it is on, how many tasks it has advanced today, and the ceilings. Use this to explain to the CEO why the company is or is not progressing by itself.",
    scope: "read",
    schema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      const { autonomyStatus } = await import("@/server/autonomy");
      return autonomyStatus();
    },
  },

  /* ── The one that reaches outside ───────────────────────────────────────── */

  {
    name: "decide_approval",
    description:
      "Record the CEO's decision on a pending approval. Approving carries out the action immediately and some of them cannot be undone — read list_approvals' impact field aloud and get the CEO's explicit word before calling this. Never decide on the CEO's behalf or infer consent from an earlier remark.",
    scope: "approve",
    schema: {
      type: "object",
      properties: {
        approvalId: { type: "string" },
        decision: { type: "string", enum: ["approved", "rejected", "revision_requested"] },
        comment: { type: "string", description: "The CEO's words, if any." },
      },
      required: ["approvalId", "decision"],
      additionalProperties: false,
    },
    run: async (input, grant) => {
      const decision = str(input.decision) as Decision;
      if (!["approved", "rejected", "revision_requested"].includes(decision)) {
        return { error: "decision は approved / rejected / revision_requested のいずれかです。" };
      }

      const resolved = applyDecision({
        approvalId: str(input.approvalId),
        decision,
        comment: str(input.comment) || undefined,
      });
      if (!resolved) return { error: `承認 ${str(input.approvalId)} は見つかりません。` };

      // Recorded as relayed, not as the agent's own decision: the audit trail
      // should never suggest the CEO was not in the loop.
      pushActivity({
        kind: decision === "approved" ? "approval.approved" : "approval.rejected",
        agentId: "coo",
        at: Date.now(),
        message: `${grant.actor} がCEOの判断を伝達: ${decision}`,
        detail: str(input.comment).slice(0, 140) || resolved.approvalId,
        severity: "important",
      });

      return {
        status: "ok",
        approvalId: resolved.approvalId,
        resumed: Boolean(resolved.runId),
        handOff: resolved.runId
          ? resumeRun(resolved.runId, decision, str(input.comment) || undefined)
          : undefined,
      };
    },
  },
];

export const VP_EXECUTIVES = EXECUTIVE_IDS;

/** The tools this grant may actually see. */
export function toolsFor(grant: Grant): VpTool[] {
  return VP_TOOLS.filter((t) => has(grant, t.scope));
}
