import { AGENTS } from "@/lib/company/agents";
import { PROJECTS } from "@/lib/company/projects";
import type { ActivityEvent, ActivityKind, Agent, AgentStatus } from "@/lib/types";

/**
 * Mock Agent System.
 *
 * Emits a believable stream of AI-employee activity so the UI behaves like a
 * live company before the Claude API is wired in. Every event it produces is
 * shaped exactly like a real one, so Phase 4 only has to change the source.
 */

const WORK_STATES: AgentStatus[] = [
  "working", "thinking", "researching", "coding", "writing", "designing",
];

const STATUS_BY_DEPARTMENT: Record<string, AgentStatus[]> = {
  engineering: ["coding", "working", "thinking"],
  research: ["researching", "thinking", "working"],
  marketing: ["researching", "writing", "working"],
  creative: ["designing", "writing", "working"],
  sales: ["working", "researching", "writing"],
  finance: ["working", "thinking"],
  strategy: ["thinking", "working"],
  operations: ["working", "writing"],
};

const TOOL_LABEL: Record<string, string> = {
  web_research: "web_research",
  browser: "browser",
  code_execution: "code_execution",
  file_search: "file_search",
  database: "database",
  email: "email",
  calendar: "calendar",
  analytics: "analytics",
  social_media: "social_media",
  github: "github",
  design: "design",
  deploy: "deploy",
};

const FINDINGS = [
  "関連する一次情報を{n}件特定しました",
  "競合の新しい動きを{n}件検出しました",
  "前週比で外れ値となる指標を{n}件発見しました",
  "条件に合致する候補を{n}件追加しました",
  "参考になる類似事例を{n}件収集しました",
];

const COMPLETIONS = [
  "分析を完了し、要約を保存しました",
  "レビューを完了しました",
  "ドラフトを作成しました",
  "検証を完了しました",
  "整理を完了し、担当へ共有しました",
];

const STARTS = [
  "タスクを開始",
  "調査を開始",
  "下書きを開始",
  "検証を開始",
];

const THINKING = [
  "前提条件を整理しています",
  "選択肢を3案に絞り込んでいます",
  "依存関係を確認しています",
  "優先順位を再評価しています",
];

let counter = 0;

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function id() {
  return `sim-${Date.now().toString(36)}-${(counter++).toString(36)}`;
}

export interface SimulationStep {
  event: ActivityEvent;
  /** Optional status transition applied to the acting agent. */
  status?: { agentId: string; status: AgentStatus; currentTask?: string };
  /** Increment of the acting agent's completed counter. */
  completed?: string;
}

const ACTING_STATES = new Set<AgentStatus>([
  "working", "thinking", "researching", "coding", "writing", "designing", "completed",
]);

/** Produces one activity step. Called on every simulator tick. */
export function nextSimulationStep(agents: Agent[], now: number): SimulationStep | null {
  // Only employees who are actually on the clock generate activity. Idle, waiting
  // and approval-blocked agents stay quiet until the balancer or the CEO wakes them.
  const candidates = agents.filter((a) => ACTING_STATES.has(a.status));
  if (candidates.length === 0) return null;

  const agent = pick(candidates);
  const roll = Math.random();

  const base = { id: id(), agentId: agent.id, at: now } as const;

  // Hand-off between employees — the collaboration signal.
  if (roll < 0.14) {
    const partnerPool = agent.collaborators.length > 0
      ? agent.collaborators
      : AGENTS.filter((a) => a.id !== agent.id).map((a) => a.id);
    const target = pick(partnerPool);
    return {
      event: {
        ...base,
        kind: "agent.handoff" satisfies ActivityKind,
        message: `${labelOf(target)} へ作業を引き渡し`,
        detail: agent.currentTask ?? "進行中のタスク",
        targetAgentId: target,
      },
      status: { agentId: agent.id, status: "working" },
    };
  }

  if (roll < 0.3) {
    const tool = agent.tools.length > 0 ? pick(agent.tools) : "file_search";
    return {
      event: {
        ...base,
        kind: "agent.tool_called",
        message: "ツールを実行",
        detail: `tool: ${TOOL_LABEL[tool] ?? tool}`,
      },
      status: {
        agentId: agent.id,
        status: pick(STATUS_BY_DEPARTMENT[agent.department] ?? WORK_STATES),
      },
    };
  }

  if (roll < 0.44) {
    const n = 2 + Math.floor(Math.random() * 14);
    return {
      event: {
        ...base,
        kind: "insight.found",
        message: pick(FINDINGS).replace("{n}", String(n)),
        detail: agent.currentTask,
        severity: n > 10 ? "important" : "normal",
      },
      status: { agentId: agent.id, status: "researching" },
    };
  }

  if (roll < 0.6) {
    return {
      event: {
        ...base,
        kind: "agent.completed",
        message: pick(COMPLETIONS),
        detail: agent.currentTask,
      },
      status: { agentId: agent.id, status: "completed" },
      completed: agent.id,
    };
  }

  if (roll < 0.72) {
    const project = pick(PROJECTS);
    return {
      event: {
        ...base,
        kind: "task.created",
        message: "新しいタスクを作成",
        detail: `${project.name} — ${pick([
          "次のマイルストーンの準備",
          "レビュー指摘の反映",
          "追加調査",
          "資料の更新",
        ])}`,
        projectId: project.id,
      },
    };
  }

  if (roll < 0.84) {
    return {
      event: {
        ...base,
        kind: "agent.thinking",
        message: pick(THINKING),
        detail: agent.currentTask,
      },
      status: { agentId: agent.id, status: "thinking" },
    };
  }

  return {
    event: {
      ...base,
      kind: "agent.started",
      message: pick(STARTS),
      detail: agent.currentTask,
    },
    status: {
      agentId: agent.id,
      status: pick(STATUS_BY_DEPARTMENT[agent.department] ?? WORK_STATES),
    },
  };
}

function labelOf(agentId: string): string {
  return AGENTS.find((a) => a.id === agentId)?.role ?? agentId;
}

/**
 * Keeps the workforce inside a believable band instead of letting every agent
 * drift into "working". Returns the status change to apply, if any.
 */
export function rebalanceWorkforce(
  agents: Agent[],
): { agentId: string; status: AgentStatus; currentTask?: string } | null {
  const active = agents.filter((a) => ACTIVE_BAND_STATES.has(a.status));

  if (active.length > ACTIVE_BAND.max) {
    // Stand down a specialist — executives are always on the clock.
    const pool = active.filter((a) => a.seniority !== "executive");
    if (pool.length === 0) return null;
    const agent = pick(pool);
    return { agentId: agent.id, status: "completed", currentTask: agent.currentTask };
  }

  if (active.length < ACTIVE_BAND.min) {
    const pool = agents.filter((a) => a.status === "idle" || a.status === "completed");
    if (pool.length === 0) return null;
    const agent = pick(pool);
    return {
      agentId: agent.id,
      status: pick(STATUS_BY_DEPARTMENT[agent.department] ?? WORK_STATES),
      currentTask: pick(WAKE_TASKS),
    };
  }

  // Inside the band: occasionally retire a finished agent so the roster breathes.
  const finished = agents.filter((a) => a.status === "completed");
  if (finished.length > 4 && Math.random() < 0.35) {
    return { agentId: pick(finished).id, status: "idle", currentTask: "待機中" };
  }

  return null;
}

const ACTIVE_BAND = { min: 14, max: 21 };

const ACTIVE_BAND_STATES = new Set<AgentStatus>([
  "working", "thinking", "researching", "coding", "writing", "designing",
]);

const WAKE_TASKS = [
  "COOから割り当てられたタスクを開始",
  "担当領域の最新状況を確認",
  "保留していた調査を再開",
  "レビュー指摘の反映",
  "次のマイルストーンの準備",
];

/** Tick interval for the mock stream, in ms. */
export const SIM_INTERVAL = 3200;
export const CLOCK_INTERVAL = 1000;
export const MAX_ACTIVITY = 200;
