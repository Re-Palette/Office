import "server-only";

import { getConfig } from "@/server/runtime/config";

/**
 * Gmail and Google Calendar, for real.
 *
 * One OAuth client covers both, which is why they live in one module: a single
 * consent screen unlocks eleven AI employees. Authentication is a stored
 * refresh token exchanged for short-lived access tokens — no browser round
 * trip at run time, so an AI employee working at 3am still has valid
 * credentials.
 *
 * Nothing here decides whether an action is allowed. Sending mail and putting
 * an event on the CEO's calendar are irreversible, so the gate that stops them
 * lives in the tool layer (src/server/agents/tools.ts), above this module.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR = "https://www.googleapis.com/calendar/v3";

/** The scopes the refresh token must have been granted. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

export interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
}

export interface SendEmailInput {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  /** Replies keep the thread intact rather than starting a new one. */
  inReplyToMessageId?: string;
}

export interface SendEmailResult {
  id: string;
  threadId: string;
  to: string[];
  subject: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  attendees: string[];
  status: string;
  htmlLink?: string;
}

export interface CreateEventInput {
  summary: string;
  /** RFC3339, e.g. 2026-09-24T14:00:00+09:00 */
  start: string;
  end: string;
  description?: string;
  location?: string;
  attendees?: string[];
}

/**
 * The surface the tools use. Declaring it lets the self-test drive the whole
 * approval → send path without touching Google.
 */
export interface GoogleClient {
  searchEmail(query: string, limit: number): Promise<EmailSummary[]>;
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
  listEvents(timeMin: string, timeMax: string, limit: number): Promise<CalendarEvent[]>;
  createEvent(input: CreateEventInput): Promise<CalendarEvent>;
}

export class GoogleAuthError extends Error {}
export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/* ── Access tokens ────────────────────────────────────────────────────────── */

let token: { value: string; expiresAt: number } | null = null;

/** Exported for the self-test; a process restart clears it anyway. */
export function resetGoogleToken(): void {
  token = null;
}

async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;

  const { google } = getConfig();
  if (!google.configured) {
    throw new GoogleAuthError(
      "Google連携が未設定です。GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN を設定してください。",
    );
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: google.clientId,
      client_secret: google.clientSecret,
      refresh_token: google.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    // invalid_grant is the one every setup hits: the token was revoked, the
    // consent expired, or the app is still in "Testing" with a 7-day token.
    const detail = payload.error_description ?? payload.error ?? `HTTP ${response.status}`;
    throw new GoogleAuthError(
      payload.error === "invalid_grant"
        ? `Googleのリフレッシュトークンが無効です（${detail}）。Settings の手順で取り直してください。`
        : `Googleの認証に失敗しました: ${detail}`,
    );
  }

  token = {
    value: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
  return token.value;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${await accessToken()}`,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let detail = text.slice(0, 300);
    try {
      detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? detail;
    } catch {
      // Not JSON — the raw body is the best description available.
    }
    if (response.status === 401 || response.status === 403) {
      // 403 here is almost always a missing scope, which re-consent fixes.
      throw new GoogleAuthError(
        `Googleへのアクセスが拒否されました（${response.status}）: ${detail}。必要なスコープが許可されているか確認してください。`,
      );
    }
    throw new GoogleApiError(detail || `HTTP ${response.status}`, response.status);
  }

  return (await response.json()) as T;
}

/* ── MIME ─────────────────────────────────────────────────────────────────── */

const b64 = (input: string) => Buffer.from(input, "utf8").toString("base64");
const b64url = (input: string) =>
  b64(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** RFC 2047. Japanese subjects are not ASCII, so they must be encoded. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${b64(value)}?=`;
}

/** Header injection guard — a newline in a header would forge extra headers. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function buildMime(input: SendEmailInput, from: string): string {
  const headers = [
    `From: ${oneLine(from)}`,
    `To: ${input.to.map(oneLine).join(", ")}`,
    input.cc?.length ? `Cc: ${input.cc.map(oneLine).join(", ")}` : "",
    `Subject: ${encodeHeader(oneLine(input.subject))}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);

  // Base64 bodies must be wrapped; some servers reject lines over 998 octets.
  const body = b64(input.body).replace(/(.{76})/g, "$1\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

/* ── Gmail ────────────────────────────────────────────────────────────────── */

interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  labelIds?: string[];
  payload?: { headers?: { name: string; value: string }[] };
}

const header = (message: GmailMessage, name: string) =>
  message.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";

/* ── The live client ──────────────────────────────────────────────────────── */

const liveClient: GoogleClient = {
  async searchEmail(query, limit) {
    const list = await call<{ messages?: { id: string }[] }>(
      `${GMAIL}/messages?maxResults=${Math.min(limit, 25)}&q=${encodeURIComponent(query)}`,
    );
    if (!list.messages?.length) return [];

    // Metadata only: subjects and snippets are enough to triage, and pulling
    // full bodies for a search would hand the model far more than it asked for.
    const messages = await Promise.all(
      list.messages.map((m) =>
        call<GmailMessage>(
          `${GMAIL}/messages/${m.id}?format=metadata` +
            "&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date",
        ),
      ),
    );

    return messages.map((message) => ({
      id: message.id,
      threadId: message.threadId,
      from: header(message, "from"),
      to: header(message, "to"),
      subject: header(message, "subject"),
      date: header(message, "date"),
      snippet: message.snippet ?? "",
      unread: message.labelIds?.includes("UNREAD") ?? false,
    }));
  },

  async sendEmail(input) {
    const { google } = getConfig();
    let threadId: string | undefined;

    if (input.inReplyToMessageId) {
      const original = await call<GmailMessage>(
        `${GMAIL}/messages/${input.inReplyToMessageId}?format=metadata&metadataHeaders=Subject`,
      );
      threadId = original.threadId;
    }

    const sent = await call<{ id: string; threadId: string }>(`${GMAIL}/messages/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        raw: b64url(buildMime(input, google.sendAs || "me")),
        ...(threadId ? { threadId } : {}),
      }),
    });

    return { id: sent.id, threadId: sent.threadId, to: input.to, subject: input.subject };
  },

  async listEvents(timeMin, timeMax, limit) {
    const { google } = getConfig();
    const events = await call<{ items?: RawEvent[] }>(
      `${CALENDAR}/calendars/${encodeURIComponent(google.calendarId)}/events` +
        `?singleEvents=true&orderBy=startTime&maxResults=${Math.min(limit, 50)}` +
        `&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
    );
    return (events.items ?? []).map(toEvent);
  },

  async createEvent(input) {
    const { google } = getConfig();
    const created = await call<RawEvent>(
      `${CALENDAR}/calendars/${encodeURIComponent(google.calendarId)}/events` +
        `?sendUpdates=${input.attendees?.length ? "all" : "none"}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          summary: input.summary,
          description: input.description,
          location: input.location,
          start: { dateTime: input.start },
          end: { dateTime: input.end },
          attendees: input.attendees?.map((email) => ({ email })),
        }),
      },
    );
    return toEvent(created);
  },
};

interface RawEvent {
  id: string;
  summary?: string;
  status?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; responseStatus?: string }[];
}

function toEvent(raw: RawEvent): CalendarEvent {
  return {
    id: raw.id,
    summary: raw.summary ?? "(無題)",
    start: raw.start?.dateTime ?? raw.start?.date ?? "",
    end: raw.end?.dateTime ?? raw.end?.date ?? "",
    location: raw.location,
    attendees: (raw.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
    status: raw.status ?? "confirmed",
    htmlLink: raw.htmlLink,
  };
}

let injected: GoogleClient | null = null;

/** Test seam: exercises the full tool and approval path without calling Google. */
export function __setGoogleClientForTesting(stub: GoogleClient | null): void {
  injected = stub;
  resetGoogleToken();
}

export function googleClient(): GoogleClient {
  return injected ?? liveClient;
}

export function googleReady(): boolean {
  return injected !== null || getConfig().google.configured;
}
