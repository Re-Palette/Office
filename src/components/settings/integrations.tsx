"use client";

import { CalendarDays, Github, Instagram, Mail, Rocket, Terminal } from "lucide-react";
import { AGENTS } from "@/lib/company/agents";
import { useCompany } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { ToolId } from "@/lib/types";
import { Chip, Panel, PanelHeader } from "@/components/ui/primitives";

/**
 * External integrations, in the order they are worth connecting.
 *
 * The count beside each one is read from the Agent Registry, so it says how
 * many AI employees a given connection actually puts to work — that is the
 * whole argument for doing one before another.
 */

type State = "connected" | "available" | "planned";

interface Integration {
  id: string;
  icon: typeof Mail;
  label: string;
  detail: string;
  /** Registry capabilities this connection switches on. */
  unlocks: ToolId[];
  gate: string;
  state: State;
}

function countFor(tools: ToolId[]): number {
  return AGENTS.filter((a) => tools.some((t) => a.tools.includes(t))).length;
}

export function Integrations() {
  const runtime = useCompany((s) => s.runtime);
  const google = runtime?.integrations?.google ?? false;

  const integrations: Integration[] = [
    {
      id: "gmail",
      icon: Mail,
      label: "Gmail",
      detail: "受信箱を読み、CEOの承認を経てメールを送信します。",
      unlocks: ["email"],
      gate: "送信はCEO承認",
      state: google ? "connected" : "available",
    },
    {
      id: "calendar",
      icon: CalendarDays,
      label: "Google Calendar",
      detail: "空き時間を確認し、予定を作成します。",
      unlocks: ["calendar"],
      gate: "招待ありはCEO承認",
      state: google ? "connected" : "available",
    },
    {
      id: "github",
      icon: Github,
      label: "GitHub",
      detail: "Issue・PR・コードの読み書き。",
      unlocks: ["github"],
      gate: "書き込みはCEO承認",
      state: "planned",
    },
    {
      id: "vercel",
      icon: Rocket,
      label: "Vercel",
      detail: "デプロイ状況の確認と本番反映。",
      unlocks: ["deploy"],
      gate: "本番反映はCEO承認",
      state: "planned",
    },
    {
      id: "instagram",
      icon: Instagram,
      label: "Instagram Graph API",
      detail: "インサイトの取得と投稿。投稿にはMetaの審査が必要です。",
      unlocks: ["social_media"],
      gate: "公開はCEO承認",
      state: "planned",
    },
  ];

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Integrations"
        hint="AI社員が社外で実際に動くための接続"
        action={
          <Chip className={google ? "bg-live/12 text-live" : "bg-white/5 text-ink-faint"}>
            {google ? "GOOGLE CONNECTED" : "NOT CONNECTED"}
          </Chip>
        }
      />

      <ul className="divide-y divide-hairline">
        {integrations.map((integration) => (
          <li key={integration.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <integration.icon
              className={cn(
                "h-4 w-4 shrink-0",
                integration.state === "connected" ? "text-live" : "text-ink-faint",
              )}
              strokeWidth={1.75}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-medium text-ink">{integration.label}</span>
                <span className="num text-3xs text-ink-faint">
                  {countFor(integration.unlocks)} 名が使用
                </span>
              </div>
              <p className="mt-0.5 text-2xs leading-relaxed text-ink-faint">
                {integration.detail}
              </p>
            </div>
            <Chip className="bg-warn/10 text-warn">{integration.gate}</Chip>
            <Chip
              className={
                integration.state === "connected"
                  ? "bg-live/12 text-live"
                  : integration.state === "available"
                    ? "bg-info/12 text-info"
                    : ""
              }
            >
              {integration.state === "connected"
                ? "Connected"
                : integration.state === "available"
                  ? "Setup"
                  : "Planned"}
            </Chip>
          </li>
        ))}
      </ul>

      {!google && (
        <div className="space-y-3 border-t border-hairline px-5 py-4">
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-accent-soft" strokeWidth={1.75} />
            <span className="text-[12px] font-medium text-ink">
              Gmail と Calendar を繋ぐ — 認証は1回だけ
            </span>
          </div>

          <ol className="space-y-2.5">
            <Step n={1}>
              <a
                href="https://console.cloud.google.com/apis/library"
                target="_blank"
                rel="noreferrer"
                className="text-accent-soft hover:underline"
              >
                Google Cloud Console
              </a>{" "}
              でプロジェクトを作り、<strong className="text-ink-muted">Gmail API</strong> と{" "}
              <strong className="text-ink-muted">Google Calendar API</strong> を有効化します。
            </Step>
            <Step n={2}>
              OAuth 同意画面を設定し、自分のアカウントをテストユーザーに追加。続いて
              「認証情報 → OAuth クライアントID →
              <strong className="text-ink-muted"> デスクトップアプリ</strong>」を作成します。
            </Step>
            <Step n={3}>
              ターミナルで次を実行し、画面の指示に従います。ブラウザで許可すると、
              .env.local に貼る3行が表示されます。
              <pre className="mt-1.5 overflow-x-auto rounded-lg border border-hairline bg-black/30 p-3 font-mono text-2xs leading-relaxed text-ink-muted">
{`npm run google-auth`}
              </pre>
            </Step>
            <Step n={4}>
              <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-2xs text-ink-muted">
                npm run dev
              </code>{" "}
              を再起動すると、ここが Connected に変わります。
            </Step>
          </ol>

          <p className="rounded-lg border border-warn/25 bg-warn/[0.05] px-3 py-2 text-2xs leading-relaxed text-warn/90">
            接続後もAI社員は自分でメールを送れません。文面はそのままCEOの承認待ちに入り、
            承認された瞬間にサーバーが送信します。
          </p>
        </div>
      )}
    </Panel>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent/12 text-3xs text-accent-soft">
        {n}
      </span>
      <div className="min-w-0 flex-1 text-2xs leading-relaxed text-ink-muted">{children}</div>
    </li>
  );
}
