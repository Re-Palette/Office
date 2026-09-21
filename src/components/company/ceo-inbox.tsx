"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  Check,
  Eye,
  FileSignature,
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
import { formatCountdown, formatRelative } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Approval, ApprovalKind } from "@/lib/types";
import { PRIORITY_BADGE } from "@/lib/status";
import { Avatar, Button, Chip, Empty } from "@/components/ui/primitives";

const KIND_META: Record<ApprovalKind, { label: string; icon: typeof Rocket }> = {
  project_start: { label: "PROJECT START", icon: Rocket },
  budget: { label: "BUDGET", icon: Banknote },
  external_service: { label: "EXTERNAL SERVICE", icon: Plug },
  email: { label: "EMAIL", icon: Mail },
  social_post: { label: "SOCIAL POST", icon: Share2 },
  deploy: { label: "DEPLOY", icon: Rocket },
  report: { label: "REPORT REVIEW", icon: FileText },
  task: { label: "TASK", icon: ListChecks },
  contract: { label: "CONTRACT", icon: FileSignature },
  decision: { label: "AI DECISION", icon: Sparkles },
};

const RISK_META = {
  low: { label: "LOW RISK", chip: "bg-white/5 text-ink-faint" },
  medium: { label: "MEDIUM RISK", chip: "bg-warn/10 text-warn" },
  high: { label: "HIGH RISK", chip: "bg-danger/10 text-danger" },
} as const;

export function CeoInbox({ compact = false }: { compact?: boolean }) {
  const approvals = useCompany((s) => s.approvals);
  const now = useCompany((s) => s.now);
  const decide = useCompany((s) => s.decideApproval);

  const pending = approvals.filter((a) => a.status === "pending" || a.status === "reviewing");

  if (pending.length === 0) {
    return (
      <Empty
        title="承認待ちはありません"
        hint="AI社員が外部アクションを要求するとここに届きます"
      />
    );
  }

  return (
    <div className="divide-y divide-hairline">
      <AnimatePresence initial={false}>
        {pending.map((approval) => (
          <motion.div
            key={approval.id}
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, height: 0, overflow: "hidden" }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <ApprovalCard
              approval={approval}
              now={now}
              compact={compact}
              onDecide={(d) => decide(approval.id, d)}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function ApprovalCard({
  approval,
  now,
  compact,
  onDecide,
}: {
  approval: Approval;
  now: number;
  compact: boolean;
  onDecide: (d: Approval["status"]) => void;
}) {
  const [expanded, setExpanded] = useState(!compact);
  const agent = AGENTS_BY_ID[approval.requestedBy];
  const meta = KIND_META[approval.kind];
  const Icon = meta.icon;
  const risk = RISK_META[approval.risk];
  const reviewing = approval.status === "reviewing";

  return (
    <div className={cn("px-4 py-3.5", reviewing && "bg-accent/[0.04]")}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-warn/10 text-warn">
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-warn">
              {meta.label}
            </span>
            <Chip className={risk.chip}>{risk.label}</Chip>
            {approval.deadline && (
              <span className="num text-[10px] text-ink-ghost">
                {formatCountdown(approval.deadline, now)}
              </span>
            )}
          </div>

          <h4 className="mt-1 text-sm font-medium leading-snug text-ink">{approval.title}</h4>

          <div className="mt-1.5 flex items-center gap-1.5">
            {agent && <Avatar name={agent.name} accent={agent.accent} size="xs" />}
            <span className="text-[11px] text-ink-faint">
              {agent?.role ?? approval.requestedBy}
            </span>
            <span className="text-[10px] text-ink-ghost">
              · {formatRelative(approval.requestedAt, now)}
            </span>
          </div>

          <p className="mt-2 text-xs leading-relaxed text-ink-muted">{approval.summary}</p>

          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-warn/20 bg-warn/[0.05] px-2.5 py-2">
                  <AlertTriangle
                    className="mt-0.5 h-3 w-3 shrink-0 text-warn"
                    strokeWidth={1.75}
                  />
                  <p className="text-[11px] leading-relaxed text-warn/90">{approval.impact}</p>
                </div>

                {approval.payload && (
                  <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {approval.payload.map((p) => (
                      <div key={p.label} className="min-w-0">
                        <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-ghost">
                          {p.label}
                        </dt>
                        <dd className="truncate text-[11px] text-ink-muted">{p.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Button variant="success" size="xs" onClick={() => onDecide("approved")}>
              <Check className="h-3 w-3" strokeWidth={2.25} />
              Approve
            </Button>
            <Button variant="danger" size="xs" onClick={() => onDecide("rejected")}>
              <X className="h-3 w-3" strokeWidth={2.25} />
              Reject
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setExpanded((v) => !v);
                if (!reviewing) onDecide("reviewing");
              }}
            >
              <Eye className="h-3 w-3" strokeWidth={1.75} />
              {expanded ? "Hide" : "Review"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
