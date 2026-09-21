"use client";

import { create } from "zustand";
import { AGENTS } from "@/lib/company/agents";
import { SEED_ACTIVITY } from "@/lib/company/activity";
import {
  SEED_APPROVALS,
  SEED_FLOWS,
  SEED_NOTIFICATIONS,
  SEED_RECOMMENDATIONS,
} from "@/lib/company/inbox";
import { TASKS } from "@/lib/company/tasks";
import { DEFAULT_SCHEDULE } from "@/lib/company/reports";
import { planCommand, type CommandPlan } from "@/lib/engine/orchestrator";
import { replyToCeo } from "@/lib/engine/chat";
import { MAX_ACTIVITY, nextSimulationStep, rebalanceWorkforce } from "@/lib/engine/simulator";
import { SEED_NOW } from "@/lib/time";
import type {
  ActivityEvent,
  Agent,
  Approval,
  ChatMessage,
  CollaborationFlow,
  NotificationItem,
  Recommendation,
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
  schedule: ScheduleConfig;

  rightPanelOpen: boolean;

  tick: () => void;
  startClock: () => void;
  toggleSimulation: () => void;
  toggleRightPanel: () => void;

  decideApproval: (id: string, decision: Approval["status"]) => void;
  decideRecommendation: (id: string, decision: "approved" | "rejected") => void;
  markNotificationsRead: () => void;

  runCommand: (input: string) => CommandPlan;
  sendChat: (input: string) => void;
}

let messageCounter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${messageCounter++}`;

export const useCompany = create<CompanyState>((set, get) => ({
  now: SEED_NOW,
  hydrated: false,
  simulating: true,

  agents: AGENTS,
  tasks: TASKS,
  activity: SEED_ACTIVITY,
  approvals: SEED_APPROVALS,
  recommendations: SEED_RECOMMENDATIONS,
  flows: SEED_FLOWS,
  notifications: SEED_NOTIFICATIONS,
  chat: [],
  plans: [],
  schedule: DEFAULT_SCHEDULE,

  rightPanelOpen: true,

  startClock: () => set({ hydrated: true }),

  tick: () => {
    const state = get();
    const now = state.now + 1000;
    set({ now });
  },

  toggleSimulation: () => set((s) => ({ simulating: !s.simulating })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),

  decideApproval: (id, decision) =>
    set((s) => {
      const approval = s.approvals.find((a) => a.id === id);
      if (!approval) return s;

      const event: ActivityEvent | null =
        decision === "approved" || decision === "rejected"
          ? {
              id: nextId("act"),
              kind: decision === "approved" ? "approval.approved" : "approval.rejected",
              agentId: approval.requestedBy,
              at: s.now,
              message: decision === "approved" ? "CEOが承認しました" : "CEOが却下しました",
              detail: approval.title,
              severity: "important",
            }
          : null;

      return {
        approvals: s.approvals.map((a) => (a.id === id ? { ...a, status: decision } : a)),
        activity: event ? [event, ...s.activity].slice(0, MAX_ACTIVITY) : s.activity,
        agents:
          decision === "approved"
            ? s.agents.map((a) =>
                a.id === approval.requestedBy && a.status === "needs_approval"
                  ? { ...a, status: "working" as const }
                  : a,
              )
            : s.agents,
        notifications: s.notifications.map((n) =>
          n.agentId === approval.requestedBy && n.kind === "approval" ? { ...n, read: true } : n,
        ),
      };
    }),

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

  markNotificationsRead: () =>
    set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),

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
