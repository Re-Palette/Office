"use client";

import { useEffect, useState } from "react";

const KEY = "friday.session";

export interface Session {
  name: string;
  role: string;
  at: number;
}

export const CEO: Session = { name: "陽大", role: "CEO / Founder", at: 0 };

export function readSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function signIn(): Session {
  const session = { ...CEO, at: Date.now() };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable — session stays in memory for this tab */
  }
  return session;
}

export function signOut() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}

/**
 * Mock auth. Phase 3 swaps the body for a Supabase session listener; the
 * three states (`loading` / `null` / `Session`) stay the same.
 */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSession(readSession());
    setLoading(false);
  }, []);

  return { session, loading, setSession };
}
