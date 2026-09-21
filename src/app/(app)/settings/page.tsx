"use client";

import { useState } from "react";
import { Check, Database, Sparkles, Wrench } from "lucide-react";
import { AGENTS } from "@/lib/company/agents";
import { DEPARTMENTS } from "@/lib/company/departments";
import { useCompany } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button, Chip, Panel, PanelHeader } from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/page-header";

const PHASES = [
  { id: 1, label: "UI / UX", done: true },
  { id: 2, label: "Mock Agent System", done: true },
  { id: 3, label: "Database (Supabase)", done: false },
  { id: 4, label: "Claude API", done: false },
  { id: 5, label: "Real Tools", done: false },
  { id: 6, label: "Scheduled Reports", done: false },
  { id: 7, label: "External Integrations", done: false },
];

const TOOLS = [
  { id: "web_research", label: "Web Research", gated: false },
  { id: "browser", label: "Browser", gated: false },
  { id: "code_execution", label: "Code Execution", gated: false },
  { id: "file_search", label: "File Search", gated: false },
  { id: "database", label: "Database", gated: false },
  { id: "analytics", label: "Analytics", gated: false },
  { id: "email", label: "Email", gated: true },
  { id: "social_media", label: "Social Media", gated: true },
  { id: "calendar", label: "Calendar", gated: false },
  { id: "github", label: "GitHub", gated: false },
  { id: "design", label: "Design", gated: false },
  { id: "deploy", label: "Deploy", gated: true },
];

export default function SettingsPage() {
  const schedule = useCompany((s) => s.schedule);
  const simulating = useCompany((s) => s.simulating);
  const toggleSimulation = useCompany((s) => s.toggleSimulation);

  const [draft, setDraft] = useState(schedule);
  const [saved, setSaved] = useState(false);

  function save() {
    useCompany.setState({ schedule: draft });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<span className="label">System</span>}
        title="Settings"
        description="AI会社の定期実行、権限ゲート、そして実装フェーズの状態。"
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel className="overflow-hidden">
            <PanelHeader
              title="Scheduled Reports"
              hint="Cron"
              action={
                <Button variant={saved ? "success" : "primary"} size="xs" onClick={save}>
                  {saved ? (
                    <>
                      <Check className="h-3 w-3" strokeWidth={2.25} />
                      Saved
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              }
            />
            <div className="divide-y divide-hairline">
              <TimeRow
                label="Morning Briefing"
                hint="昨日の成果 → 今日の重要タスク → CEOが判断すること"
                value={draft.morningBriefing}
                onChange={(v) => setDraft({ ...draft, morningBriefing: v })}
              />
              <TimeRow
                label="Daily Executive Report"
                hint="その日の全社成果を自然言語で要約し、明日の推奨アクションを生成"
                value={draft.dailyReport}
                onChange={(v) => setDraft({ ...draft, dailyReport: v })}
              />
              <div className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-ink">Weekly Board Meeting</div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                    各Directorが週次の結果を報告し、COOが統合
                  </p>
                </div>
                <select
                  value={draft.weeklyBoardDay}
                  onChange={(e) => setDraft({ ...draft, weeklyBoardDay: e.target.value })}
                  aria-label="Board meeting day"
                  className="h-8 rounded-lg border border-hairline bg-white/[0.03] px-2 text-xs text-ink focus:border-accent-line focus:outline-none"
                >
                  {["Sunday", "Monday", "Friday", "Saturday"].map((d) => (
                    <option key={d} value={d} className="bg-surface-overlay">
                      {d}
                    </option>
                  ))}
                </select>
                <input
                  type="time"
                  value={draft.weeklyBoard}
                  onChange={(e) => setDraft({ ...draft, weeklyBoard: e.target.value })}
                  aria-label="Board meeting time"
                  className="num h-8 w-[104px] rounded-lg border border-hairline bg-white/[0.03] px-2 text-xs text-ink focus:border-accent-line focus:outline-none"
                />
              </div>
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader
              title="Tool Permissions"
              action={<Wrench className="h-3.5 w-3.5 text-ink-ghost" strokeWidth={1.75} />}
            />
            <ul className="grid gap-px bg-hairline sm:grid-cols-2">
              {TOOLS.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-2.5 bg-surface/60 px-4 py-2.5"
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      t.gated ? "bg-warn" : "bg-live",
                    )}
                  />
                  <span className="flex-1 text-[11px] text-ink-muted">{t.label}</span>
                  <Chip className={t.gated ? "bg-warn/10 text-warn" : "bg-live/10 text-live"}>
                    {t.gated ? "Approval" : "Auto"}
                  </Chip>
                </li>
              ))}
            </ul>
            <p className="border-t border-hairline px-5 py-3 text-[10px] leading-relaxed text-ink-ghost">
              Approval 指定のツールは、AI社員が実行を要求してもCEOが承認するまで動きません。
            </p>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader title="Mock Agent System" hint="Phase 2" />
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-ink">Live activity simulation</div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                  Claude API 接続前でも、AI社員の行動をリアルタイムに生成します。
                </p>
              </div>
              <Button
                variant={simulating ? "success" : "outline"}
                size="sm"
                onClick={toggleSimulation}
              >
                {simulating ? "Running" : "Paused"}
              </Button>
            </div>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel className="overflow-hidden">
            <PanelHeader
              title="Implementation Phases"
              action={<Sparkles className="h-3.5 w-3.5 text-accent-soft" strokeWidth={1.75} />}
            />
            <ol className="divide-y divide-hairline">
              {PHASES.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                  <span
                    className={cn(
                      "num flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px]",
                      p.done ? "bg-live/12 text-live" : "bg-white/[0.04] text-ink-ghost",
                    )}
                  >
                    {p.id}
                  </span>
                  <span
                    className={cn(
                      "flex-1 text-[11px]",
                      p.done ? "text-ink-muted" : "text-ink-faint",
                    )}
                  >
                    {p.label}
                  </span>
                  <Chip className={p.done ? "bg-live/10 text-live" : ""}>
                    {p.done ? "Done" : "Planned"}
                  </Chip>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader
              title="Agent Registry"
              action={<Database className="h-3.5 w-3.5 text-ink-ghost" strokeWidth={1.75} />}
            />
            <div className="space-y-3 px-5 py-4">
              <div className="grid grid-cols-2 gap-4">
                <Stat label="AI employees" value={String(AGENTS.length)} />
                <Stat label="Departments" value={String(DEPARTMENTS.length)} />
                <Stat
                  label="Executives"
                  value={String(AGENTS.filter((a) => a.seniority === "executive").length)}
                />
                <Stat
                  label="Specialists"
                  value={String(AGENTS.filter((a) => a.seniority === "specialist").length)}
                />
              </div>
              <pre className="scroll-slim overflow-auto rounded-lg border border-hairline bg-black/30 p-3 font-mono text-[10px] leading-relaxed text-ink-faint">
{`{
  id, name, role, department,
  seniority, mission, systemPrompt,
  skills[], tools[], permissions[],
  reportsTo, collaborators[],
  status, currentTask, memory[]
}`}
              </pre>
              <p className="text-[10px] leading-relaxed text-ink-ghost">
                registry に1行追加すると、一覧・部署・フィルター・組織図・コマンドルーターへ自動的に反映されます。
              </p>
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader title="CEO" />
            <div className="flex items-center gap-3 px-5 py-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent/30 to-accent/5 font-mono text-sm font-semibold text-accent-soft ring-1 ring-inset ring-accent/25">
                陽
              </span>
              <div>
                <div className="text-[13px] font-medium text-ink">陽大</div>
                <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-ghost">
                  CEO / Founder · 最終意思決定者
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function TimeRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-ink">{label}</div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">{hint}</p>
      </div>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="num h-8 w-[104px] rounded-lg border border-hairline bg-white/[0.03] px-2 text-xs text-ink focus:border-accent-line focus:outline-none"
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="num mt-1 text-lg font-semibold leading-none text-ink">{value}</div>
    </div>
  );
}
