import "server-only";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { getConfig } from "@/server/runtime/config";
import { mutate, read } from "@/server/runtime/store";

/**
 * note drafts, as files.
 *
 * note has no official write API, so the honest delivery for an article is a
 * document the CEO opens and posts. That is what this module produces: one
 * Markdown file per draft, on disk, plus the same text in the dashboard with
 * a copy button.
 *
 * Nothing here touches note. That is the point — no session cookie, no
 * undocumented endpoint, nothing that can break on note's next deploy. The AI
 * employee's job ends at a finished article; posting it stays the CEO's.
 */

export type NoteDraftStatus = "READY" | "POSTED" | "ARCHIVED";

export interface NoteDraft {
  id: string;
  title: string;
  /** Markdown, exactly as the employee wrote it. */
  body: string;
  tags: string[];
  /** One line on why this article, for the CEO skimming the list. */
  rationale: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  status: NoteDraftStatus;
  /** Path relative to the data directory, so the CEO can find it on disk. */
  file: string;
  /** Set when the CEO marks it posted. */
  postedAt?: number;
  noteUrl?: string;
}

let seq = 0;
const uid = () => `nd-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** JST, because the company runs on JST and so does the 17:00 job. */
export function jstDay(at: number): string {
  return new Date(at + 9 * 3_600_000).toISOString().slice(0, 10);
}

function slug(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  // A Japanese title yields no usable ASCII slug, so fall back to a stable id.
  return ascii.slice(0, 40) || "note";
}

function draftsDir(): string {
  const { dataDir } = getConfig();
  const base = path.isAbsolute(dataDir) ? dataDir : path.join(process.cwd(), dataDir);
  return path.join(base, "note-drafts");
}

export function draftFilePath(draft: NoteDraft): string {
  return path.join(draftsDir(), path.basename(draft.file));
}

/**
 * The file the CEO opens. Title first so it can be copied into note's title
 * field, then the body exactly as written, then the tags on their own line.
 * No front matter — every line here is meant to be read or pasted.
 */
export function renderDraftFile(draft: NoteDraft): string {
  const when = new Date(draft.updatedAt + 9 * 3_600_000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 16);

  return [
    `# ${draft.title}`,
    "",
    draft.body.trim(),
    "",
    "---",
    "",
    draft.tags.length ? `タグ: ${draft.tags.map((t) => `#${t}`).join(" ")}` : "タグ: —",
    `作成: ${AGENTS_BY_ID[draft.createdBy]?.role ?? draft.createdBy} / 更新: ${when} JST`,
    "",
  ].join("\n");
}

export interface NewDraft {
  title: string;
  body: string;
  tags: string[];
  rationale: string;
  createdBy: string;
}

/**
 * Saves a draft and writes its file.
 *
 * Same title on the same JST day means the daily job is refreshing today's
 * article rather than adding another — the CEO asked for one draft updated
 * daily, not a pile of them.
 */
export function saveDraft(input: NewDraft, now = Date.now()): NoteDraft {
  const day = jstDay(now);

  const draft = mutate((s) => {
    s.noteDrafts ??= [];

    const existing = s.noteDrafts.find(
      (d) => d.status === "READY" && d.title === input.title && jstDay(d.createdAt) === day,
    );

    if (existing) {
      existing.body = input.body;
      existing.tags = input.tags;
      existing.rationale = input.rationale;
      existing.updatedAt = now;
      return existing;
    }

    const created: NoteDraft = {
      id: uid(),
      title: input.title,
      body: input.body,
      tags: input.tags,
      rationale: input.rationale,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      status: "READY",
      file: `${day}-${slug(input.title)}.md`,
      noteUrl: undefined,
    };
    s.noteDrafts = [created, ...s.noteDrafts];
    return created;
  });

  writeDraftFile(draft);
  return draft;
}

function writeDraftFile(draft: NoteDraft): void {
  try {
    mkdirSync(draftsDir(), { recursive: true });
    writeFileSync(draftFilePath(draft), renderDraftFile(draft), "utf8");
  } catch (error) {
    // A read-only filesystem must not lose the article: it is already in the
    // work state, and the dashboard serves it from there.
    console.warn("[friday] could not write note draft file:", (error as Error).message);
  }
}

export function listDrafts(): NoteDraft[] {
  return read((s) => [...(s.noteDrafts ?? [])]);
}

export function getDraft(id: string): NoteDraft | undefined {
  return read((s) => s.noteDrafts?.find((d) => d.id === id));
}

/** The .md as text — from disk when it is there, re-rendered when it is not. */
export function readDraftFile(draft: NoteDraft): string {
  try {
    return readFileSync(draftFilePath(draft), "utf8");
  } catch {
    return renderDraftFile(draft);
  }
}

export function setDraftStatus(
  id: string,
  status: NoteDraftStatus,
  noteUrl?: string,
): NoteDraft | undefined {
  const draft = mutate((s) => {
    const found = s.noteDrafts?.find((d) => d.id === id);
    if (!found) return undefined;
    found.status = status;
    found.updatedAt = Date.now();
    if (status === "POSTED") {
      found.postedAt = Date.now();
      if (noteUrl) found.noteUrl = noteUrl;
    }
    return found;
  });

  if (draft) writeDraftFile(draft);
  return draft;
}
