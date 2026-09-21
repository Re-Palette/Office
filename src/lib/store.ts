"use client";

import { create } from "zustand";
import { AGENTS } from "@/lib/company/agents";
import { SEED_ACTIVITY } from "@/lib/company/activity";
import {
  SEED_APPROVALS,
  SEED_FLOWS,
  SEED_NOTIFICATIONS,
  SEED_RECOMMENDATIONS,
  SEED_REPORT_APPROVALS,
} from "@/lib/company/inbox";
import { SEED_REPORTS } from "@/lib/company/report-seed";
import { buildReport, type BuildReportOptions } from "@/lib/engine/report-builder";
import {
  buildRevisionTask,
  ceoDecisionEvent,
  decisionNotification,
  requestApproval,
  submitReportForReview,
  type ApprovalRequestInput,
} from "@/lib/engine/workflow";
import { TASKS } from "@/lib/company/tasks";
import { DEFAULT_SCHEDULE } from "@/lib/company/reports";
import { planCommand, type CommandPlan } from "@/lib/engine/orchestrator";
import { replyToCeo } from "@/lib/engine/chat";
import {
  MAX_ACTIVITY,
  maybeRequestApproval,
  nextSimulationStep,
  rebalanceWorkforce,
} from "@/lib/engine/simulator";
import { SEED_NOW } from "@/lib/time";
import {
  clearDecisions,
  loadDecisions,
  saveDecisions,
  type PersistedDecisions,
} from "@/lib/persistence";
import type {
  ActivityEvent,
  Agent,
  Approval,
  ChatMessage,
  CollaborationFlow,
  DepartmentId,
  NotificationItem,
  Recommendation,
  Report,
  ReportStatus,
  ReportType,
  ScheduleConfig,
  Task,
} from "@/lib/types";

export interface CompanyState {
  /** Company clock. Starts at the deterministic seed instant, then ticks live. */
  now: number;
  hydrated: boolean;
  simulating: boolean;

  agents: Agent[];
  tasks: Task[];
  activity: ActivityEvent[];
  approvals: Approval[];
  recommendations: Recommendation[];
  flows: CollaborationFlow[];
  notifications: NotificationItem[];
  chat: ChatMessage[];
  plans: CommandPlan[];
  reports: Report[];
  schedule: ScheduleConfig;
  /** Set once the scheduled daily report has fired, so it fires only once. */
  lastDailyReportAt?: number;

  rightPanelOpen: boolean;
  panelTab: "activity" | "inbox" | "chat" | "alerts";
  /** Banner the CEO dismissed; suppressed until a newer one arrives. */
  dismissedBannerId?: string;

  tick: () => void;
  startClock: () => void;
  /** Replays the CEO's stored decisions over the seed data on boot. */
  hydrateDecisions: () => void;
  resetDecisions: () => void;
  toggleSimulation: () => void;
  toggleRightPanel: () => void;
  setPanelTab: (tab: CompanyState["panelTab"]) => void;

  decideApproval: (id: string, decision: Approval["status"], comment?: string) => void;
  decideRecommendation: (id: string, decision: "approved" | "rejected") => void;
  markNotificationsRead: () => void;
  markNotificationRead: (id: string) => void;
  dismissBanner: (id: string) => void;

  generateReport: (input: {
    type: ReportType;
    projectId?: string;
    departmentId?: DepartmentId;
    revisionOf?: string;
    revisionNote?: string;
  }) => Report;
  decideReport: (
    id: string,
    decision: "APPROVED" | "REJECTED" | "REVISION_REQUIRED",
    comment?: string,
  ) => void;
  archiveReport: (id: string) => void;
  requestAgentApproval: (input: ApprovalRequestInput) => Approval;
  runScheduledReports: () => void;

  runCommand: (input: string) => CommandPlan;
  sendChat: (input: string) => void;
}

let messageCounter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${messageCounter++}`;

/** How long the authoring AI employee takes to turn around a revision. */
const REVISION_DELAY = 6000;

let persistTimer: number | undefined;

/** Collects the human-made parts of the state and writes them to storage. */
function persist() {
  if (typeof window === "undefined") return;
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    const s = useCompany.getState();
    const seedReportIds = new Set(SEED_REPORTS.map((r) => r.id));

    const snapshot: PersistedDecisions = {
      approvals: Object.fromEntries(
        s.approvals
          .filter((a) => a.status !== "pending")
          .map((a) => [
            a.id,
            {
              status: a.status,
              reviewedAt: a.reviewedAt,
              reviewedBy: a.reviewedBy,
              reviewComment: a.reviewComment,
            },
          ]),
      ),
      reports: Object.fromEntries(
        s.reports
          .filter((r) => r.reviewedAt || r.status !== "PENDING_REVIEW")
          .map((r) => [
            r.id,
            {
              status: r.status,
              reviewedAt: r.reviewedAt,
              reviewedBy: r.reviewedBy,
              reviewComment: r.reviewComment,
            },
          ]),
      ),
      tasks: Object.fromEntries(
        s.tasks
          .filter((t) => t.approvalId || t.reportId)
          .map((t) => [t.id, { status: t.status, blockedReason: t.blockedReason }]),
      ),
      generated: s.reports.filter((r) => !seedReportIds.has(r.id)),
      readNotifications: s.notifications.filter((n) => n.read).map((n) => n.id),
      liveNotifications: s.notifications.filter((n) => n.id.startsWith("ntf-")),
      dismissedBannerId: s.dismissedBannerId,
      savedAt: Date.now(),
    };

    saveDecisions(snapshot);
  }, 400);
}

/**
 * Reports generated in the browser are pushed to the server so that
 * `/reports/{id}/pdf` can render them. Seeded reports are already known
 * server-side, so only runtime ones need this.
 *
 * Phase 3 replaces this with a Supabase write; the PDF route reads the same
 * record either way.
 */
async function publishReport(report: Report): Promise<void> {
  try {
    await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
  } catch {
    // The dashboard keeps working; only the PDF link would be unavailable.
  }
}

export const useCompany = create<CompanyState>((set, get) => ({
  now: SEED_NOW,
  hydrated: false,
  simulating: true,

  agents: AGENTS,
  tasks: TASKS,
  activity: SEED_ACTIVITY,
  approvals: [...SEED_REPORT_APPROVALS, ...SEED_APPROVALS],
  recommendations: SEED_RECOMMENDATIONS,
  flows: SEED_FLOWS,
  notifications: SEED_NOTIFICATIONS,
  chat: [],
  plans: [],
  reports: SEED_REPORTS,
  schedule: DEFAULT_SCHEDULE,

  rightPanelOpen: true,
  panelTab: "activity",

  startClock: () => set({ hydrated: true }),

  hydrateDecisions: () => {
    const stored = loadDecisions();
    if (!stored) {
      set({ hydrated: true });
      return;
    }

    set((s) => {
      const seedReportIds = new Set(s.reports.map((r) => r.id));
      const restored = stored.generated.filter((r) => !seedReportIds.has(r.id));

      const reports = [...restored, ...s.reports].map((r) =>
        stored.reports[r.id] ? { ...r, ...stored.reports[r.id] } : r,
      );

      return {
        reports: reports.sort((a, b) => b.createdAt - a.createdAt),
        approvals: s.approvals.map((a) =>
          stored.approvals[a.id] ? { ...a, ...stored.approvals[a.id] } : a,
        ),
        tasks: s.tasks.map((t) =>
          stored.tasks[t.id] ? { ...t, ...stored.tasks[t.id] } : t,
        ),
        notifications: [
          ...stored.liveNotifications,
          ...s.notifications,
        ].map((n) =>
          stored.readNotifications.includes(n.id) ? { ...n, read: true } : n,
        ),
        dismissedBannerId: stored.dismissedBannerId,
        hydrated: true,
      } as Partial<CompanyState>;
    });

    // Reports made in an earlier session need re-registering server-side so
    // their PDF URLs keep resolving after a restart.
    for (const report of stored.generated) void publishReport(report);
  },

  resetDecisions: () => {
    clearDecisions();
    window.location.reload();
  },

  tick: () => {
    const state = get();
    const now = state.now + 1000;
    set({ now });
  },

  toggleSimulation: () => set((s) => ({ simulating: !s.simulating })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setPanelTab: (tab) => set({ panelTab: tab }),

  decideApproval: (id, decision, comment) => {
    set((s) => {
      const approval = s.approvals.find((a) => a.id === id);
      if (!approval) return s;

      const settled =
        decision === "approved" || decision === "rejected" || decision === "revision_requested";

      const approvals = s.approvals.map((a) =>
        a.id === id
          ? {
              ...a,
              status: decision,
              ...(settled
                ? { reviewedAt: s.now, reviewedBy: "CEO", reviewComment: comment }
                : {}),
            }
          : a,
      );

      if (!settled) return { approvals };

      const event = ceoDecisionEvent(
        decision as "approved" | "rejected" | "revision_requested",
        approval.title,
        approval.requestedBy,
        s.now,
        approval.relatedReportId,
      );

      // An approved request releases whatever it was blocking.
      const tasks = s.tasks.map((t) => {
        if (t.approvalId !== approval.id) return t;
        if (decision === "approved") {
          return {
            ...t,
            status: "RUNNING" as const,
            blockedReason: undefined,
            updatedAt: s.now,
          };
        }
        if (decision === "rejected") {
          return { ...t, status: "FAILED" as const, updatedAt: s.now };
        }
        return { ...t, status: "RUNNING" as const, updatedAt: s.now };
      });

      const reports = approval.relatedReportId
        ? s.reports.map((r) =>
            r.id === approval.relatedReportId
              ? {
                  ...r,
                  status:
                    decision === "approved"
                      ? ("APPROVED" as ReportStatus)
                      : decision === "rejected"
                        ? ("REJECTED" as ReportStatus)
                        : ("REVISION_REQUIRED" as ReportStatus),
                  reviewedAt: s.now,
                  reviewedBy: "CEO",
                  reviewComment: comment,
                  updatedAt: s.now,
                }
              : r,
          )
        : s.reports;

      return {
        approvals,
        tasks,
        reports,
        activity: [event, ...s.activity].slice(0, MAX_ACTIVITY),
        agents:
          decision === "approved"
            ? s.agents.map((a) =>
                a.id === approval.requestedBy && a.status === "needs_approval"
                  ? { ...a, status: "working" as const, lastActiveMinutesAgo: 0 }
                  : a,
              )
            : s.agents,
        // Clear the notifications this decision answers.
        notifications: s.notifications.map((n) =>
          n.relatedApprovalId === approval.id ? { ...n, read: true } : n,
        ),
      };
    });
    persist();
  },

  decideRecommendation: (id, decision) =>
    set((s) => {
      const rec = s.recommendations.find((r) => r.id === id);
      return {
        recommendations: s.recommendations.map((r) =>
          r.id === id ? { ...r, status: decision } : r,
        ),
        activity: rec
          ? [
              {
                id: nextId("act"),
                kind: decision === "approved" ? "approval.approved" : "approval.rejected",
                agentId: rec.fromAgent,
                at: s.now,
                message:
                  decision === "approved"
                    ? "CEOが提案を承認しました"
                    : "CEOが提案を見送りました",
                detail: rec.headline,
                severity: "important",
              } satisfies ActivityEvent,
              ...s.activity,
            ].slice(0, MAX_ACTIVITY)
          : s.activity,
      };
    }),

  markNotificationsRead: () => {
    set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) }));
    persist();
  },

  markNotificationRead: (id) => {
    set((s) => ({
      notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    }));
    persist();
  },

  dismissBanner: (id) => {
    set({ dismissedBannerId: id });
    persist();
  },

  /**
   * An AI employee finishes a body of work and turns it into a report.
   * The report goes straight into the CEO's queue with a PDF attached.
   */
  generateReport: (input) => {
    const state = get();
    const now = state.now;

    const options: BuildReportOptions & { now: number } = {
      type: input.type,
      projectId: input.projectId,
      departmentId: input.departmentId,
      revisionNote: input.revisionNote,
      now,
      snapshot: {
        agents: state.agents,
        tasks: state.tasks,
        activity: state.activity,
        now,
      },
    };

    const previous = input.revisionOf
      ? state.reports.find((r) => r.id === input.revisionOf)
      : undefined;

    const report: Report = {
      ...buildReport(options),
      ...(previous
        ? {
            title: previous.title,
            revisionOf: previous.id,
            version: previous.version + 1,
            projectId: previous.projectId,
            departmentId: previous.departmentId,
          }
        : {}),
    };

    const { approval, notification, events } = submitReportForReview(report, now);
    report.approvalId = approval.id;

    set((s) => ({
      reports: [{ ...report }, ...s.reports],
      approvals: [approval, ...s.approvals],
      notifications: [notification, ...s.notifications],
      activity: [...events.reverse(), ...s.activity].slice(0, MAX_ACTIVITY),
    }));

    // Keep the server's copy in step so the PDF URL resolves.
    void publishReport(report);
    persist();

    return report;
  },

  decideReport: (id, decision, comment) => {
    const state = get();
    const report = state.reports.find((r) => r.id === id);
    if (!report) return;

    const now = state.now;
    const mapped =
      decision === "APPROVED"
        ? "approved"
        : decision === "REJECTED"
          ? "rejected"
          : "revision_requested";

    // The report's approval record is the single source of truth for the
    // decision, so route through it and let it cascade.
    if (report.approvalId && state.approvals.some((a) => a.id === report.approvalId)) {
      get().decideApproval(report.approvalId, mapped as Approval["status"], comment);
    } else {
      set((s) => ({
        reports: s.reports.map((r) =>
          r.id === id
            ? {
                ...r,
                status: decision,
                reviewedAt: now,
                reviewedBy: "CEO",
                reviewComment: comment,
                updatedAt: now,
              }
            : r,
        ),
        activity: [
          ceoDecisionEvent(
            mapped as "approved" | "rejected" | "revision_requested",
            report.title,
            report.createdBy,
            now,
            report.id,
          ),
          ...s.activity,
        ].slice(0, MAX_ACTIVITY),
      }));
    }

    set((s) => ({
      notifications: [
        decisionNotification(
          mapped as "approved" | "rejected" | "revision_requested",
          report.title,
          report.createdBy,
          now,
          `/reports/${report.id}`,
        ),
        ...s.notifications,
      ],
    }));

    // A revision request puts real work back on the authoring AI employee.
    if (decision === "REVISION_REQUIRED") {
      const task = buildRevisionTask(report, comment ?? "", now);
      set((s) => ({
        tasks: [task, ...s.tasks],
        agents: s.agents.map((a) =>
          a.id === report.createdBy
            ? { ...a, status: "writing" as const, currentTask: task.title, lastActiveMinutesAgo: 0 }
            : a,
        ),
        activity: [
          {
            id: nextId("act"),
            kind: "task.assigned" as const,
            agentId: report.createdBy,
            at: now,
            message: "修正タスクを受領",
            detail: comment ?? report.title,
            reportId: report.id,
            severity: "important" as const,
          },
          ...s.activity,
        ].slice(0, MAX_ACTIVITY),
      }));

      // The AI employee produces the revised version shortly after.
      window.setTimeout(() => {
        const revised = get().generateReport({
          type: report.type,
          projectId: report.projectId,
          departmentId: report.departmentId,
          revisionOf: report.id,
          revisionNote: comment,
        });
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === task.id
              ? { ...t, status: "COMPLETED" as const, progress: 100, updatedAt: get().now }
              : t,
          ),
          activity: [
            {
              id: nextId("act"),
              kind: "report.generated" as const,
              agentId: report.createdBy,
              at: get().now,
              message: `修正版 v${revised.version} を提出`,
              detail: revised.title,
              reportId: revised.id,
              severity: "important" as const,
            },
            ...s.activity,
          ].slice(0, MAX_ACTIVITY),
        }));
        persist();
      }, REVISION_DELAY);
    }

    persist();
  },

  archiveReport: (id) => {
    set((s) => ({
      reports: s.reports.map((r) =>
        r.id === id ? { ...r, status: "ARCHIVED" as ReportStatus, updatedAt: s.now } : r,
      ),
    }));
    persist();
  },

  requestAgentApproval: (input) => {
    const { approval, notification, event } = requestApproval(input);
    set((s) => ({
      approvals: [approval, ...s.approvals],
      notifications: [notification, ...s.notifications],
      activity: [event, ...s.activity].slice(0, MAX_ACTIVITY),
      tasks: input.relatedTaskId
        ? s.tasks.map((t) =>
            t.id === input.relatedTaskId
              ? {
                  ...t,
                  status: "WAITING_FOR_CEO" as const,
                  blockedReason: input.impact,
                  approvalId: approval.id,
                  updatedAt: s.now,
                }
              : t,
          )
        : s.tasks,
      agents: s.agents.map((a) =>
        a.id === input.requestedBy
          ? { ...a, status: "needs_approval" as const, lastActiveMinutesAgo: 0 }
          : a,
      ),
    }));
    persist();
    return approval;
  },

  /** Fires the scheduled report jobs when the company clock crosses their time. */
  runScheduledReports: () => {
    const state = get();
    const [hh, mm] = state.schedule.dailyReport.split(":").map(Number);

    // Resolve the configured JST wall-clock time back to an absolute instant.
    const jst = new Date(state.now + 9 * 3_600_000);
    jst.setUTCHours(hh, mm, 0, 0);
    const dueAt = jst.getTime() - 9 * 3_600_000;

    if (state.now < dueAt) return;
    if (state.lastDailyReportAt && state.lastDailyReportAt >= dueAt) return;

    set({ lastDailyReportAt: state.now });
    get().generateReport({ type: "daily" });
  },

  runCommand: (input) => {
    const plan = planCommand(input);
    const now = get().now;

    const flow: CollaborationFlow = {
      id: `flow-${plan.id}`,
      title: plan.input,
      origin: "CEO",
      startedAt: now,
      steps: plan.steps.map((step, i) => ({
        id: step.id,
        agentId: step.agentId,
        action: step.action,
        state: i === 0 ? "done" : i === 1 ? "active" : "queued",
        at: i <= 1 ? now : undefined,
      })),
    };

    const events: ActivityEvent[] = [
      {
        id: nextId("act"),
        kind: "task.created",
        agentId: "coo",
        at: now,
        message: "CEOから新しい指示を受領",
        detail: plan.input,
        severity: "important",
      },
      ...plan.steps
        .filter((step) => step.agentId !== "coo")
        .slice(0, 3)
        .map((step) => ({
        id: nextId("act"),
        kind: "task.assigned" as const,
        agentId: "coo",
        at: now,
        message: "タスクを割り当て",
        detail: step.action,
        targetAgentId: step.agentId,
      })),
    ];

    set((s) => ({
      plans: [plan, ...s.plans],
      flows: [flow, ...s.flows],
      activity: [...events.reverse(), ...s.activity].slice(0, MAX_ACTIVITY),
      agents: s.agents.map((a) =>
        plan.steps.some((step) => step.agentId === a.id) && a.status === "idle"
          ? { ...a, status: "working" as const, currentTask: plan.input }
          : a,
      ),
    }));

    return plan;
  },

  sendChat: (input) => {
    const state = get();
    const reply = replyToCeo(input, {
      agents: state.agents,
      tasks: state.tasks,
      approvals: state.approvals,
    });

    const ceoMessage: ChatMessage = {
      id: nextId("msg"),
      role: "ceo",
      text: input,
      at: state.now,
    };

    const agentMessage: ChatMessage = {
      id: nextId("msg"),
      role: "agent",
      agentId: reply.agentId,
      text: reply.text,
      at: state.now + 900,
      routing: reply.routing,
    };

    set((s) => ({ chat: [...s.chat, ceoMessage, agentMessage] }));
  },
}));

/** Applies one simulator step to the store. Driven by the shell's interval. */
export function advanceSimulation() {
  const state = useCompany.getState();
  if (!state.simulating) return;

  // An AI employee may hit the edge of its authority and stop to ask.
  const openApprovals = state.approvals.filter(
    (a) => a.status === "pending" || a.status === "reviewing",
  );
  const seed = maybeRequestApproval(
    state.agents,
    openApprovals.length,
    new Set(openApprovals.map((a) => a.requestedBy)),
  );
  if (seed) {
    useCompany.getState().requestAgentApproval({
      kind: seed.kind,
      title: seed.title,
      summary: seed.summary,
      impact: seed.impact,
      requestedBy: seed.agentId,
      at: state.now,
      risk: seed.risk,
      priority: seed.priority,
      payload: seed.payload,
      href: "/command",
    });
  }

  const balance = rebalanceWorkforce(state.agents);
  if (balance) {
    useCompany.setState((s) => ({
      agents: s.agents.map((a) =>
        a.id === balance.agentId
          ? { ...a, status: balance.status, currentTask: balance.currentTask ?? a.currentTask }
          : a,
      ),
    }));
  }

  const step = nextSimulationStep(useCompany.getState().agents, state.now);
  if (!step) return;

  useCompany.setState((s) => ({
    activity: [step.event, ...s.activity].slice(0, MAX_ACTIVITY),
    agents: step.status
      ? s.agents.map((a) =>
          a.id === step.status!.agentId
            ? {
                ...a,
                status: step.status!.status,
                lastActiveMinutesAgo: 0,
                tasksCompleted: step.completed === a.id ? a.tasksCompleted + 1 : a.tasksCompleted,
              }
            : a,
        )
      : s.agents,
    flows: s.flows.map(advanceFlow),
  }));
}

/** Nudges one queued step of a flow forward so collaboration visibly moves. */
function advanceFlow(flow: CollaborationFlow): CollaborationFlow {
  if (Math.random() > 0.12) return flow;

  const activeIndex = flow.steps.findIndex((s) => s.state === "active");
  if (activeIndex === -1) return flow;

  const nextIndex = flow.steps.findIndex((s, i) => i > activeIndex && s.state === "queued");
  if (nextIndex === -1) return flow;

  return {
    ...flow,
    steps: flow.steps.map((s, i) =>
      i === activeIndex
        ? { ...s, state: "done" as const }
        : i === nextIndex
          ? { ...s, state: "active" as const, at: Date.now() }
          : s,
    ),
  };
}
