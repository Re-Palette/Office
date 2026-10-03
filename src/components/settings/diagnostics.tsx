"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { fetchDiagnosis, type Diagnosis } from "@/lib/live";
import { cn } from "@/lib/utils";
import { Button, Panel, PanelHeader } from "@/components/ui/primitives";

/**
 * What the server actually sees.
 *
 * Built after two rounds of diagnosing a non-working company by reading a
 * hosting dashboard, which cannot answer the question: it shows a variable as
 * set whether or not the running build ever received it, and it masks the
 * value, so "present" and "present and usable" look identical. Twice the
 * conclusion was wrong in opposite directions.
 *
 * So this asks the server and prints the answer in plain Japanese. It never
 * shows a credential — only what the server made of one.
 */

type Status = "ok" | "warn" | "bad";

export function Diagnostics() {
  const [data, setData] = useState<Diagnosis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchDiagnosis());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const model = data?.model;
  const substitutions = Object.entries(model?.substituted ?? {});
  const unavailable = Object.entries(model?.available ?? {}).filter(([, ok]) => !ok);

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Diagnostics"
        hint="サーバーが実際に見ている状態"
        action={
          <Button variant="ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} strokeWidth={2} />
            <span className="ml-1.5">再確認</span>
          </Button>
        }
      />

      {error && (
        <p className="px-5 py-3 text-2xs leading-relaxed text-danger">
          {error}
          <br />
          デモ動作のときは診断も実行されません。
        </p>
      )}

      {!data && !error && (
        <p className="px-5 py-3 text-2xs text-ink-faint">確認しています…</p>
      )}

      {model && (
        <div className="divide-y divide-hairline">
          <Row
            status={model.configured ? "ok" : "bad"}
            label="モデルAPI"
            value={model.providerLabel}
            detail={model.verdict}
          />

          {/* The question a hosting dashboard cannot answer: not "is the
              variable there" but "did this build receive something usable". */}
          <div className="px-5 py-3">
            <div className="label mb-2">APIキー（値は表示されません）</div>
            <div className="space-y-1">
              {Object.entries(model.keys).map(([name, state]) => (
                <div key={name} className="flex items-center gap-2 text-2xs">
                  <Mark status={state === "設定済み" ? "ok" : state === "未設定" ? "warn" : "bad"} />
                  <span className="font-mono text-3xs text-ink-faint">{name}</span>
                  <span
                    className={cn(
                      "ml-auto",
                      state === "設定済み" ? "text-live" : state === "未設定" ? "text-ink-ghost" : "text-danger",
                    )}
                  >
                    {state}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-3xs leading-relaxed text-ink-ghost">
              接続先は{model.chosenBy}で決まっています。
              {model.switchable.length > 1 &&
                `キーがあるのは ${model.switchable.join("・")} です。`}
            </p>
          </div>

          <Row
            status={unavailable.length === 0 ? "ok" : "warn"}
            label="モデル"
            value={`${model.wants.model}${model.wants.workerModel !== model.wants.model ? ` / ${model.wants.workerModel}` : ""}`}
            detail={
              model.models.length > 0
                ? `このキーで ${model.models.length} 件のモデルが使えます。`
                : "モデル一覧はこの接続先では取得できません。"
            }
          />

          {/* A model nobody chose is working: say so rather than let it ride. */}
          {substitutions.length > 0 && (
            <div className="bg-warn/[0.06] px-5 py-3 text-2xs leading-relaxed text-warn/90">
              <strong>設定したモデルが廃止されています。</strong>
              <br />
              {substitutions.map(([from, to]) => (
                <span key={from} className="font-mono text-3xs">
                  {from} → {to}
                  <br />
                </span>
              ))}
              実行は自動で代替に切り替わっているので止まりませんが、
              GEMINI_MODEL を更新しておくと毎回の余計な往復がなくなります。
            </div>
          )}

          <Row
            status={model.capabilities.search ? "ok" : "warn"}
            label="Web検索 / コード実行"
            value={`${model.capabilities.search ? "利用可" : "不可"} / ${model.capabilities.execute ? "利用可" : "不可"}`}
            detail={
              model.searchProvider
                ? `検索は ${model.searchProvider} から借りています。`
                : model.capabilities.search
                  ? "接続先の機能をそのまま使っています。"
                  : "この接続先に検索機能がないため、該当ツールは配布されません。"
            }
          />

          <Row
            status={data.supabase.configured && data.supabase.verdict.includes("正常") ? "ok" : data.supabase.configured ? "bad" : "warn"}
            label="保存先"
            value={data.supabase.host ?? "ファイル（未設定）"}
            detail={data.supabase.verdict}
          />

          <p className="px-5 py-3 text-3xs leading-relaxed text-ink-ghost">
            ここが全部緑なら、AI社員は動きます。
            アクティビティやRunsに赤いエラーが残っている場合は、
            設定を直す前の実行記録です — 各行の時刻を見てください。
          </p>
        </div>
      )}
    </Panel>
  );
}

function Mark({ status }: { status: Status }) {
  if (status === "ok") {
    return <CheckCircle2 className="h-3 w-3 shrink-0 text-live" strokeWidth={2} />;
  }
  if (status === "warn") {
    return <AlertTriangle className="h-3 w-3 shrink-0 text-warn" strokeWidth={2} />;
  }
  return <XCircle className="h-3 w-3 shrink-0 text-danger" strokeWidth={2} />;
}

function Row({
  status,
  label,
  value,
  detail,
}: {
  status: Status;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="px-5 py-3">
      <div className="flex items-center gap-2">
        <Mark status={status} />
        <span className="label">{label}</span>
        <span className="ml-auto truncate font-mono text-3xs text-ink">{value}</span>
      </div>
      <p className="mt-1.5 pl-5 text-2xs leading-relaxed text-ink-muted">{detail}</p>
    </div>
  );
}
