"use client";

import type {
  ActivityEvent,
  Approval,
  NotificationItem,
  Report,
  Task,
} from "@/lib/types";

/**
 * Client side of the live agent layer.
 *
 * In demo mode every one of these no-ops and the mock simulator keeps driving
 * the dashboard. In live mode they are how the CEO's actions reach the AI
 * employees, and how their work comes back.
 */

export type RuntimeMode = "live" | "demo" | "unknown";

export interface RuntimeStatus {
  mode: RuntimeMode;
  transport?: "claude" | "stub";
  model: string;
  workerModel: string;
  webTools: boolean;
  codeExecution: boolean;
  maxSteps: number;
  maxDelegations: number;
  /** Which external services are wired up. Never the credentials themselves. */
  integrations?: { google: boolean; note: boolean };
  noteOutput?: "file" | "draft" | "publish";
  noteDailyDraftAt?: string;
}

export interface AgentRunSummary {
  id: string;
  agentId: string;
  objective: string;
  status: "running" | "completed" | "failed" | "waiting_for_ceo";
  startedAt: number;
  finishedAt?: number;
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
  toolCalls: { name: string; at: number; summary: string }[];
  result?: string;
  error?: string;
  approvalId?: string;
  parentRunId?: string;
}

export interface ServerState {
  mode: "live" | "demo";
  updatedAt?: number;
  activity?: ActivityEvent[];
  tasks?: Task[];
  reports?: Report[];
  approvals?: Approval[];
  notifications?: NotificationItem[];
  agents?: Record<
    string,
    { status: string; currentTask?: string; lastActiveAt: number; tasksCompleted: number }
  >;
  runs?: AgentRunSummary[];
  usage?: { inputTokens: number; outputTokens: number; runs: number };
  noteDrafts?: NoteDraftSummary[];
}

/** A note article waiting for the CEO to post it. */
export interface NoteDraftSummary {
  id: string;
  title: string;
  body: string;
  tags: string[];
  rationale: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  status: "READY" | "POSTED" | "ARCHIVED";
  file: string;
  postedAt?: number;
  noteUrl?: string;
}

export async function setNoteDraftStatus(
  id: string,
  status: NoteDraftSummary["status"],
  noteUrl?: string,
): Promise<void> {
  await post("/api/note-drafts", { id, status, noteUrl });
}

/**
 * How often the dashboard rings the company clock. Three minutes is frequent
 * enough that a 17:00 job starts by 17:03, and rare enough to be invisible.
 */
export const JOB_POLL_INTERVAL = 180_000;

/** Rings the company clock. Jobs are keyed by day, so extra calls are free. */
export async function pokeScheduler(force = false): Promise<void> {
  await fetch(`/api/cron${force ? "?force=1" : ""}`, { cache: "no-store" });
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      (detail as { message?: string; error?: string }).message ??
        (detail as { error?: string }).error ??
        `Request failed (${response.status})`,
    );
  }
  return (await response.json()) as T;
}

export async function fetchRuntimeStatus(): Promise<RuntimeStatus> {
  const response = await fetch("/api/runtime", { cache: "no-store" });
  if (!response.ok) throw new Error(`runtime status failed (${response.status})`);
  return (await response.json()) as RuntimeStatus;
}

export async function fetchServerState(): Promise<ServerState> {
  const response = await fetch("/api/state", { cache: "no-store" });
  if (!response.ok) throw new Error(`state failed (${response.status})`);
  return (await response.json()) as ServerState;
}

export function startCommand(instruction: string, agentId?: string) {
  return post<{ status: string; agentId: string }>("/api/command", { instruction, agentId });
}

export function askCompany(message: string, agentId?: string) {
  return post<{ text: string; agentId: string; status: string; error?: string }>("/api/chat", {
    message,
    agentId,
  });
}

export function requestReport(input: {
  type: string;
  projectId?: string;
  departmentId?: string;
}) {
  return post<{ status: string; agentId: string }>("/api/reports/generate", input);
}

export function submitDecision(input: {
  approvalId?: string;
  reportId?: string;
  decision: "approved" | "rejected" | "revision_requested";
  comment?: string;
}) {
  return post<{ status: string; resumed: boolean }>("/api/decisions", input);
}

/** How often the dashboard pulls the company's live state. */
export const LIVE_POLL_INTERVAL = 2500;
