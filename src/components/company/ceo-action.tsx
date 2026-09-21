"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Banknote,
  Check,
  FileText,
  ListChecks,
  Mail,
  Plug,
  Rocket,
  Share2,
  Sparkles,
  X,
} from "lucide-react";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { useCompany } from "@/lib/store";
import { PRIORITY_BADGE, PRIORITY_ORDER } from "@/lib/status";
import { formatRelative } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ApprovalKind, Priority } from "@/lib/types";
import { Avatar, Button, Chip, Empty, Panel, PanelHeader } from "@/components/ui/primitives";
import { PdfLink } from "@/components/reports/report-bits";

/**
 * One list of everything blocking on the CEO, whatever produced it —
 * a report awaiting review, a task stopped at the approval gate, a budget,
 * a deploy. This is the most important information in the product, so it is
 * derived once here and rendered in several places.
 */

export interface CeoAction {
  id: string;
  approvalId: string;
  kind: ApprovalKind;
  category: "REPORT" | "TASK" | "PROJECT" | "DECISION";
  title: string;
  summary: string;
  agentId: string;
  at: number;
  priority: Priority;
  href: string;
  reportId?: string;
}

const CATEGORY_BY_KIND: Record<ApprovalKind, CeoAction["category"]> = {
  report: "REPORT",
  deploy: "TASK",
  email: "TASK",
  social_post: "TASK",
  task: "TASK",
  budget: "DECISION",
  contract: "DECISION",
  decision: "DECISION",
  external_service: "DECISION",
  project_start: "PROJECT",
};

const ICON_BY_KIND: Record<ApprovalKind, typeof Rocket> = {
  report: FileText,
  deploy: Rocket,
  email: Mail,
  social_post: Share2,
  task: ListChecks,
  budget: Banknote,
  contract: FileText,
  decision: Sparkles,
  external_service: Plug,
  project_start: Rocket,
};

export function useCeoActions(): CeoAction[] {
  const approvals = useCompany((s) => s.approvals);
  const reports = useCompany((s) => s.reports);

  return useMemo(() => {
    const open = approvals.filter((a) => a.status === "pending" || a.status === "reviewing");

    return open
      .map((a) => {
        const report = a.relatedReportId
          ? reports.find((r) => r.id === a.relatedReportId)
          : undefined;

        return {
          id: a.id,
          approvalId: a.id,
          kind: a.kind,
          category: CATEGORY_BY_KIND[a.kind],
          title: report ? report.title : a.title,
          summary: a.summary,
          agentId: a.requestedBy,
          at: a.requestedAt,
          priority: a.priority,
          href: a.href ?? (report ? `/reports/${report.id}` : "/tasks"),
          reportId: report?.id,
        } satisfies CeoAction;
      })
      .sort(
        (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.at - a.at,
      );
  }, [approvals, reports]);
}

/* ── Home: the loudest block on the dashboard ─────────────────────────────── */

export function CeoActionRequired() {
  const actions = useCeoActions();
  const reports = useCompany((s) => s.reports);
  const now = useCompany((s) => s.now);
  const decide = useCompany((s) => s.decideApproval);
  const router = useRouter();

  if (actions.length === 0) {
    return (
      <Panel className="overflow-hidden">
        <PanelHeader title="CEO Action Required" hint="all clear" />
        <Empty
          title="あなたの判断を待っているものはありません"
          hint="AI社員は承認が必要になると、ここへ持ってきます"
        />
      </Panel>
    );
  }

  // URGENT / HIGH first, as the spec requires — the rest stay one click away.
  const featured = actions.filter((a) => a.priority === "urgent" || a.priority === "high");
  const shown = (featured.length > 0 ? featured : actions).slice(0, 4);
  const remaining = actions.length - shown.length;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-2xl border border-warn/25 bg-warn/[0.05] shadow-panel"
    >
      <div
        className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full bg-warn/10 blur-[90px]"
        aria-hidden
      />

      <div className="relative flex flex-wrap items-end justify-between gap-4 px-5 py-4 lg:px-6">
        <div className="flex items-end gap-4">
          <span className="num text-[44px] font-semibold leading-none tracking-tight text-warn">
            {actions.length}
          </span>
          <div className="pb-1">
            <div className="font-mono text-3xs uppercase tracking-[0.2em] text-warn">
              CEO Action Required
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">
              {actions.length === 1 ? "item requires" : "items require"} your attention
            </p>
          </div>
        </div>
        <Link
          href="/command"
          className="font-mono text-3xs uppercase tracking-[0.14em] text-warn transition-opacity hover:opacity-80"
        >
          Approval queue →
        </Link>
      </div>

      <ul className="relative grid gap-px border-t border-warn/15 bg-warn/10 lg:grid-cols-2">
        {shown.map((action, i) => {
          const agent = AGENTS_BY_ID[action.agentId];
          const Icon = ICON_BY_KIND[action.kind];
          const report = action.reportId
            ? reports.find((r) => r.id === action.reportId)
            : undefined;

          return (
            <motion.li
              key={action.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.06 * i }}
              className="bg-canvas/60 px-5 py-3.5"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-warn/12 text-warn">
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-3xs uppercase tracking-[0.16em] text-warn">
                      {action.category}
                    </span>
                    <Chip className={PRIORITY_BADGE[action.priority].chip}>
                      {PRIORITY_BADGE[action.priority].label}
                    </Chip>
                    <span className="num ml-auto text-3xs text-ink-ghost">
                      {formatRelative(action.at, now)}
                    </span>
                  </div>

                  <Link
                    href={action.href}
                    className="mt-1 block truncate text-[13px] font-medium text-ink transition-colors hover:text-accent-soft"
                  >
                    {action.title}
                  </Link>

                  <div className="mt-1 flex items-center gap-1.5">
                    {agent && <Avatar name={agent.name} accent={agent.accent} size="xs" />}
                    <span className="truncate text-3xs text-ink-faint">
                      {agent?.role ?? action.agentId}
                    </span>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {report && <PdfLink report={report} />}
                    <Button
                      variant="subtle"
                      size="xs"
                      onClick={() => router.push(action.href)}
                      className="bg-warn/12 text-warn hover:bg-warn/20"
                    >
                      Review
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => decide(action.approvalId, "approved")}
                    >
                      <Check className="h-3 w-3" strokeWidth={2.25} />
                      Approve
                    </Button>
                  </div>
                </div>
              </div>
            </motion.li>
          );
        })}
      </ul>

      {remaining > 0 && (
        <Link
          href="/command"
          className="relative block border-t border-warn/15 bg-canvas/40 px-5 py-2.5 text-center font-mono text-3xs uppercase tracking-[0.14em] text-ink-faint transition-colors hover:text-warn"
        >
          +{remaining} more awaiting your decision
        </Link>
      )}
    </motion.section>
  );
}

/* ── Compact queue for the CEO Inbox ──────────────────────────────────────── */

export function ApprovalQueue({ limit = 6 }: { limit?: number }) {
  const actions = useCeoActions();
  const now = useCompany((s) => s.now);
  const decide = useCompany((s) => s.decideApproval);
  const router = useRouter();

  if (actions.length === 0) {
    return <Empty title="承認待ちはありません" />;
  }

  return (
    <div>
      <div className="border-b border-hairline px-4 py-2.5">
        <span className="num text-sm font-semibold text-warn">{actions.length}</span>
        <span className="ml-2 font-mono text-3xs uppercase tracking-[0.16em] text-ink-faint">
          items require your approval
        </span>
      </div>
      <ol className="divide-y divide-hairline">
        {actions.slice(0, limit).map((action, i) => {
          const agent = AGENTS_BY_ID[action.agentId];
          return (
            <li key={action.id} className="flex items-start gap-3 px-4 py-3">
              <span className="num mt-0.5 w-4 shrink-0 text-3xs text-ink-ghost">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Chip className={PRIORITY_BADGE[action.priority].chip}>
                    {PRIORITY_BADGE[action.priority].label}
                  </Chip>
                  <span className="num ml-auto text-3xs text-ink-ghost">
                    {formatRelative(action.at, now)}
                  </span>
                </div>
                <Link
                  href={action.href}
                  className="mt-1 block truncate text-[12px] font-medium text-ink transition-colors hover:text-accent-soft"
                >
                  {action.title}
                </Link>
                <div className="mt-1 flex items-center gap-2">
                  {agent && (
                    <span className="truncate text-3xs text-ink-faint">{agent.role}</span>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => router.push(action.href)}
                      className="px-1.5"
                    >
                      Review
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-label="Approve"
                      className="px-1.5 text-live hover:bg-live/10"
                      onClick={() => decide(action.approvalId, "approved")}
                    >
                      <Check className="h-3 w-3" strokeWidth={2.25} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-label="Reject"
                      className="px-1.5 text-danger hover:bg-danger/10"
                      onClick={() => decide(action.approvalId, "rejected")}
                    >
                      <X className="h-3 w-3" strokeWidth={2.25} />
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
