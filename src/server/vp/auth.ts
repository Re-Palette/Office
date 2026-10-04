import "server-only";

import { timingSafeEqual } from "node:crypto";
import { cleanSecret } from "@/server/runtime/config";
import { read } from "@/server/runtime/store";

/**
 * Who is allowed to operate the company from outside, and how far.
 *
 * The dashboard's own "auth" is a flag in localStorage with no server side at
 * all — so until now every API route was open to anyone who knew the URL,
 * including the one that releases an approved email. Handing an external
 * agent the keys is a reason to fix the lock first, not a reason to skip it.
 *
 * Scopes exist because "my vice-president" and "may act irreversibly on my
 * behalf" are different grants. Reading and instructing are safe: the
 * approval gate still stops anything irreversible, so the worst an operate
 * token can do is spend allowance and queue decisions for the CEO. Approving
 * is the one that reaches outside, so it is off unless explicitly granted.
 */

export type Scope = "read" | "operate" | "approve";

const ALL: Scope[] = ["read", "operate", "approve"];
const DEFAULT: Scope[] = ["read", "operate"];

export interface Grant {
  ok: true;
  /** Who the caller says it is, for the activity feed. */
  actor: string;
  scopes: Scope[];
}

export interface Denial {
  ok: false;
  status: 401 | 403 | 503;
  reason: string;
}

/**
 * The token agent access is checked against, or "" when none is set up.
 *
 * An environment variable wins when present, because someone who sets one
 * means it; otherwise the one minted in the app is used. Callers must have
 * the state loaded, which every route reaching this does.
 */
export function agentToken(): string {
  const fromEnv = cleanSecret(process.env.FRIDAY_AGENT_TOKEN);
  if (fromEnv) return fromEnv;
  return read((s) => s.agentAccess?.token ?? "");
}

/** Where the active token came from, for the setup screen. */
export function agentTokenSource(): "env" | "app" | "none" {
  if (cleanSecret(process.env.FRIDAY_AGENT_TOKEN)) return "env";
  return read((s) => (s.agentAccess?.token ? "app" : "none"));
}

export function agentScopes(): Scope[] {
  const raw = cleanSecret(process.env.FRIDAY_AGENT_SCOPES);
  if (!raw) return DEFAULT;
  const asked = raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is Scope => (ALL as string[]).includes(s));
  return asked.length > 0 ? asked : DEFAULT;
}

/**
 * Compares in constant time.
 *
 * A plain `===` on a secret leaks its prefix through timing, which is cheap
 * to avoid and awkward to retrofit. The length check first is deliberate:
 * timingSafeEqual throws on a length mismatch.
 */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Reads the bearer token off a request and decides what it may do. */
export function authorise(request: Request): Grant | Denial {
  const expected = agentToken();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      reason:
        "外部エージェント用のアクセスが設定されていません。FRIDAY_AGENT_TOKEN を設定してください。",
    };
  }
  // A token short enough to guess is not a lock. Refusing is better than
  // pretending: a 32-character minimum is one `openssl rand -hex 16`.
  if (expected.length < 32) {
    return {
      ok: false,
      status: 503,
      reason:
        "FRIDAY_AGENT_TOKEN が短すぎます（32文字以上にしてください）。" +
        "`openssl rand -hex 32` で生成できます。",
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = header.replace(/^Bearer\s+/i, "").trim();
  if (!presented) {
    return { ok: false, status: 401, reason: "Authorization: Bearer <token> が必要です。" };
  }
  if (!sameSecret(presented, expected)) {
    return { ok: false, status: 401, reason: "トークンが一致しません。" };
  }

  return {
    ok: true,
    actor: (request.headers.get("x-friday-actor") ?? "FRIDAY（副社長）").slice(0, 60),
    scopes: agentScopes(),
  };
}

export function has(grant: Grant, scope: Scope): boolean {
  return grant.scopes.includes(scope);
}
