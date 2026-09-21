"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { CornerDownLeft, Terminal } from "lucide-react";
import { useCompany } from "@/lib/store";
import { COMMAND_SUGGESTIONS } from "@/lib/engine/chat";
import { planAgentCount } from "@/lib/engine/orchestrator";
import { formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Button, Chip, LiveDot, Panel, PanelHeader } from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/page-header";
import { PlanGraph } from "@/components/command/plan-graph";
import { CollaborationFlows } from "@/components/company/collaboration";
import { CeoInbox } from "@/components/company/ceo-inbox";
import { ApprovalQueue } from "@/components/company/ceo-action";
import { AgentRuns } from "@/components/company/agent-runs";

export default function CommandPage() {
  const plans = useCompany((s) => s.plans);
  const runCommand = useCompany((s) => s.runCommand);
  const approvals = useCompany((s) => s.approvals);

  const [value, setValue] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const activePlan = plans.find((p) => p.id === selected) ?? plans[0];
  const pending = approvals.filter((a) => a.status === "pending" || a.status === "reviewing").length;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    const plan = runCommand(trimmed);
    setSelected(plan.id);
    setValue("");
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <div className="flex items-center gap-2">
            <LiveDot />
            <span className="font-mono text-3xs uppercase tracking-[0.18em] text-live">
              Command Center
            </span>
          </div>
        }
        title="一言で、会社を動かす。"
        description="指示はCOOが受け取り、目的と成功条件を定義し、担当部署のAI社員へ分配します。結果は1つの報告として戻ります。"
      />

      {/* Command input */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative overflow-hidden rounded-2xl border border-hairline bg-surface/70 shadow-panel"
      >
        <div
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[560px] -translate-x-1/2 rounded-full bg-accent/10 blur-[90px]"
          aria-hidden
        />
        <form onSubmit={submit} className="relative px-5 py-6 lg:px-8 lg:py-8">
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-accent-soft" strokeWidth={1.75} />
            <span className="label text-accent-soft">Instruct your company</span>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <span className="num shrink-0 text-lg text-accent-soft">›</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="今月の売上を伸ばすための施策を考えて"
              aria-label="Command input"
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-lg font-medium tracking-tight text-ink placeholder:text-ink-ghost focus:outline-none lg:text-xl"
            />
            <Button type="submit" variant="primary" size="md" disabled={!value.trim()}>
              Run
              <CornerDownLeft className="h-3.5 w-3.5" strokeWidth={2} />
            </Button>
          </div>

          <div className="mt-5 flex flex-wrap gap-1.5">
            {COMMAND_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setValue(s)}
                className="rounded-lg border border-hairline bg-white/[0.02] px-2.5 py-1.5 text-2xs text-ink-faint transition-colors hover:border-accent-line hover:bg-accent/[0.06] hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
        </form>
      </motion.div>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {activePlan ? (
            <Panel className="overflow-hidden">
              <PanelHeader
                title="Task Graph"
                hint={`${planAgentCount(activePlan)} AI employees · ~${activePlan.estimatedMinutes}m`}
                action={
                  activePlan.needsApproval ? (
                    <Chip className="bg-warn/12 text-warn">Approval required</Chip>
                  ) : (
                    <Chip className="bg-live/12 text-live">Auto-executable</Chip>
                  )
                }
              />
              <PlanGraph plan={activePlan} />
            </Panel>
          ) : (
            <Panel className="px-5 py-12 text-center">
              <p className="text-sm text-ink-muted">まだ指示がありません</p>
              <p className="mt-1.5 text-xs text-ink-ghost">
                上の入力欄に指示を書くと、COOがタスクを分解し、担当AI社員へ割り当てます。
              </p>
            </Panel>
          )}

          <AgentRuns limit={6} />

          <Panel className="overflow-hidden">
            <PanelHeader title="AI Collaboration" live hint="実行中の仕事の流れ" />
            <CollaborationFlows limit={4} />
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel className="overflow-hidden">
            <PanelHeader
              title="Approval Queue"
              hint="今、あなたが判断しないと進まないもの"
            />
            <ApprovalQueue limit={10} />
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader
              title="CEO Inbox"
              hint={pending > 0 ? `${pending} awaiting decision` : "all clear"}
            />
            <CeoInbox compact />
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader title="Command History" hint={`${plans.length}`} />
            {plans.length === 0 ? (
              <p className="px-5 py-10 text-center text-xs text-ink-ghost">
                実行した指示がここに残ります
              </p>
            ) : (
              <ul className="divide-y divide-hairline">
                {plans.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => setSelected(p.id)}
                      className={cn(
                        "w-full px-5 py-3 text-left transition-colors hover:bg-white/[0.025]",
                        activePlan?.id === p.id && "bg-accent/[0.06]",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12px] font-medium text-ink">{p.input}</span>
                        {p.needsApproval && (
                          <Chip className="ml-auto shrink-0 bg-warn/12 text-warn">Gate</Chip>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {p.departments.map((d) => (
                          <Chip key={d}>{d}</Chip>
                        ))}
                        <span className="num ml-auto text-3xs text-ink-ghost">
                          {formatTime(Number(p.id.split("-")[1]) || Date.now())}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
