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
import type { NoteDraft } from "@/server/note-drafts";
import type { JobRun } from "@/server/scheduler";
import { getConfig, type StorageStatus } from "./config";
import {
  insertRow,
  loadRow,
  mergeState,
  updateRow,
  type SupabaseCredentials,
} from "./supabase-store";

/**
 * The company's working state, on the server, on disk.
 *
 * In demo mode nothing writes here. In live mode this is the source of truth:
 * AI employees append activity, create tasks, submit reports and raise approval
 * requests against it, and the dashboard reads it back.
 *
 * Two backends sit behind one synchronous API. Without Supabase configured it
 * is a JSON file — one CEO, low write volume, zero setup, survives restarts.
 * With Supabase it is a single row, which is what makes this work on
 * serverless, where /tmp belongs to one instance and disappears.
 *
 * Both keep the same shape: callers still mutate a plain object synchronously.
 * What changes is when it is persisted — a request loads once at the start and
 * flushes at the end, so nothing downstream had to become async.
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
  /** note articles waiting for the CEO to post them. */
  noteDrafts: NoteDraft[];
  /** Recurring jobs, keyed by the JST day they last ran for. */
  jobs: JobRun[];
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
    noteDrafts: [],
    jobs: [],
    usage: { inputTokens: 0, outputTokens: 0, runs: 0 },
    updatedAt: Date.now(),
  };
}

let cache: WorkState | null = null;
/** Version of the row `cache` was loaded from. 0 means "not from Supabase". */
let baseVersion = 0;
/** Set by mutate(); cleared once the change has reached the backend. */
let dirty = false;
let inFlight: Promise<void> | null = null;
let queued = false;
/**
 * Why the last Supabase call failed, if it did.
 *
 * Configured and working are not the same thing: a mistyped key leaves every
 * environment variable present, and the fallback to memory is deliberately
 * quiet so a database blip cannot take the company down. Without this the two
 * look identical from outside until data starts disappearing.
 */
let storageError: string | null = null;

function credentials(): SupabaseCredentials | null {
  const { supabase } = getConfig();
  return supabase.configured ? { url: supabase.url, serviceKey: supabase.serviceKey } : null;
}

/** What is holding the state, and whether it is actually reachable. */
export function storageStatus(): StorageStatus {
  if (!credentials()) return { backend: "file", healthy: true, error: null };
  return { backend: "supabase", healthy: storageError === null, error: storageError };
}

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
      // Fields added after a state file was written default rather than
      // forcing a reseed — the CEO's work outlives a schema change.
      parsed.noteDrafts ??= [];
      parsed.jobs ??= [];
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

/**
 * Reads the state without marking it dirty.
 *
 * The distinction matters on Supabase: the dashboard polls every couple of
 * seconds, and if a look counted as a change, that polling would write the row
 * constantly and collide with whatever an AI employee was doing.
 */
export function read<T>(fn: (state: WorkState) => T): T {
  return fn(readState());
}

/**
 * The only mutation path. Keeps trimming and persistence in one place.
 *
 * Every call is treated as a write — detecting "did this actually change
 * anything" by inspection was tried and got it wrong, because most writers
 * edit a field in place and leave every length and counter untouched. Callers
 * that only look use read() instead, and say so.
 */
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
  dirty = true;

  if (credentials()) scheduleFlush();
  else writeState(state);

  return result;
}

/* ── Loading and flushing around a request ────────────────────────────────── */

/**
 * Pulls the current state in. Call once at the start of a request.
 *
 * On the file backend this is what readState() already did. On Supabase it is
 * the row — and it has to happen per request, because a serverless instance
 * that handled the last one may never see this one.
 */
export async function loadState(): Promise<WorkState> {
  const creds = credentials();
  if (!creds) return readState();

  try {
    const stored = await loadRow(creds);
    if (stored) {
      stored.state.noteDrafts ??= [];
      stored.state.jobs ??= [];
      cache = stored.state;
      baseVersion = stored.version;
      dirty = false;
      storageError = null;
      return cache;
    }

    // First run against an empty database.
    const seeded = seedState();
    const version = await insertRow(creds, seeded);
    if (version === null) {
      // Someone seeded it a moment before us; take theirs.
      const theirs = await loadRow(creds);
      if (theirs) {
        theirs.state.noteDrafts ??= [];
        theirs.state.jobs ??= [];
        cache = theirs.state;
        baseVersion = theirs.version;
        dirty = false;
        storageError = null;
        return cache;
      }
    }
    cache = seeded;
    baseVersion = version ?? 1;
    dirty = false;
    storageError = null;
    return cache;
  } catch (error) {
    // Supabase unreachable. Falling back to memory keeps the company running
    // rather than failing the CEO's request outright — but it is recorded, so
    // the dashboard can say the state is not being saved.
    storageError = (error as Error).message;
    console.warn("[friday] Supabase load failed:", storageError);
    return readState();
  }
}

/** Coalesced background write, so a long agent run is not a write per step. */
function scheduleFlush(): void {
  if (inFlight) {
    queued = true;
    return;
  }
  inFlight = push().finally(() => {
    inFlight = null;
    if (queued) {
      queued = false;
      scheduleFlush();
    }
  });
}

async function push(): Promise<void> {
  const creds = credentials();
  if (!creds || !cache || !dirty) return;

  const pending = cache;
  dirty = false;

  try {
    const version = await updateRow(creds, pending, baseVersion);
    if (version !== null) {
      baseVersion = version;
      storageError = null;
      return;
    }

    // Someone wrote while we worked. Merge rather than overwrite, so neither
    // side's work is the one that quietly disappears.
    const theirs = await loadRow(creds);
    if (!theirs) return;

    const merged = mergeState(theirs.state, pending);
    const retried = await updateRow(creds, merged, theirs.version);
    cache = merged;

    if (retried !== null) {
      baseVersion = retried;
    } else {
      // Lost twice. Leave it dirty so the next flush picks it up.
      baseVersion = theirs.version;
      dirty = true;
    }
  } catch (error) {
    storageError = (error as Error).message;
    console.warn("[friday] Supabase write failed:", storageError);
    dirty = true;
  }
}

/** Waits for every pending write. Call before a request finishes. */
export async function flushState(): Promise<void> {
  if (!credentials()) return;
  if (dirty) scheduleFlush();
  while (inFlight) await inFlight;
}

/**
 * Loads, runs, flushes. Every route that touches company state uses this, so
 * no handler has to remember both halves.
 */
export async function withState<T>(fn: () => Promise<T> | T): Promise<T> {
  await loadState();
  try {
    return await fn();
  } finally {
    await flushState();
  }
}

export function resetState(): WorkState {
  cache = seedState();
  if (credentials()) {
    dirty = true;
    scheduleFlush();
  } else {
    writeState(cache);
  }
  return cache;
}

/** Drops the in-memory copy so the next read comes from the backend. */
export function invalidate(): void {
  cache = null;
  baseVersion = 0;
  dirty = false;
}
