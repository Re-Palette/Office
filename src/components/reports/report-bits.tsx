"use client";

import Link from "next/link";
import { ArrowUpRight, Download, FileText } from "lucide-react";
import { REPORT_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { Report, ReportStatus } from "@/lib/types";
import { Chip } from "@/components/ui/primitives";

export function ReportStatusChip({
  status,
  className,
}: {
  status: ReportStatus;
  className?: string;
}) {
  const meta = REPORT_STATUS[status];
  return (
    <Chip className={cn("gap-1.5", meta.chip, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Chip>
  );
}

/**
 * The confirmation control the CEO actually uses: the review state and the
 * PDF URL, side by side. The link opens the PDF in a new tab.
 */
export function PdfLink({
  report,
  variant = "inline",
  className,
}: {
  report: Report;
  variant?: "inline" | "button" | "url";
  className?: string;
}) {
  if (variant === "url") {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <code className="min-w-0 flex-1 truncate rounded-md border border-hairline bg-black/25 px-2 py-1.5 font-mono text-[10px] text-ink-faint">
          {report.pdfUrl}
        </code>
        <a
          href={report.pdfUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-accent/15 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-soft transition-colors hover:bg-accent/25"
        >
          Open
          <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
        </a>
        <a
          href={`${report.pdfUrl}?download=1`}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-ink-ghost transition-colors hover:bg-white/5 hover:text-ink-faint"
          aria-label="Download PDF"
        >
          <Download className="h-3 w-3" strokeWidth={1.75} />
        </a>
      </div>
    );
  }

  if (variant === "button") {
    return (
      <a
        href={report.pdfUrl}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-accent-line hover:bg-accent/[0.08] hover:text-ink",
          className,
        )}
      >
        <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
        Open PDF
        <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
      </a>
    );
  }

  return (
    <a
      href={report.pdfUrl}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-soft transition-colors hover:text-accent",
        className,
      )}
    >
      Open PDF
      <ArrowUpRight className="h-2.5 w-2.5" strokeWidth={2} />
    </a>
  );
}

export function ReportTitleLink({ report }: { report: Report }) {
  return (
    <Link
      href={`/reports/${report.id}`}
      className="group flex items-center gap-2 text-[12px] font-medium text-ink transition-colors hover:text-accent-soft"
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-ink-ghost" strokeWidth={1.75} />
      <span className="truncate">{report.title}</span>
      {report.version > 1 && (
        <Chip className="shrink-0 bg-[#A78BFA]/12 text-[#A78BFA]">v{report.version}</Chip>
      )}
    </Link>
  );
}
