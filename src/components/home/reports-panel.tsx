"use client";

import Link from "next/link";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { useCompany } from "@/lib/store";
import { formatRelative } from "@/lib/time";
import { REPORT_TYPE_LABEL } from "@/lib/types";
import { Avatar, Chip, Empty, Panel, PanelHeader } from "@/components/ui/primitives";
import { PdfLink, ReportStatusChip } from "@/components/reports/report-bits";

/** The latest reports the company has produced, newest first. */
export function ReportsPanel() {
  const reports = useCompany((s) => s.reports);
  const now = useCompany((s) => s.now);

  const recent = [...reports].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
  const pending = reports.filter((r) => r.status === "PENDING_REVIEW").length;

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Reports"
        hint={pending > 0 ? `${pending} awaiting review` : "up to date"}
        action={
          <Link
            href="/reports"
            className="font-mono text-3xs uppercase tracking-[0.14em] text-ink-ghost transition-colors hover:text-accent-soft"
          >
            Report Center
          </Link>
        }
      />
      {recent.length === 0 ? (
        <Empty title="レポートはまだありません" />
      ) : (
        <ul className="divide-y divide-hairline">
          {recent.map((report) => {
            const author = AGENTS_BY_ID[report.createdBy];
            return (
              <li key={report.id} className="px-5 py-3">
                <div className="flex items-center gap-2">
                  <Chip>{REPORT_TYPE_LABEL[report.type]}</Chip>
                  <span className="num ml-auto text-3xs text-ink-ghost">
                    {formatRelative(report.createdAt, now)}
                  </span>
                </div>
                <Link
                  href={`/reports/${report.id}`}
                  className="mt-1.5 block truncate text-[12px] font-medium text-ink transition-colors hover:text-accent-soft"
                >
                  {report.title}
                </Link>
                <div className="mt-1.5 flex items-center gap-2">
                  {author && <Avatar name={author.name} accent={author.accent} size="xs" />}
                  <span className="truncate text-3xs text-ink-faint">
                    {author?.role ?? report.createdBy}
                  </span>
                  <ReportStatusChip status={report.status} className="ml-auto" />
                </div>
                <div className="mt-1.5">
                  <PdfLink report={report} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
