"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { AGENTS_BY_ID, EXECUTIVE_IDS } from "@/lib/company/agents";
import { BOARD_MEETINGS } from "@/lib/company/reports";
import { useCompany } from "@/lib/store";
import { formatCountdown, formatDate, formatTime } from "@/lib/time";
import { Avatar, Chip, Panel, PanelHeader, StatusPill } from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/page-header";

export default function MeetingsPage() {
  const now = useCompany((s) => s.now);
  const agents = useCompany((s) => s.agents);
  const schedule = useCompany((s) => s.schedule);

  const upcoming = BOARD_MEETINGS.find((m) => m.status === "scheduled");
  const completed = BOARD_MEETINGS.filter((m) => m.status === "completed");
  const [selected, setSelected] = useState(completed[0]?.id);

  const meeting = completed.find((m) => m.id === selected) ?? completed[0];
  const executives = EXECUTIVE_IDS.map((id) => agents.find((a) => a.id === id)).filter(Boolean);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<span className="label">Governance</span>}
        title="AI Board Meeting"
        description={`毎週 ${schedule.weeklyBoardDay} ${schedule.weeklyBoard} に、各DirectorがCEOへ1週間の結果を報告します。`}
      />

      {upcoming && (
        <Panel className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-accent/10 blur-[100px]"
            aria-hidden
          />
          <div className="relative flex flex-wrap items-center justify-between gap-4 px-5 py-5 lg:px-7">
            <div>
              <div className="flex items-center gap-2">
                <CalendarClock className="h-3.5 w-3.5 text-accent-soft" strokeWidth={1.75} />
                <span className="label text-accent-soft">Next board meeting</span>
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">
                {upcoming.title}
              </h2>
              <p className="mt-1 text-xs text-ink-faint">
                {formatDate(upcoming.at)} · {formatTime(upcoming.at)} JST
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="label">Starts in</div>
                <div className="num mt-1 text-xl font-semibold text-ink">
                  {formatCountdown(upcoming.at, now)}
                </div>
              </div>
              <div className="flex -space-x-1.5">
                {executives.map((e) =>
                  e ? (
                    <Avatar
                      key={e.id}
                      name={e.name}
                      accent={e.accent}
                      size="sm"
                      className="ring-2 ring-surface"
                    />
                  ) : null,
                )}
              </div>
            </div>
          </div>

          <div className="relative border-t border-hairline px-5 py-4 lg:px-7">
            <span className="label">Attending directors</span>
            <ul className="mt-2.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {executives.map((e) =>
                e ? (
                  <li key={e.id}>
                    <Link
                      href={`/employees/${e.id}`}
                      className="flex items-center gap-2.5 rounded-lg border border-hairline bg-white/[0.02] px-2.5 py-2 transition-colors hover:border-accent-line hover:bg-accent/[0.05]"
                    >
                      <Avatar name={e.name} accent={e.accent} size="xs" />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">
                        {e.role}
                      </span>
                      <StatusPill status={e.status} showLabel={false} />
                    </Link>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        </Panel>
      )}

      {completed.length > 1 && (
        <Panel className="flex flex-wrap gap-1 px-4 py-2.5">
          {completed.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelected(m.id)}
              className={`rounded-lg px-2.5 py-1 font-mono text-2xs uppercase tracking-wider transition-colors ${
                meeting?.id === m.id
                  ? "bg-accent/15 text-accent-soft"
                  : "text-ink-faint hover:bg-white/5"
              }`}
            >
              {m.title}
            </button>
          ))}
        </Panel>
      )}

      {meeting && (
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {meeting.reports.map((report, i) => {
              const agent = AGENTS_BY_ID[report.agentId];
              return (
                <motion.article
                  key={report.agentId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.05 }}
                  className="flex flex-col rounded-2xl border border-hairline bg-surface/70 p-5"
                >
                  <div className="flex items-start gap-3">
                    {agent && (
                      <Avatar name={agent.name} accent={agent.accent} size="md" />
                    )}
                    <div className="min-w-0 flex-1">
                      <Link
                        href={agent ? `/employees/${agent.id}` : "#"}
                        className="text-[13px] font-semibold text-ink transition-colors hover:text-accent-soft"
                      >
                        {agent?.role ?? report.agentId}
                      </Link>
                      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-ghost">
                        {report.area}
                      </div>
                    </div>
                  </div>

                  <p className="mt-3 text-xs font-medium leading-relaxed text-ink">
                    {report.headline}
                  </p>

                  <ul className="mt-3 space-y-1.5">
                    {report.points.map((p, pi) => (
                      <li key={pi} className="flex items-start gap-2">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-ghost" />
                        <span className="text-[11px] leading-relaxed text-ink-muted">{p}</span>
                      </li>
                    ))}
                  </ul>

                  {report.metric && (
                    <div className="mt-auto flex items-baseline justify-between border-t border-hairline pt-3.5">
                      <span className="label">{report.metric.label}</span>
                      <div className="flex items-baseline gap-2">
                        <span className="num text-sm font-semibold text-ink">
                          {report.metric.value}
                        </span>
                        {report.metric.delta && (
                          <span className="num text-[10px] text-live">{report.metric.delta}</span>
                        )}
                      </div>
                    </div>
                  )}
                </motion.article>
              );
            })}
          </div>

          <Panel className="overflow-hidden">
            <PanelHeader
              title="COO Summary"
              action={<Chip className="bg-accent/12 text-accent-soft">Integrated</Chip>}
            />
            <div className="px-5 py-5 lg:px-7">
              <p className="max-w-4xl text-sm leading-[1.85] text-ink-muted">{meeting.summary}</p>
            </div>
            <div className="border-t border-hairline px-5 py-4 lg:px-7">
              <span className="label">Decisions</span>
              <ul className="mt-2.5 space-y-2">
                {meeting.decisions.map((d, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <CheckCircle2
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-live"
                      strokeWidth={1.75}
                    />
                    <span className="text-xs leading-relaxed text-ink-muted">{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
