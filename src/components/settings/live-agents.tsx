"use client";

import { Check, Cpu, Database, Globe, TerminalSquare } from "lucide-react";
import { useCompany } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Chip, Panel, PanelHeader } from "@/components/ui/primitives";

/**
 * Setup and status for the live agent layer — the one screen that says whether
 * the company is actually running, and exactly what to do if it isn't.
 */
export function LiveAgents() {
  const mode = useCompany((s) => s.mode);
  const runtime = useCompany((s) => s.runtime);
  const usage = useCompany((s) => s.apiUsage);
  const runs = useCompany((s) => s.runs);

  const live = mode === "live";
  const stubbed = runtime?.transport === "stub";

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Live AI Employees"
        hint={live ? "Claude API 接続済み" : "未接続 — デモ動作中"}
        action={
          stubbed ? (
            <Chip className="bg-warn/12 text-warn">STUB TRANSPORT</Chip>
          ) : live ? (
            <Chip className="bg-live/12 text-live">LIVE</Chip>
          ) : (
            <Chip className="bg-warn/12 text-warn">DEMO</Chip>
          )
        }
      />

      {live ? (
        <div className="divide-y divide-hairline">
          {stubbed && (
            <p className="bg-warn/[0.06] px-5 py-3 text-2xs leading-relaxed text-warn/90">
              FRIDAY_TEST_TRANSPORT=1 が有効です。ツール実行・会社データの更新・PDF生成・
              承認フローはすべて本物ですが、モデルの応答のみ定型のものに置き換わっています。
              実際にAI社員を働かせるには、この環境変数を外して ANTHROPIC_API_KEY を設定してください。
            </p>
          )}
          <div className="grid grid-cols-2 gap-px bg-hairline md:grid-cols-4">
            <Cell label="Executive model" value={runtime?.model ?? "—"} />
            <Cell label="Specialist model" value={runtime?.workerModel ?? "—"} />
            <Cell label="Max steps / run" value={String(runtime?.maxSteps ?? "—")} />
            <Cell label="Max delegations" value={String(runtime?.maxDelegations ?? "—")} />
          </div>

          <div className="grid grid-cols-2 gap-px bg-hairline md:grid-cols-4">
            <Cell label="Runs" value={String(usage.runs)} />
            <Cell label="Input tokens" value={usage.inputTokens.toLocaleString("en-US")} />
            <Cell label="Output tokens" value={usage.outputTokens.toLocaleString("en-US")} />
            <Cell
              label="In flight"
              value={String(runs.filter((r) => r.status === "running").length)}
              accent
            />
          </div>

          <div className="px-5 py-4">
            <span className="label">Tools available to AI employees</span>
            <ul className="mt-2.5 grid gap-2 sm:grid-cols-2">
              <ToolRow
                icon={Globe}
                label="Web search / Web fetch"
                detail="調査担当のAI社員が実際にWebを検索し、ページを読みます"
                on={runtime?.webTools ?? false}
              />
              <ToolRow
                icon={TerminalSquare}
                label="Code execution"
                detail="分析担当のAI社員が実際にコードを実行して計算します"
                on={runtime?.codeExecution ?? false}
              />
              <ToolRow
                icon={Cpu}
                label="Company data"
                detail="タスク・プロジェクト・部署・分析データの読み取りと更新"
                on
              />
              <ToolRow
                icon={Check}
                label="Approval gate"
                detail="送信・公開・課金・本番反映は必ずCEO承認で停止します"
                on
              />
              <ToolRow
                icon={Database}
                label={runtime?.storage === "supabase" ? "Supabase" : "ファイル保存"}
                detail={
                  runtime?.storage === "supabase" && runtime?.storageHealthy === false
                    ? `Supabase に接続できていません: ${runtime.storageError ?? "unknown"}`
                    : runtime?.persistence === "durable"
                      ? runtime?.storage === "supabase"
                        ? "会社の状態は Supabase に保存され、再起動しても残ります"
                        : ".friday/ に保存され、再起動しても残ります"
                      : "サーバーレスの一時領域です。再起動で消えます（Supabase未設定）"
                }
                on={runtime?.persistence === "durable"}
              />
            </ul>
          </div>
        </div>
      ) : (
        <div className="space-y-4 px-5 py-4">
          <p className="text-xs leading-relaxed text-ink-muted">
            現在はデモ動作です。AI社員の活動はシミュレーションで、Claude API
            は呼び出していません。APIキーを設定すると、同じ画面のまま
            <strong className="text-ink"> AI社員が実際に働き始めます</strong>。
          </p>

          <ol className="space-y-3">
            <Step n={1} title="APIキーを取得する">
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="text-accent-soft hover:underline"
              >
                console.anthropic.com
              </a>{" "}
              でキーを発行します。
            </Step>
            <Step n={2} title="プロジェクト直下に .env.local を作る">
              <pre className="mt-1.5 overflow-x-auto rounded-lg border border-hairline bg-black/30 p-3 font-mono text-2xs leading-relaxed text-ink-muted">
{`ANTHROPIC_API_KEY=sk-ant-...

# 任意
FRIDAY_MODEL=claude-opus-5
FRIDAY_WEB_TOOLS=true
FRIDAY_CODE_EXECUTION=true`}
              </pre>
            </Step>
            <Step n={3} title="再起動する">
              <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-2xs text-ink-muted">
                npm run dev
              </code>{" "}
              を再起動すると、ここが LIVE に変わります。
            </Step>
          </ol>

          <p className="rounded-lg border border-warn/25 bg-warn/[0.05] px-3 py-2 text-2xs leading-relaxed text-warn/90">
            LIVE では実際にAPIが課金されます。1回の指示で複数のAI社員が動くため、
            まずは小さな指示から試してください。
          </p>
        </div>
      )}
    </Panel>
  );
}

function Cell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-surface/70 px-5 py-3.5">
      <div className="label">{label}</div>
      <div
        className={cn(
          "num mt-1 truncate text-[13px] font-medium",
          accent ? "text-live" : "text-ink",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ToolRow({
  icon: Icon,
  label,
  detail,
  on,
}: {
  icon: typeof Globe;
  label: string;
  detail: string;
  on: boolean;
}) {
  return (
    <li className="flex items-start gap-2.5 rounded-lg border border-hairline bg-white/[0.02] px-3 py-2.5">
      <Icon
        className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", on ? "text-live" : "text-ink-ghost")}
        strokeWidth={1.75}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-2xs font-medium text-ink">{label}</span>
          <Chip className={on ? "bg-live/10 text-live" : "bg-white/5 text-ink-ghost"}>
            {on ? "ON" : "OFF"}
          </Chip>
        </div>
        <p className="mt-0.5 text-3xs leading-relaxed text-ink-faint">{detail}</p>
      </div>
    </li>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent/12 text-3xs text-accent-soft">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-ink">{title}</div>
        <div className="mt-0.5 text-2xs leading-relaxed text-ink-muted">{children}</div>
      </div>
    </li>
  );
}
