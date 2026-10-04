"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, RefreshCw } from "lucide-react";
import { fetchAgentAccess, mintAgentToken, type AgentAccess } from "@/lib/live";
import { cn } from "@/lib/utils";
import { Button, Chip, Panel, PanelHeader } from "@/components/ui/primitives";

/**
 * Connecting the CEO's own agent, without a terminal.
 *
 * The first version of this asked for `openssl rand -hex 32`, a paste into a
 * hosting dashboard, a redeploy and a `claude mcp add` — four steps in tools
 * the CEO does not use, to produce a value that dashboard would never show
 * him again. Everything that can be done for him is done here: the key is
 * minted by the server, shown once with a copy button, and the configuration
 * the other side needs is assembled complete, so the remaining work is
 * copying two things into one file.
 */

export function AgentAccessPanel() {
  const [access, setAccess] = useState<AgentAccess | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    try {
      setAccess(await fetchAgentAccess());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      const minted = await mintAgentToken();
      setToken(minted.token);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function copy(what: string, value: string) {
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(what);
        window.setTimeout(() => setCopied(null), 1600);
      })
      .catch(() => setError("コピーできませんでした。手で選択してください。"));
  }

  const url = `${origin}/api/mcp`;
  // Shown with the real values in place, so nothing has to be composed.
  const shown = token ?? "<発行したトークン>";
  const command = `claude mcp add --transport http friday-company ${url} --header "Authorization: Bearer ${shown}"`;
  const configFile = JSON.stringify(
    {
      mcpServers: {
        "friday-company": {
          type: "http",
          url,
          headers: { Authorization: `Bearer ${shown}` },
        },
      },
    },
    null,
    2,
  );

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="FRIDAY 接続"
        hint="副社長として会社を操作させる"
        action={
          access?.configured ? (
            <Chip className="bg-live/12 text-live">
              {access.source === "env" ? "環境変数で設定済み" : "発行済み"}
            </Chip>
          ) : (
            <Chip className="bg-warn/12 text-warn">未設定</Chip>
          )
        }
      />

      {error && (
        <p className="bg-danger/[0.06] px-5 py-3 text-2xs leading-relaxed text-danger">{error}</p>
      )}

      {/* The key itself, which is visible exactly once. */}
      {token && (
        <div className="border-b border-hairline bg-live/[0.05] px-5 py-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5 text-live" strokeWidth={2} />
            <span className="label text-live">発行しました — この画面を離れると二度と表示されません</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-hairline bg-black/30 px-3 py-2 font-mono text-2xs text-ink">
              {token}
            </code>
            <Button variant={copied === "token" ? "success" : "primary"} size="xs" onClick={() => copy("token", token)}>
              {copied === "token" ? <Check className="h-3 w-3" strokeWidth={2.25} /> : <Copy className="h-3 w-3" strokeWidth={2} />}
            </Button>
          </div>
          <p className="mt-2 text-3xs leading-relaxed text-ink-muted">
            いま控えてください。なくした場合は作り直せます（古いほうは使えなくなります）。
          </p>
        </div>
      )}

      <div className="divide-y divide-hairline">
        {!access?.configured && (
          <div className="px-5 py-4">
            <p className="text-2xs leading-relaxed text-ink-muted">
              ボタンを押すとサーバー側で鍵を作ります。ターミナルも再デプロイも要りません。
              作られた鍵は <strong className="text-ink">読み取りと指示</strong>（read / operate）の
              権限を持ちます。承認の実行はできないので、鍵を渡しても外部へ何かが出ていくことはありません。
            </p>
            <Button className="mt-3" variant="primary" size="xs" onClick={() => void mint()} disabled={busy}>
              <RefreshCw className={cn("h-3 w-3", busy && "animate-spin")} strokeWidth={2} />
              <span className="ml-1.5">{busy ? "発行中…" : "接続用の鍵を発行する"}</span>
            </Button>
          </div>
        )}

        {access?.source === "env" && (
          <p className="px-5 py-3 text-2xs leading-relaxed text-ink-muted">
            環境変数 <code className="rounded bg-black/30 px-1 font-mono text-3xs">FRIDAY_AGENT_TOKEN</code>{" "}
            が優先されています。画面から管理したい場合は、その環境変数を削除して再デプロイしてください。
          </p>
        )}

        {/* The other side's configuration, assembled. */}
        <div className="px-5 py-4">
          <div className="label mb-2">FRIDAY 側の設定（どちらか一方）</div>

          <p className="text-2xs leading-relaxed text-ink-muted">
            <strong className="text-ink">A. ファイルを置く（ターミナル不要）</strong>
            <br />
            FRIDAYのプロジェクト直下に{" "}
            <code className="rounded bg-black/30 px-1 font-mono text-3xs">.mcp.json</code>{" "}
            を作って、これを貼ります。
          </p>
          <div className="mt-2 flex items-start gap-2">
            <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-hairline bg-black/30 p-3 font-mono text-3xs leading-relaxed text-ink-muted">
              {configFile}
            </pre>
            <Button variant={copied === "file" ? "success" : "ghost"} size="xs" onClick={() => copy("file", configFile)}>
              {copied === "file" ? <Check className="h-3 w-3" strokeWidth={2.25} /> : <Copy className="h-3 w-3" strokeWidth={2} />}
            </Button>
          </div>

          <p className="mt-4 text-2xs leading-relaxed text-ink-muted">
            <strong className="text-ink">B. コマンドで入れる</strong>
          </p>
          <div className="mt-2 flex items-start gap-2">
            <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-hairline bg-black/30 p-3 font-mono text-3xs leading-relaxed text-ink-muted">
              {command}
            </pre>
            <Button variant={copied === "cmd" ? "success" : "ghost"} size="xs" onClick={() => copy("cmd", command)}>
              {copied === "cmd" ? <Check className="h-3 w-3" strokeWidth={2.25} /> : <Copy className="h-3 w-3" strokeWidth={2} />}
            </Button>
          </div>

          {!token && access?.configured && (
            <p className="mt-3 text-3xs leading-relaxed text-ink-ghost">
              上の <code className="font-mono">&lt;発行したトークン&gt;</code>{" "}
              は、発行時に一度だけ表示された値です。控えていない場合は作り直してください。
            </p>
          )}
        </div>

        {access?.configured && (
          <div className="px-5 py-4">
            <p className="text-2xs leading-relaxed text-ink-muted">
              接続できたら、FRIDAYに「会社の状況を教えて」と聞いてください。
              会社のタスクを裏で進めさせるには、FRIDAYに
              <strong className="text-ink"> 30分〜1時間ごとに advance_work を呼ぶ</strong>
              よう覚えさせてください。
            </p>
            <Button className="mt-3" variant="ghost" size="xs" onClick={() => void mint()} disabled={busy}>
              <RefreshCw className={cn("h-3 w-3", busy && "animate-spin")} strokeWidth={2} />
              <span className="ml-1.5">鍵を作り直す</span>
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
