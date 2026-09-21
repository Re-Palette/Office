import "server-only";

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SEED_ACTIVITY } from "@/lib/company/activity";
import { AGENTS } from "@/lib/company/agents";
import { SEED_APPROVALS, SEED_NOTIFICATIONS, SEED_REPORT_APPROVALS } from "@/lib/company/inbox";
import { SEED_REPORTS } from "@/lib/company/report-seed";
import { TASKS } from "@/lib/company/tasks";
import { SEED_NOW } from "@/lib/time";
import type {
  ActivityEvent,
  AgentStatus,
  Approval,
  NotificationItem,
  Report,
  Task,
} from "@/lib/types";
import type { PendingAction } from "@/server/agents/tools";
import { getConfig } from "./config";

/**
 * The company's working state, on the server, on disk.
 *
 * In demo mode nothing writes here. In live mode this is the source of truth:
 * AI employees append activity, create tasks, submit reports and raise approval
 * requests against it, and the dashboard reads it back.
 *
 * A JSON file is deliberate — one CEO, low write volume, zero setup, and it
 * survives restarts. Phase 3's Supabase migration replaces this module's six
 * exported functions and nothing else.
 */

export interface AgentRuntimeState {
  status: AgentStatus;
  currentTask?: string;
  lastActiveAt: number;
  tasksCompleted: number;
}

export interface AgentRun {
  id: string;
  agentId: string;
  /** What the employee was asked to do. */
  objective: string;
  status: "running" | "completed" | "failed" | "waiting_for_ceo";
  startedAt: number;
  finishedAt?: number;
  /** Set when the run is blocked at the approval gate. */
  approvalId?: string;
  parentRunId?: string;
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
  toolCalls: { name: string; at: number; summary: string }[];
  result?: string;
  error?: string;
  /**
   * Conversation so far, kept only while a run is paused at the approval gate
   * so it can pick up exactly where it stopped once the CEO decides.
   */
  messages?: unknown[];
  /**
   * The irreversible action this run asked permission for. Held here, outside
   * the conversation, so what finally executes is what the CEO approved.
   */
  pendingAction?: PendingAction;
  objectiveContext?: string;
  canDelegate?: boolean;
  canReport?: boolean;
  depth?: number;
}

export interface WorkState {
  version: 2;
  initialised: boolean;
  activity: ActivityEvent[];
  tasks: Task[];
  reports: Report[];
  approvals: Approval[];
  notifications: NotificationItem[];
  agents: Record<string, AgentRuntimeState>;
  runs: AgentRun[];
  /** Cumulative spend so the CEO can see what the company costs to run. */
  usage: { inputTokens: number; outputTokens: number; runs: number };
  updatedAt: number;
}

const MAX_ACTIVITY = 500;
const MAX_RUNS = 200;

/**
 * Seed data is authored relative to a fixed instant so the demo renders
 * identically on the server and the client. Live mode runs on real time, so
 * the seed is shifted onto the wall clock the first time the state is created
 * — otherwise brand-new work would appear to predate the company's history.
 */
function rebase<T extends object>(items: T[], keys: (keyof T)[], delta: number): T[] {
  return items.map((item) => {
    const copy = { ...item };
    for (const key of keys) {
      const value = copy[key];
      if (typeof value === "number") {
        copy[key] = (value + delta) as unknown as T[keyof T];
      }
    }
    return copy;
  });
}

function seedState(): WorkState {
  const delta = Date.now() - SEED_NOW;

  const activity = rebase([...SEED_ACTIVITY], ["at"], delta);
  const tasks = rebase([...TASKS], ["createdAt", "updatedAt", "deadline"], delta);
  const reports = rebase([...SEED_REPORTS], ["createdAt", "updatedAt", "reviewedAt"], delta);
  const approvals = rebase(
    [...SEED_REPORT_APPROVALS, ...SEED_APPROVALS],
    ["requestedAt", "deadline", "reviewedAt"],
    delta,
  );
  const notifications = rebase([...SEED_NOTIFICATIONS], ["createdAt"], delta);

  return {
    version: 2,
    initialised: true,
    activity,
    tasks,
    reports,
    approvals,
    notifications,
    agents: Object.fromEntries(
      AGENTS.map((a) => [
        a.id,
        {
          status: a.status,
          currentTask: a.currentTask,
          lastActiveAt: Date.now() - a.lastActiveMinutesAgo * 60_000,
          tasksCompleted: a.tasksCompleted,
        } satisfies AgentRuntimeState,
      ]),
    ),
    runs: [],
    usage: { inputTokens: 0, outputTokens: 0, runs: 0 },
    updatedAt: Date.now(),
  };
}

let cache: WorkState | null = null;

function filePath(): string {
  const { dataDir } = getConfig();
  return path.isAbsolute(dataDir)
    ? path.join(dataDir, "work-state.json")
    : path.join(process.cwd(), dataDir, "work-state.json");
}

export function readState(): WorkState {
  if (cache) return cache;

  try {
    const raw = readFileSync(filePath(), "utf8");
    const parsed = JSON.parse(raw) as WorkState;
    if (parsed?.version === 2 && parsed.initialised) {
      cache = parsed;
      return cache;
    }
  } catch {
    // No file yet, unreadable, or written by an older version — reseed.
  }

  cache = seedState();
  writeState(cache);
  return cache;
}

/** Atomic write: temp file then rename, so a crash can't truncate the state. */
function writeState(state: WorkState): void {
  const target = filePath();
  try {
    mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), "utf8");
    renameSync(tmp, target);
  } catch (error) {
    // A read-only filesystem (some serverless targets) must not break a run;
    // the in-memory copy stays authoritative for the life of the process.
    console.warn("[friday] could not persist work state:", (error as Error).message);
  }
}

/** The only mutation path. Keeps trimming and persistence in one place. */
export function mutate<T>(fn: (state: WorkState) => T): T {
  const state = readState();
  const result = fn(state);

  if (state.activity.length > MAX_ACTIVITY) {
    state.activity = state.activity.slice(0, MAX_ACTIVITY);
  }
  if (state.runs.length > MAX_RUNS) {
    state.runs = state.runs.slice(0, MAX_RUNS);
  }
  state.updatedAt = Date.now();

  cache = state;
  writeState(state);
  return result;
}

export function resetState(): WorkState {
  cache = seedState();
  writeState(cache);
  return cache;
}

/** Drops the in-memory copy so the next read comes from disk. */
export function invalidate(): void {
  cache = null;
}
