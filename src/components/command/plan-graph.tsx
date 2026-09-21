"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowDown, Crown, Sparkles } from "lucide-react";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { DEPARTMENTS, DEPARTMENT_ACCENT } from "@/lib/company/departments";
import type { CommandPlan, PlanStep } from "@/lib/engine/orchestrator";
import { cn } from "@/lib/utils";
import { Avatar, Chip } from "@/components/ui/primitives";
import { DepartmentTag } from "@/components/company/department-tag";

/**
 * Renders a plan as the chain the company actually follows:
 * CEO → COO decomposition → departments in parallel → COO integration → CEO.
 */
export function PlanGraph({ plan }: { plan: CommandPlan }) {
  const decompose = plan.steps[0];
  const integrate = plan.steps[plan.steps.length - 1];
  const middle = plan.steps.slice(1, -1);

  const byDepartment = plan.departments.map((dept) => ({
    dept,
    steps: middle.filter((s) => s.department === dept),
  }));

  return (
    <div className="px-5 py-5">
      <Node
        delay={0}
        accent="#6C7CFF"
        title="CEO"
        subtitle="陽大"
        badge="ORIGIN"
        icon={<Crown className="h-3.5 w-3.5" strokeWidth={1.75} />}
        body={plan.input}
      />

      <Connector delay={0.1} />

      <StepNode step={decompose} delay={0.18} badge="DECOMPOSE" />

      <div className="mt-3 rounded-xl border border-hairline bg-white/[0.02] px-4 py-3">
        <span className="label">Objective</span>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">{plan.objective}</p>
        <span className="label mt-3 block">Success criteria</span>
        <ul className="mt-1 space-y-1">
          {plan.successCriteria.map((c) => (
            <li key={c} className="flex items-start gap-2 text-2xs leading-relaxed text-ink-muted">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
              {c}
            </li>
          ))}
        </ul>
      </div>

      <Connector delay={0.26} label={`${byDepartment.length} ${byDepartment.length === 1 ? "department" : "departments in parallel"}`} />

      <div
        className={cn(
          "grid gap-3",
          byDepartment.length === 1
            ? "grid-cols-1"
            : byDepartment.length === 2
              ? "sm:grid-cols-2"
              : byDepartment.length === 3
                ? "sm:grid-cols-2 lg:grid-cols-3"
                : "sm:grid-cols-2 xl:grid-cols-4",
        )}
      >
        {byDepartment.map((group, gi) => {
          const meta = DEPARTMENTS.find((d) => d.id === group.dept);
          const accent = DEPARTMENT_ACCENT[group.dept];

          return (
            <motion.div
              key={group.dept}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.32 + gi * 0.08 }}
              className="overflow-hidden rounded-xl border border-hairline bg-surface/60"
            >
              <div
                className="flex items-center gap-2 border-b border-hairline px-3 py-2"
                style={{ background: `${accent}14` }}
              >
                <DepartmentTag department={group.dept} />
              </div>

              <ul className="divide-y divide-hairline">
                {group.steps.map((step, si) => {
                  const agent = AGENTS_BY_ID[step.agentId];
                  return (
                    <motion.li
                      key={step.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.42 + gi * 0.08 + si * 0.06 }}
                      className="px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2">
                        {agent && <Avatar name={agent.name} accent={agent.accent} size="xs" />}
                        <Link
                          href={agent ? `/employees/${agent.id}` : "#"}
                          className="truncate text-2xs font-medium text-ink transition-colors hover:text-accent-soft"
                        >
                          {agent?.role ?? step.agentId}
                        </Link>
                        <span className="num ml-auto shrink-0 text-3xs text-ink-ghost">
                          ~{step.etaMinutes}m
                        </span>
                      </div>
                      <p className="mt-1 text-2xs leading-snug text-ink-muted">{step.action}</p>
                      {step.detail && (
                        <p className="mt-0.5 line-clamp-2 text-3xs leading-snug text-ink-ghost">
                          {step.detail}
                        </p>
                      )}
                    </motion.li>
                  );
                })}
              </ul>
            </motion.div>
          );
        })}
      </div>

      <Connector delay={0.55} />

      <StepNode step={integrate} delay={0.6} badge="INTEGRATE" />

      <Connector delay={0.68} />

      <Node
        delay={0.74}
        accent="#6C7CFF"
        title="CEO"
        subtitle="最終意思決定"
        badge="REPORT"
        icon={<Crown className="h-3.5 w-3.5" strokeWidth={1.75} />}
        body={
          plan.needsApproval
            ? "外部への実行を伴うため、実行前に承認を要求します。"
            : "統合された1つの報告としてCEOへ提出されます。"
        }
        warn={plan.needsApproval}
      />
    </div>
  );
}

function StepNode({ step, delay, badge }: { step: PlanStep; delay: number; badge: string }) {
  const agent = AGENTS_BY_ID[step.agentId];
  return (
    <Node
      delay={delay}
      accent={agent?.accent ?? "#6C7CFF"}
      title={agent?.role ?? step.agentId}
      subtitle={agent?.name ?? ""}
      badge={badge}
      href={agent ? `/employees/${agent.id}` : undefined}
      icon={<Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />}
      body={step.detail}
    />
  );
}

function Node({
  delay,
  accent,
  title,
  subtitle,
  badge,
  body,
  icon,
  href,
  warn,
}: {
  delay: number;
  accent: string;
  title: string;
  subtitle: string;
  badge: string;
  body: string;
  icon: React.ReactNode;
  href?: string;
  warn?: boolean;
}) {
  const content = (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors",
        warn ? "border-warn/25 bg-warn/[0.05]" : "border-hairline bg-surface/70",
        href && "hover:border-accent-line hover:bg-accent/[0.05]",
      )}
    >
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `${accent}1F`, color: accent }}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-ink">{title}</span>
          {subtitle && (
            <span className="font-mono text-3xs uppercase tracking-[0.16em] text-ink-ghost">
              {subtitle}
            </span>
          )}
          <Chip className={cn("ml-auto", warn ? "bg-warn/12 text-warn" : "")}>{badge}</Chip>
        </div>
        <p className={cn("mt-1 text-2xs leading-relaxed", warn ? "text-warn/90" : "text-ink-muted")}>
          {body}
        </p>
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
    >
      {href ? <Link href={href}>{content}</Link> : content}
    </motion.div>
  );
}

function Connector({ delay, label }: { delay: number; label?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay }}
      className="flex items-center justify-center gap-2 py-2"
    >
      <span className="h-5 w-px bg-gradient-to-b from-transparent via-accent/40 to-transparent" />
      <ArrowDown className="h-3 w-3 text-accent/60" strokeWidth={2} />
      {label && (
        <span className="font-mono text-3xs uppercase tracking-[0.16em] text-ink-ghost">
          {label}
        </span>
      )}
    </motion.div>
  );
}
