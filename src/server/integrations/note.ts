import "server-only";

import { getConfig } from "@/server/runtime/config";

/**
 * note (note.com).
 *
 * note publishes no official API for writing. What exists is the endpoint set
 * its own web client uses, which is undocumented and can change without
 * warning. That shapes everything here:
 *
 *  - the surface is kept as small as it can be — create a draft, update it,
 *    publish it, and one call to check the session is alive;
 *  - every response is validated rather than assumed, so the day note changes
 *    a field this fails loudly in the CEO's face instead of silently posting
 *    an empty article;
 *  - requests are made one at a time, at human pace, from a single account.
 *
 * Authentication is the session cookie the CEO copies out of their own
 * browser. It is their account, their writing, and their decision to publish.
 */

const BASE = "https://note.com/api";

export interface NoteDraft {
  id: string;
  key: string;
  title: string;
  /** Where the CEO reviews it before deciding. Drafts are private. */
  editUrl: string;
}

export interface NotePublished extends NoteDraft {
  url: string;
  publishedAt: string;
}

export interface DraftInput {
  title: string;
  /** note's editor stores HTML. Plain paragraphs survive round-tripping. */
  body: string;
  tags?: string[];
}

export interface NoteAccount {
  id: string;
  urlname: string;
  nickname: string;
}

export interface NoteClient {
  verify(): Promise<NoteAccount>;
  createDraft(input: DraftInput): Promise<NoteDraft>;
  publish(id: string, input: DraftInput): Promise<NotePublished>;
}

export class NoteAuthError extends Error {}
export class NoteApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/* ── Request plumbing ─────────────────────────────────────────────────────── */

function cookieHeader(): string {
  const { note } = getConfig();
  if (!note.apiConfigured) {
    throw new NoteAuthError(
      "note連携が未設定です。NOTE_AUTH_TOKEN を設定してください（Settings に取得手順があります）。",
    );
  }
  return [
    `note_gql_auth_token=${note.authToken}`,
    note.session ? `_note_session_v5=${note.session}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      cookie: cookieHeader(),
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();

  if (response.status === 401 || response.status === 403) {
    throw new NoteAuthError(
      "noteのセッションが切れています。ブラウザから note_gql_auth_token を取り直して NOTE_AUTH_TOKEN を更新してください。",
    );
  }
  if (!response.ok) {
    throw new NoteApiError(text.slice(0, 300) || `HTTP ${response.status}`, response.status);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    // An HTML page where JSON belongs means the session was bounced to a login
    // screen, or note changed the endpoint. Either way, do not press on.
    throw new NoteApiError(
      "noteから予期しない応答が返りました（JSONではありません）。非公式APIの仕様が変わった可能性があります。",
      response.status,
    );
  }
}

/* ── Response shapes ──────────────────────────────────────────────────────── */

interface RawNote {
  id?: number | string;
  key?: string;
  name?: string;
  status?: string;
  note_url?: string;
  publish_at?: string;
}

/**
 * note wraps payloads in `data`, sometimes one level deeper. Reading the id
 * defensively is the difference between a loud failure and a lost article.
 */
function unwrap(payload: unknown): RawNote {
  const outer = (payload as { data?: unknown })?.data ?? payload;
  const inner = (outer as { note?: unknown })?.note ?? outer;
  return (inner ?? {}) as RawNote;
}

function requireId(raw: RawNote, what: string): { id: string; key: string } {
  const id = raw.id === undefined ? "" : String(raw.id);
  if (!id) {
    throw new NoteApiError(`noteが${what}のidを返しませんでした。処理を中断します。`, 502);
  }
  return { id, key: raw.key ?? id };
}

/* ── The live client ──────────────────────────────────────────────────────── */

const liveClient: NoteClient = {
  async verify() {
    const payload = await call<{ data?: NoteAccount } & NoteAccount>("/v2/current_user");
    const user = payload.data ?? payload;
    if (!user?.urlname) {
      throw new NoteAuthError("noteのアカウント情報を取得できませんでした。");
    }
    return { id: String(user.id ?? ""), urlname: user.urlname, nickname: user.nickname ?? "" };
  },

  async createDraft(input) {
    // A draft is private: nobody but the account holder can see it. That is
    // what makes it safe to create before the CEO has approved anything.
    const raw = unwrap(
      await call("/v1/text_notes", {
        method: "POST",
        body: JSON.stringify({
          name: input.title,
          body: input.body,
          status: "draft",
        }),
      }),
    );

    const { id, key } = requireId(raw, "下書き");
    return { id, key, title: input.title, editUrl: `https://note.com/notes/${key}/edit` };
  },

  async publish(id, input) {
    // Tags and price only take effect on the publishing call, so the whole
    // article is sent again rather than just flipping the status field.
    const raw = unwrap(
      await call(`/v1/text_notes/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: input.title,
          body: input.body,
          status: "published",
          hashtags: (input.tags ?? []).map((name) => ({ hashtag: { name } })),
        }),
      }),
    );

    const key = raw.key ?? id;
    if (raw.status && raw.status !== "published") {
      throw new NoteApiError(
        `noteが公開を受け付けませんでした（status: ${raw.status}）。下書きは残っています。`,
        502,
      );
    }

    return {
      id,
      key,
      title: input.title,
      editUrl: `https://note.com/notes/${key}/edit`,
      url: raw.note_url ?? `https://note.com/n/${key}`,
      publishedAt: raw.publish_at ?? new Date().toISOString(),
    };
  },
};

/* ── Markdown → note's editor HTML ────────────────────────────────────────── */

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * AI employees write Markdown; note's editor stores HTML. Only the subset note
 * actually renders is emitted — headings, paragraphs, lists, quotes and links.
 * Anything else degrades to a paragraph rather than arriving as literal syntax.
 */
export function markdownToNoteHtml(markdown: string): string {
  const inline = (text: string) =>
    escapeHtml(text)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  const blocks: string[] = [];
  let list: string[] | null = null;

  const flush = () => {
    if (list) {
      blocks.push(`<ul>${list.map((item) => `<li>${item}</li>`).join("")}</ul>`);
      list = null;
    }
  };

  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const text = line.trim();

    if (!text) {
      flush();
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(text);
    if (bullet) {
      (list ??= []).push(inline(bullet[1]));
      continue;
    }
    flush();

    const heading = /^(#{1,6})\s+(.*)$/.exec(text);
    if (heading) {
      // note's editor offers two heading levels. `#` and `##` are both the
      // article's own headings, so both become the larger one; anything
      // deeper folds into the smaller rather than disappearing.
      const level = heading[1].length <= 2 ? 2 : 3;
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const quote = /^>\s+(.*)$/.exec(text);
    if (quote) {
      blocks.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }

    blocks.push(`<p>${inline(text)}</p>`);
  }

  flush();
  return blocks.join("");
}

let injected: NoteClient | null = null;

/** Test seam: exercises the draft → approval → publish path without note. */
export function __setNoteClientForTesting(stub: NoteClient | null): void {
  injected = stub;
}

export function noteClient(): NoteClient {
  return injected ?? liveClient;
}

export function noteReady(): boolean {
  return injected !== null || getConfig().note.apiConfigured;
}
