"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Check,
  Copy,
  Download,
  ExternalLink,
  PenLine,
  RefreshCw,
} from "lucide-react";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { useCompany } from "@/lib/store";
import { formatRelative } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { NoteDraftSummary } from "@/lib/live";
import { Avatar, Button, Chip, Empty, Panel, PanelHeader } from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/page-header";

/**
 * note drafts.
 *
 * note has no official write API, so the last step is a person: the CEO reads
 * the article here, copies it, and posts it. Everything on this page exists to
 * make that step take seconds — the full text, a copy button, the .md file,
 * and a way to mark what has already gone out.
 */
export default function NoteDraftsPage() {
  const drafts = useCompany((s) => s.noteDrafts);
  const mode = useCompany((s) => s.mode);
  const runtime = useCompany((s) => s.runtime);
  const now = useCompany((s) => s.now);
  const pokeScheduler = useCompany((s) => s.pokeScheduler);

  const [filter, setFilter] = useState<"READY" | "POSTED" | "ALL">("READY");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  const visible = useMemo(
    () => drafts.filter((d) => (filter === "ALL" ? true : d.status === filter)),
    [drafts, filter],
  );

  const selected = drafts.find((d) => d.id === selectedId) ?? visible[0];

  useEffect(() => {
    if (!selectedId && visible[0]) setSelectedId(visible[0].id);
  }, [selectedId, visible]);

  const ready = drafts.filter((d) => d.status === "READY").length;
  const at = runtime?.noteDailyDraftAt ?? "17:00";
  const platform = runtime?.platform ?? "server";
  const ephemeral = runtime?.persistence === "ephemeral";

  async function writeNow() {
    setWriting(true);
    setOutcome(null);
    try {
      const results = await pokeScheduler(true);
      const job = results.find((r) => r.id === "note-daily-draft");
      setOutcome(
        job
          ? { ok: job.status === "ran", text: job.detail }
          : { ok: false, text: "ジョブが応答しませんでした。" },
      );
    } catch (error) {
      setOutcome({ ok: false, text: (error as Error).message });
    } finally {
      setWriting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<span className="label">Marketing</span>}
        title="Note Drafts"
        description={`Content AI が毎日 ${at} JST に記事を1本書きます。note には公式の投稿APIがないため、投稿はここからコピーして行ってください。`}
        actions={
          mode === "live" ? (
            <Button variant="outline" size="sm" onClick={writeNow} disabled={writing}>
              <RefreshCw
                className={cn("h-3 w-3", writing && "animate-spin")}
                strokeWidth={1.75}
              />
              {writing ? "執筆中…" : "今すぐ書く"}
            </Button>
          ) : undefined
        }
      />

      {mode !== "live" ? (
        <Panel className="overflow-hidden">
          <PanelHeader title="記事を書かせるには" hint="デモ動作中" />
          <div className="space-y-3 px-5 py-4">
            <p className="text-xs leading-relaxed text-ink-muted">
              ANTHROPIC_API_KEY が設定されていないため、Content AI は動きません。
              記事の生成・保存・毎日の実行はすべてこのキーの有無で切り替わります。
            </p>

            {platform === "vercel" ? (
              <ol className="space-y-2.5">
                <SetupStep n={1}>
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent-soft hover:underline"
                  >
                    console.anthropic.com
                  </a>{" "}
                  でAPIキーを発行します。
                </SetupStep>
                <SetupStep n={2}>
                  Vercel の該当プロジェクト → Settings → Environment Variables に
                  <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 font-mono text-3xs text-ink-muted">
                    ANTHROPIC_API_KEY
                  </code>
                  を追加し、Production にチェックを入れます。
                </SetupStep>
                <SetupStep n={3}>
                  Deployments → 最新のデプロイ → Redeploy。
                  環境変数はビルド後に反映されないため、再デプロイが必要です。
                </SetupStep>
              </ol>
            ) : (
              <ol className="space-y-2.5">
                <SetupStep n={1}>
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent-soft hover:underline"
                  >
                    console.anthropic.com
                  </a>{" "}
                  でAPIキーを発行します。
                </SetupStep>
                <SetupStep n={2}>
                  プロジェクト直下の{" "}
                  <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-3xs text-ink-muted">
                    .env.local
                  </code>{" "}
                  に追記します。
                  <pre className="mt-1.5 overflow-x-auto rounded-lg border border-hairline bg-black/30 p-3 font-mono text-2xs leading-relaxed text-ink-muted">
{`ANTHROPIC_API_KEY=sk-ant-...`}
                  </pre>
                </SetupStep>
                <SetupStep n={3}>
                  <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-2xs text-ink-muted">
                    npm run dev
                  </code>{" "}
                  を再起動します。
                </SetupStep>
              </ol>
            )}

            <p className="rounded-lg border border-hairline bg-white/[0.02] px-3 py-2 text-2xs leading-relaxed text-ink-faint">
              キーを使わずに画面と流れだけ確認するなら、
              <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 font-mono text-3xs text-ink-muted">
                FRIDAY_TEST_TRANSPORT=1
              </code>
              を付けて起動すると、サンプル記事で同じ経路を動かせます。
            </p>
          </div>
        </Panel>
      ) : (
        <div className="space-y-5">
          {outcome && (
            <div
              className={cn(
                "flex items-start gap-2.5 rounded-xl border px-4 py-3",
                outcome.ok
                  ? "border-live/25 bg-live/[0.06]"
                  : "border-danger/25 bg-danger/[0.06]",
              )}
            >
              {outcome.ok ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-live" strokeWidth={2.25} />
              ) : (
                <AlertTriangle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger"
                  strokeWidth={1.75}
                />
              )}
              <p
                className={cn(
                  "text-2xs leading-relaxed",
                  outcome.ok ? "text-live/90" : "text-danger/90",
                )}
              >
                {outcome.text}
              </p>
            </div>
          )}

          {ephemeral && (
            <div className="flex items-start gap-2.5 rounded-xl border border-warn/25 bg-warn/[0.05] px-4 py-3">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" strokeWidth={1.75} />
              <p className="text-2xs leading-relaxed text-warn/90">
                <strong className="text-warn">この環境では下書きが消えます。</strong>{" "}
                サーバーレス上では書き込み先が実行インスタンスごとに分かれ、再起動で消えるため、
                17:00 に生成した記事が次のアクセス時に見つからないことがあります。
                確実に残すには、永続ストレージ（Supabase）を繋ぐか、
                常時起動のサーバーで動かしてください。
              </p>
            </div>
          )}

          <div className="grid gap-5 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <Panel className="overflow-hidden">
            <PanelHeader
              title="Drafts"
              hint={`未投稿 ${ready} 件`}
              action={
                <div className="flex gap-1">
                  {(["READY", "POSTED", "ALL"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={cn(
                        "rounded-md px-1.5 py-0.5 font-mono text-3xs uppercase tracking-[0.14em] transition-colors",
                        filter === f
                          ? "bg-white/[0.08] text-ink"
                          : "text-ink-ghost hover:text-ink-faint",
                      )}
                    >
                      {f === "READY" ? "未投稿" : f === "POSTED" ? "投稿済" : "すべて"}
                    </button>
                  ))}
                </div>
              }
            />
            {visible.length === 0 ? (
              <Empty
                title="下書きはありません"
                hint={`毎日 ${at} JST に1本作成されます。「今すぐ書く」で先に作ることもできます。`}
              />
            ) : (
              <ul className="divide-y divide-hairline">
                {visible.map((draft) => (
                  <li key={draft.id}>
                    <button
                      onClick={() => setSelectedId(draft.id)}
                      className={cn(
                        "w-full px-4 py-3 text-left transition-colors",
                        selected?.id === draft.id
                          ? "bg-white/[0.05]"
                          : "hover:bg-white/[0.025]",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <StatusChip status={draft.status} />
                        <span className="num ml-auto text-3xs text-ink-ghost">
                          {formatRelative(draft.updatedAt, now)}
                        </span>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[12px] font-medium leading-snug text-ink">
                        {draft.title}
                      </p>
                      <p className="mt-1 truncate font-mono text-3xs text-ink-ghost">
                        {draft.file}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {selected ? (
            <DraftDetail draft={selected} now={now} />
          ) : (
            <Panel>
              <Empty title="下書きを選択してください" />
            </Panel>
          )}
          </div>
        </div>
      )}
    </div>
  );
}

function DraftDetail({ draft, now }: { draft: NoteDraftSummary; now: number }) {
  const setNoteDraft = useCompany((s) => s.setNoteDraft);
  const [copied, setCopied] = useState<"title" | "body" | null>(null);
  const author = AGENTS_BY_ID[draft.createdBy];

  async function copy(what: "title" | "body") {
    try {
      await navigator.clipboard.writeText(what === "title" ? draft.title : draft.body);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard access can be refused; the text is on screen to select.
    }
  }

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Article"
        hint={draft.file}
        action={
          <a
            href={`/api/note-drafts/${draft.id}/file`}
            className="flex items-center gap-1.5 rounded-lg border border-hairline px-2 py-1 text-3xs text-ink-faint transition-colors hover:border-hairline-strong hover:text-ink-muted"
          >
            <Download className="h-3 w-3" strokeWidth={1.75} />
            .md
          </a>
        }
      />

      <div className="space-y-4 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={draft.status} />
          {author && <Avatar name={author.name} accent={author.accent} size="xs" />}
          <span className="text-2xs text-ink-faint">{author?.role ?? draft.createdBy}</span>
          <span className="text-3xs text-ink-ghost">
            · {formatRelative(draft.updatedAt, now)}
          </span>
        </div>

        {draft.rationale && (
          <p className="rounded-lg border border-hairline bg-white/[0.02] px-3 py-2 text-2xs leading-relaxed text-ink-muted">
            {draft.rationale}
          </p>
        )}

        {/* Title and body are copied separately — note has two fields. */}
        <div>
          <div className="flex items-center justify-between gap-3">
            <span className="label">Title</span>
            <Button variant="ghost" size="xs" onClick={() => copy("title")}>
              {copied === "title" ? (
                <Check className="h-3 w-3 text-live" strokeWidth={2.25} />
              ) : (
                <Copy className="h-3 w-3" strokeWidth={1.75} />
              )}
              {copied === "title" ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-1 text-base font-semibold leading-snug tracking-tight text-ink">
            {draft.title}
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <span className="label">Body</span>
            <Button variant="ghost" size="xs" onClick={() => copy("body")}>
              {copied === "body" ? (
                <Check className="h-3 w-3 text-live" strokeWidth={2.25} />
              ) : (
                <Copy className="h-3 w-3" strokeWidth={1.75} />
              )}
              {copied === "body" ? "Copied" : "Copy"}
            </Button>
          </div>
          <pre className="scroll-slim mt-1.5 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-xl border border-hairline bg-black/25 px-4 py-3.5 font-sans text-xs leading-relaxed text-ink-muted">
            {draft.body}
          </pre>
        </div>

        {draft.tags.length > 0 && (
          <div>
            <span className="label">Tags</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {draft.tags.map((tag) => (
                <Chip key={tag}>#{tag}</Chip>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
          <a
            href="https://note.com/notes/new"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-solid px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            <ExternalLink className="h-3 w-3" strokeWidth={2} />
            note を開く
          </a>

          {draft.status === "READY" ? (
            <Button variant="success" size="sm" onClick={() => setNoteDraft(draft.id, "POSTED")}>
              <Check className="h-3 w-3" strokeWidth={2.25} />
              投稿済みにする
            </Button>
          ) : draft.status === "POSTED" ? (
            <Button variant="outline" size="sm" onClick={() => setNoteDraft(draft.id, "READY")}>
              未投稿に戻す
            </Button>
          ) : null}

          {draft.status !== "ARCHIVED" && (
            <Button variant="ghost" size="sm" onClick={() => setNoteDraft(draft.id, "ARCHIVED")}>
              <Archive className="h-3 w-3" strokeWidth={1.75} />
              見送る
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}

function SetupStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent/12 text-3xs text-accent-soft">
        {n}
      </span>
      <div className="min-w-0 flex-1 text-2xs leading-relaxed text-ink-muted">{children}</div>
    </li>
  );
}

function StatusChip({ status }: { status: NoteDraftSummary["status"] }) {
  if (status === "POSTED") return <Chip className="bg-live/16 text-live">投稿済み</Chip>;
  if (status === "ARCHIVED") return <Chip>見送り</Chip>;
  return <Chip className="bg-info/16 text-info">未投稿</Chip>;
}
