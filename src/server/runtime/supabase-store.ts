import "server-only";

import type { WorkState } from "./store";

/**
 * Supabase as the company's memory.
 *
 * Serverless has no shared disk: the nightly job writes into one instance's
 * /tmp and the dashboard reads from another, so work vanishes. This is what
 * fixes that — one row, holding the same WorkState the file store held.
 *
 * Keeping it as one row is deliberate. The existing call sites mutate a plain
 * object synchronously; splitting into tables would mean rewriting every one
 * of them. Instead a request loads the row, mutates in memory exactly as
 * before, and writes back — and `version` makes that write safe.
 *
 * PostgREST is reached over fetch rather than through the JS client, so this
 * adds no dependency and no bundle weight.
 */

export interface StoredState {
  state: WorkState;
  version: number;
}

export interface SupabaseCredentials {
  url: string;
  /**
   * The service role key. Server-only: it bypasses row-level security, so it
   * must never reach the browser. The table has RLS on with no policies, so
   * nothing else can read it even if a publishable key leaked.
   */
  serviceKey: string;
}

export class SupabaseStoreError extends Error {}

function headers(creds: SupabaseCredentials): Record<string, string> {
  return {
    apikey: creds.serviceKey,
    authorization: `Bearer ${creds.serviceKey}`,
    "content-type": "application/json",
  };
}

const ROW = "/rest/v1/work_state";

async function request(
  creds: SupabaseCredentials,
  path: string,
  init: RequestInit,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${creds.url}${path}`, {
      ...init,
      headers: { ...headers(creds), ...(init.headers ?? {}) },
      cache: "no-store",
    });
  } catch (error) {
    // DNS failure, wrong host, no network. The message alone ("fetch failed")
    // says nothing, so the host being dialled goes in it.
    throw new SupabaseStoreError(
      `${creds.url} に接続できませんでした: ${(error as Error).message}`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    const detail = await response.text().catch(() => "");
    throw new SupabaseStoreError(
      `Supabase への認証に失敗しました (${response.status}): ${detail.slice(0, 200)}。` +
        "Settings → API Keys の Secret keys（sb_secret_…）を SUPABASE_SERVICE_ROLE_KEY に設定してください。",
    );
  }
  if (response.status === 404) {
    const detail = await response.text().catch(() => "");
    throw new SupabaseStoreError(
      `work_state テーブルが見つかりません (404): ${detail.slice(0, 200)}。` +
        `URL（${creds.url}）が正しいプロジェクトのものか、マイグレーションが適用済みか確認してください。`,
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new SupabaseStoreError(
      `Supabase エラー (${response.status}) at ${creds.url}: ${detail.slice(0, 200) || "unknown"}`,
    );
  }
  return response;
}

/** Reads the single row. Returns null the first time, before anything exists. */
export async function loadRow(creds: SupabaseCredentials): Promise<StoredState | null> {
  const response = await request(
    creds,
    `${ROW}?id=eq.singleton&select=state,version`,
    { method: "GET" },
  );
  const rows = (await response.json()) as { state: WorkState; version: number }[];
  if (!rows.length) return null;
  return { state: rows[0].state, version: rows[0].version };
}

/** Writes the row for the first time. Returns null if someone beat us to it. */
export async function insertRow(
  creds: SupabaseCredentials,
  state: WorkState,
): Promise<number | null> {
  const response = await fetch(`${creds.url}${ROW}`, {
    method: "POST",
    headers: {
      ...headers(creds),
      // A second instance seeding at the same moment must lose, not overwrite.
      prefer: "return=representation,resolution=ignore-duplicates",
    },
    body: JSON.stringify({ id: "singleton", version: 1, state }),
    cache: "no-store",
  });

  if (response.status === 409) return null;
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new SupabaseStoreError(
      `Supabase への初期化に失敗しました (${response.status}): ${detail.slice(0, 200)}`,
    );
  }

  const rows = (await response.json()) as { version: number }[];
  return rows.length ? rows[0].version : null;
}

/**
 * Writes the row, but only if it still holds the version we read.
 *
 * Returns the new version, or null when someone else wrote first — the caller
 * then reloads, merges, and tries again rather than overwriting their work.
 */
export async function updateRow(
  creds: SupabaseCredentials,
  state: WorkState,
  expectedVersion: number,
): Promise<number | null> {
  const response = await request(
    creds,
    `${ROW}?id=eq.singleton&version=eq.${expectedVersion}`,
    {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({
        version: expectedVersion + 1,
        state,
        updated_at: new Date().toISOString(),
      }),
    },
  );

  const rows = (await response.json()) as { version: number }[];
  // No rows matched: the version moved on under us.
  return rows.length ? rows[0].version : null;
}

/* ── Merging a losing write ───────────────────────────────────────────────── */

type Identified = { id: string };

/**
 * Union by id, ours winning a tie.
 *
 * Every list in WorkState is append-to-front and keyed by a unique id, so two
 * writers that each added something end up with both — which is the point. A
 * record one of them edited keeps our copy, because we are the one retrying.
 */
function mergeById<T extends Identified>(theirs: T[], ours: T[], order?: (item: T) => number): T[] {
  const byId = new Map<string, T>();
  for (const item of theirs) byId.set(item.id, item);
  for (const item of ours) byId.set(item.id, item);

  const merged = [...byId.values()];
  if (order) merged.sort((a, b) => order(b) - order(a));
  return merged;
}

/**
 * Reconciles our state with one written while we were working.
 *
 * Used only when an optimistic write loses, which needs two writers at once —
 * the nightly job and the CEO, say. Rare, but "rare" is not "never", and the
 * alternative is silently discarding whichever article came second.
 */
export function mergeState(theirs: WorkState, ours: WorkState): WorkState {
  return {
    ...ours,
    activity: mergeById(theirs.activity, ours.activity, (e) => e.at).slice(0, 500),
    tasks: mergeById(theirs.tasks, ours.tasks, (t) => t.updatedAt),
    reports: mergeById(theirs.reports, ours.reports, (r) => r.updatedAt),
    approvals: mergeById(theirs.approvals, ours.approvals, (a) => a.requestedAt),
    notifications: mergeById(theirs.notifications, ours.notifications, (n) => n.createdAt),
    runs: mergeById(theirs.runs, ours.runs, (r) => r.startedAt).slice(0, 200),
    noteDrafts: mergeById(theirs.noteDrafts ?? [], ours.noteDrafts ?? [], (d) => d.updatedAt),

    // Jobs are keyed by id+day rather than a unique id, so they are merged on
    // that pair: one "ran today" record per job, whoever wrote it.
    jobs: dedupeJobs([...(ours.jobs ?? []), ...(theirs.jobs ?? [])]).slice(0, 100),

    // Whichever side saw an employee more recently has the truer picture.
    agents: mergeAgents(theirs.agents, ours.agents),

    // Monotonic counters: the larger reading is the one that saw more.
    usage: {
      inputTokens: Math.max(theirs.usage.inputTokens, ours.usage.inputTokens),
      outputTokens: Math.max(theirs.usage.outputTokens, ours.usage.outputTokens),
      runs: Math.max(theirs.usage.runs, ours.usage.runs),
    },
    updatedAt: Date.now(),
  };
}

function dedupeJobs(jobs: WorkState["jobs"]): WorkState["jobs"] {
  const seen = new Map<string, WorkState["jobs"][number]>();
  for (const job of jobs) {
    const key = `${job.id}:${job.ranFor}`;
    const existing = seen.get(key);
    // A completed run beats one still marked in-flight, whoever wrote it.
    if (!existing || (job.ok && !existing.ok) || (job.ok === existing.ok && job.at > existing.at)) {
      seen.set(key, job);
    }
  }
  return [...seen.values()].sort((a, b) => b.at - a.at);
}

function mergeAgents(theirs: WorkState["agents"], ours: WorkState["agents"]): WorkState["agents"] {
  const merged: WorkState["agents"] = { ...theirs };
  for (const [id, mine] of Object.entries(ours)) {
    const other = theirs[id];
    merged[id] = !other || mine.lastActiveAt >= other.lastActiveAt ? mine : other;
  }
  return merged;
}
