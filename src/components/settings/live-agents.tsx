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
        hint={live ? `${runtime?.providerLabel ?? "モデルAPI"} 接続済み` : "未接続 — デモ動作中"}
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
              実際にAI社員を働かせるには、この環境変数を外して GEMINI_API_KEY を設定してください。
            </p>
          )}
          <div className="grid grid-cols-2 gap-px bg-hairline md:grid-cols-4">
            <Cell label="Provider" value={runtime?.providerLabel ?? "—"} accent />
            <Cell label="Executive model" value={runtime?.model ?? "—"} />
            <Cell label="Specialist model" value={runtime?.workerModel ?? "—"} />
            <Cell
              label="Web search"
              value={runtime?.modelCapabilities?.search ? "利用可" : "この接続先では不可"}
            />
          </div>

          <div className="grid grid-cols-2 gap-px bg-hairline md:grid-cols-4">
            <Cell label="Max steps / run" value={String(runtime?.maxSteps ?? "—")} />
            <Cell label="Max delegations" value={String(runtime?.maxDelegations ?? "—")} />
            <Cell
              label="Code execution"
              value={runtime?.modelCapabilities?.execute ? "利用可" : "この接続先では不可"}
            />
            <Cell
              label="Today's requests"
              value={
                runtime?.quota?.enabled
                  ? `${runtime.quota.used}${runtime.quota.budget > 0 ? ` / ${runtime.quota.budget}` : ""}`
                  : "無制限"
              }
              accent={Boolean(runtime?.quota?.enabled)}
            />
          </div>

          {/* The company working unprompted is the thing a CEO most needs to
              be able to see, and to switch off. */}
          <div className="grid grid-cols-2 gap-px bg-hairline md:grid-cols-4">
            <Cell
              label="Autonomous work"
              value={runtime?.autonomy?.enabled ? "有効" : "停止中"}
              accent={Boolean(runtime?.autonomy?.enabled)}
            />
            <Cell
              label="Advanced today"
              value={
                runtime?.autonomy
                  ? `${runtime.autonomy.advancedToday} / ${runtime.autonomy.perDay}`
                  : "—"
              }
            />
            <Cell label="Per tick" value={String(runtime?.autonomy?.perTick ?? "—")} />
            <Cell
              label="Allowance share"
              value={
                runtime?.autonomy ? `${Math.round(runtime.autonomy.budgetShare * 100)}%` : "—"
              }
            />
          </div>

          {runtime?.autonomy?.enabled && (
            <p className="px-5 py-3 text-2xs leading-relaxed text-ink-muted">
              AI社員は、CEOが何も言わなくても自分の担当タスクを進めます。
              1回につき {runtime.autonomy.perTick} 件、1日 {runtime.autonomy.perDay} 件まで。
              同じタスクは {runtime.autonomy.cooldownMinutes} 分は再着手しません。
              1日のAPI枠の {Math.round(runtime.autonomy.budgetShare * 100)}% を使った時点で
              自律実行は止まり、残りはCEOの指示と定期ジョブのために確保されます。
              外部に出ていくものは、これまでどおりCEOの承認で止まります。
              止めるなら <code className="rounded bg-black/30 px-1 font-mono text-3xs">FRIDAY_AUTONOMY=false</code>。
            </p>
          )}

          {/* On a free key the allowance is the thing that actually stops the
              company, so it gets a line of its own rather than a number in a
              grid the CEO has to interpret. */}
          {runtime?.quota?.enabled && (
            <p
              className={cn(
                "px-5 py-3 text-2xs leading-relaxed",
                runtime.quota.exhausted
                  ? "bg-warn/[0.06] text-warn/90"
                  : "text-ink-muted",
              )}
            >
              {runtime.quota.exhausted ? (
                <>
                  <strong>本日の無料枠を使い切りました。</strong>
                  {runtime.quota.resetsAt}にリセットされ、AI社員は自動で再開します。
                </>
              ) : (
                <>
                  無料枠を使い切らないよう、1日 {runtime.quota.budget} リクエストで自主的に
                  止まります（本日 {runtime.quota.used} 件・残り {runtime.quota.remaining} 件）。
                  上限はAPIが実際に「1日の上限に達した」と返した時点でも記録され、
                  その日はそれ以上送りません。リセットは{runtime.quota.resetsAt}。
                </>
              )}
            </p>
          )}

          {/* The provider is a setting, so the screen says so rather than
              leaving someone to discover it in a file. */}
          <p className="px-5 py-3 text-2xs leading-relaxed text-ink-muted">
            接続先は環境変数で切り替えられます。
            <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 font-mono text-3xs">
              FRIDAY_PROVIDER
            </code>
            に <strong className="text-ink">gemini</strong>（無料枠あり）・
            <strong className="text-ink">anthropic</strong>（Claude）・
            <strong className="text-ink">openai</strong>
            （OpenAI互換のエンドポイント全般／ローカルのOllamaも可）のいずれかを指定します。
            キーを設定するだけでも自動で判定されます。
            いま何に繋がっていて、どのモデルが使えるかは{" "}
            <a href="/api/diagnose" target="_blank" rel="noreferrer" className="text-accent-soft hover:underline">
              /api/diagnose
            </a>{" "}
            で確認できます。
          </p>

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
            現在はデモ動作です。AI社員の活動はシミュレーションで、Gemini API
            は呼び出していません。APIキーを設定すると、同じ画面のまま
            <strong className="text-ink"> AI社員が実際に働き始めます</strong>。
          </p>

          <ol className="space-y-3">
            <Step n={1} title="APIキーを取得する">
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-accent-soft hover:underline"
              >
                Google AI Studio
              </a>{" "}
              でキーを発行します。
            </Step>
            <Step n={2} title="プロジェクト直下に .env.local を作る">
              <pre className="mt-1.5 overflow-x-auto rounded-lg border border-hairline bg-black/30 p-3 font-mono text-2xs leading-relaxed text-ink-muted">
{`GEMINI_API_KEY=AIza...

# 任意（既定値のまま無料枠で動きます）
GEMINI_MODEL=gemini-2.5-flash
GEMINI_WORKER_MODEL=gemini-2.5-flash-lite
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
