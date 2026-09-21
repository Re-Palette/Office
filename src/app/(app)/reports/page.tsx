"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { FilePlus2, Search, Sparkles } from "lucide-react";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { DEPARTMENTS } from "@/lib/company/departments";
import { PROJECTS, PROJECTS_BY_ID } from "@/lib/company/projects";
import { NEXT_SCHEDULED } from "@/lib/company/reports";
import { useCompany } from "@/lib/store";
import { formatCountdown, formatDay, formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { REPORT_TYPE_LABEL, type Report, type ReportStatus, type ReportType } from "@/lib/types";
import {
  Avatar,
  Button,
  Chip,
  Empty,
  FilterTabs,
  Panel,
  PanelHeader,
} from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/page-header";
import { PdfLink, ReportStatusChip, ReportTitleLink } from "@/components/reports/report-bits";

type Bucket =
  | "all"
  | "pending"
  | "approved"
  | "draft"
  | "generating"
  | "revision"
  | "archived";

const BUCKETS: { id: Bucket; label: string; match: (s: ReportStatus) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "pending", label: "CEO確認待ち", match: (s) => s === "PENDING_REVIEW" },
  { id: "revision", label: "修正依頼", match: (s) => s === "REVISION_REQUIRED" },
  { id: "generating", label: "作成中", match: (s) => s === "GENERATING" || s === "GENERATED" },
  { id: "draft", label: "下書き", match: (s) => s === "DRAFT" },
  { id: "approved", label: "承認済み", match: (s) => s === "APPROVED" },
  { id: "archived", label: "アーカイブ", match: (s) => s === "ARCHIVED" || s === "REJECTED" },
];

/** Compact labels for the table — the "Report" suffix is implied by the column. */
const SHORT_TYPE: Record<ReportType, string> = {
  daily: "Daily",
  weekly: "Weekly",
  project: "Project",
  department: "Department",
  research: "Research",
  task_completion: "Task Completion",
  executive: "Executive",
  briefing: "Briefing",
};

const GENERATABLE: ReportType[] = [
  "daily",
  "weekly",
  "executive",
  "project",
  "department",
  "research",
  "task_completion",
];

export default function ReportCenterPage() {
  const reports = useCompany((s) => s.reports);
  const now = useCompany((s) => s.now);
  const schedule = useCompany((s) => s.schedule);

  const [bucket, setBucket] = useState<Bucket>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = BUCKETS.find((b) => b.id === bucket)!.match;
    return reports
      .filter((r) => match(r.status))
      .filter((r) =>
        q
          ? `${r.title} ${REPORT_TYPE_LABEL[r.type]} ${r.createdBy}`.toLowerCase().includes(q)
          : true,
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [reports, bucket, query]);

  const pending = reports.filter((r) => r.status === "PENDING_REVIEW");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<span className="label">Report Center</span>}
        title="Reports"
        description="AI社員が仕事の成果から作成した正式なレポート。PDFで出力され、CEOの確認を経て確定します。"
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-ghost"
                strokeWidth={1.75}
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="レポートを検索"
                aria-label="Search reports"
                className="h-9 w-[200px] rounded-lg border border-hairline bg-white/[0.03] pl-9 pr-3 text-xs text-ink placeholder:text-ink-ghost focus:border-accent-line focus:outline-none"
              />
            </div>
          </div>
        }
      />

      {pending.length > 0 && (
        <Link
          href={`/reports/${pending[0].id}`}
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-warn/25 bg-warn/[0.06] px-5 py-3.5 transition-colors hover:bg-warn/[0.1]"
        >
          <span className="num text-xl font-semibold text-warn">{pending.length}</span>
          <span className="text-xs text-warn/90">
            {pending.length === 1 ? "report is" : "reports are"} waiting for your review
          </span>
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-warn">
            Review →
          </span>
        </Link>
      )}

      <div className="grid gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-3">
        <ScheduleCell
          label="Morning Briefing"
          time={schedule.morningBriefing}
          next={formatCountdown(NEXT_SCHEDULED.morningBriefing, now)}
        />
        <ScheduleCell
          label="Daily Executive Report"
          time={schedule.dailyReport}
          next={formatCountdown(NEXT_SCHEDULED.dailyReport, now)}
        />
        <ScheduleCell
          label="Weekly Board Meeting"
          time={`${schedule.weeklyBoardDay} ${schedule.weeklyBoard}`}
          next={formatCountdown(NEXT_SCHEDULED.boardMeeting, now)}
        />
      </div>

      <GenerateReport />

      <Panel className="px-4 py-2.5">
        <FilterTabs<Bucket>
          value={bucket}
          onChange={setBucket}
          options={BUCKETS.map((b) => ({
            id: b.id,
            label: b.label,
            count: reports.filter((r) => b.match(r.status)).length,
          }))}
        />
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader title="Reports" hint={`${filtered.length} shown`} />
        {filtered.length === 0 ? (
          <Empty title="該当するレポートはありません" />
        ) : (
          <ReportTable reports={filtered} now={now} />
        )}
      </Panel>
    </div>
  );
}

function ScheduleCell({ label, time, next }: { label: string; time: string; next: string }) {
  return (
    <div className="bg-surface/70 px-5 py-4">
      <div className="label">{label}</div>
      <div className="num mt-1.5 text-lg font-semibold leading-none text-ink">{time}</div>
      <div className="mt-1 text-[10px] text-ink-ghost">next in {next}</div>
    </div>
  );
}

/* ── Table ────────────────────────────────────────────────────────────────── */

function ReportTable({ reports, now }: { reports: Report[]; now: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-collapse">
        <thead>
          <tr className="border-b border-hairline">
            {[
              "Report Title",
              "Type",
              "Created By",
              "Related Project",
              "Created At",
              "Status",
            ].map((h) => (
              <th
                key={h}
                className="px-3 py-2.5 text-left font-mono text-[9px] uppercase tracking-[0.16em] text-ink-ghost"
              >
                {h}
              </th>
            ))}
            {/* Pinned: the confirmation state and PDF link must never scroll away. */}
            <th className="sticky right-0 z-10 border-l border-hairline bg-surface px-3 py-2.5 text-left font-mono text-[9px] uppercase tracking-[0.16em] text-ink-ghost">
              Confirmation
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {reports.map((report, i) => {
            const author = AGENTS_BY_ID[report.createdBy];
            const project = report.projectId ? PROJECTS_BY_ID[report.projectId] : undefined;
            const department = report.departmentId
              ? DEPARTMENTS.find((d) => d.id === report.departmentId)
              : undefined;
            const needsReview = report.status === "PENDING_REVIEW";

            return (
              <motion.tr
                key={report.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25, delay: Math.min(i * 0.02, 0.2) }}
                className={cn(
                  "transition-colors hover:bg-white/[0.025]",
                  needsReview && "bg-warn/[0.035]",
                )}
              >
                <td className="w-[240px] max-w-[240px] px-3 py-3">
                  <ReportTitleLink report={report} />
                </td>
                <td className="px-3 py-3">
                  <Chip>{SHORT_TYPE[report.type]}</Chip>
                </td>
                <td className="px-3 py-3">
                  {author && (
                    <Link
                      href={`/employees/${author.id}`}
                      className="flex items-center gap-1.5 transition-colors hover:text-accent-soft"
                    >
                      <Avatar name={author.name} accent={author.accent} size="xs" />
                      <span className="text-[11px] text-ink-muted">{author.role}</span>
                    </Link>
                  )}
                </td>
                <td className="px-3 py-3">
                  {project ? (
                    <Link
                      href={`/projects/${project.id}`}
                      className="text-[11px] text-ink-muted transition-colors hover:text-accent-soft"
                    >
                      {project.name}
                    </Link>
                  ) : department ? (
                    <Link
                      href={`/departments/${department.id}`}
                      className="text-[11px] text-ink-muted transition-colors hover:text-accent-soft"
                    >
                      {department.name}
                    </Link>
                  ) : (
                    <span className="text-[11px] text-ink-ghost">全社</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-3">
                  <div className="num text-[11px] text-ink-muted">
                    {formatDay(report.createdAt)}
                  </div>
                  <div className="num text-[10px] text-ink-ghost">
                    {formatTime(report.createdAt)}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <ReportStatusChip status={report.status} />
                </td>
                <td
                  className={cn(
                    "sticky right-0 z-10 w-[210px] whitespace-nowrap border-l border-hairline px-3 py-3",
                    needsReview ? "bg-[#1b1a16]" : "bg-surface",
                  )}
                >
                  <div className="flex flex-col gap-1.5">
                    <span
                      className={cn(
                        "font-mono text-[10px] uppercase tracking-[0.14em]",
                        needsReview
                          ? "text-warn"
                          : report.status === "APPROVED"
                            ? "text-live"
                            : report.status === "REVISION_REQUIRED"
                              ? "text-[#A78BFA]"
                              : "text-ink-ghost",
                      )}
                    >
                      {needsReview
                        ? "Pending Review"
                        : report.status === "APPROVED"
                          ? `Approved${report.reviewedAt ? ` · ${formatDay(report.reviewedAt)}` : ""}`
                          : report.status === "REJECTED"
                            ? "Rejected"
                            : report.status === "REVISION_REQUIRED"
                              ? "Revision requested"
                              : "No review required"}
                    </span>
                    <div className="flex items-center gap-2">
                      <PdfLink report={report} />
                      {needsReview && (
                        <Link
                          href={`/reports/${report.id}`}
                          className="rounded-md bg-warn/12 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-warn transition-colors hover:bg-warn/20"
                        >
                          Review
                        </Link>
                      )}
                    </div>
                  </div>
                </td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Generation ───────────────────────────────────────────────────────────── */

function GenerateReport() {
  const generate = useCompany((s) => s.generateReport);
  const [type, setType] = useState<ReportType>("daily");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);

  const needsProject = type === "project";

  async function run() {
    setBusy(true);
    // A beat of latency so the generation reads as work, not a state flip.
    await new Promise((r) => setTimeout(r, 650));
    const report = generate({
      type,
      projectId: needsProject ? projectId || PROJECTS[0].id : undefined,
      departmentId: type === "department" ? "marketing" : undefined,
    });
    setLastId(report.id);
    setBusy(false);
  }

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Generate a report"
        hint="AI社員が実データを集約して作成します"
        action={<Sparkles className="h-3.5 w-3.5 text-accent-soft" strokeWidth={1.75} />}
      />
      <div className="flex flex-wrap items-end gap-3 px-5 py-4">
        <label className="flex flex-col gap-1.5">
          <span className="label">Report type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ReportType)}
            className="h-9 w-[210px] rounded-lg border border-hairline bg-white/[0.03] px-2.5 text-xs text-ink focus:border-accent-line focus:outline-none"
          >
            {GENERATABLE.map((t) => (
              <option key={t} value={t} className="bg-surface-overlay">
                {REPORT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>

        {needsProject && (
          <label className="flex flex-col gap-1.5">
            <span className="label">Project</span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="h-9 w-[190px] rounded-lg border border-hairline bg-white/[0.03] px-2.5 text-xs text-ink focus:border-accent-line focus:outline-none"
            >
              {PROJECTS.map((p) => (
                <option key={p.id} value={p.id} className="bg-surface-overlay">
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <Button variant="primary" size="md" onClick={run} disabled={busy}>
          <FilePlus2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          {busy ? "Generating…" : "Generate"}
        </Button>

        {lastId && !busy && (
          <Link
            href={`/reports/${lastId}`}
            className="inline-flex h-9 items-center rounded-lg bg-live/12 px-3 text-xs font-medium text-live transition-colors hover:bg-live/20"
          >
            生成しました — 開く
          </Link>
        )}

        <p className="w-full text-[11px] leading-relaxed text-ink-ghost">
          生成されたレポートはPDF化され、CEO確認待ちとして Report Center と CEO Inbox
          に追加されます。通知も自動で送信されます。
        </p>
      </div>
    </Panel>
  );
}
