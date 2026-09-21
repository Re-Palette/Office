"use client";

import type { Approval, NotificationItem, Report, Task } from "@/lib/types";

/**
 * The CEO's decisions outlive a page reload.
 *
 * Only what the human did is persisted — approvals, report reviews, which
 * notifications were read, and reports generated at runtime. Everything else
 * (the workforce, the activity stream, the clock) is regenerated from the seed
 * on boot, so the dashboard stays live while the decisions stick.
 *
 * Phase 3 replaces this file with Supabase; the shape below is what the tables
 * will hold.
 */

const KEY = "friday.ceo-state.v1";

export interface PersistedDecisions {
  approvals: Record<
    string,
    Pick<Approval, "status" | "reviewedAt" | "reviewedBy" | "reviewComment">
  >;
  reports: Record<
    string,
    Pick<Report, "status" | "reviewedAt" | "reviewedBy" | "reviewComment">
  >;
  tasks: Record<string, Pick<Task, "status" | "blockedReason">>;
  /** Reports the AI generated during a session — seeds are not stored. */
  generated: Report[];
  readNotifications: string[];
  /** Notifications created at runtime, so their deep links survive too. */
  liveNotifications: NotificationItem[];
  dismissedBannerId?: string;
  savedAt: number;
}

const EMPTY: PersistedDecisions = {
  approvals: {},
  reports: {},
  tasks: {},
  generated: [],
  readNotifications: [],
  liveNotifications: [],
  savedAt: 0,
};

export function loadDecisions(): PersistedDecisions | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDecisions;
    return { ...EMPTY, ...parsed };
  } catch {
    return null;
  }
}

export function saveDecisions(state: PersistedDecisions): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
  } catch {
    // Quota or private mode — the session still works, it just won't persist.
  }
}

export function clearDecisions(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}
