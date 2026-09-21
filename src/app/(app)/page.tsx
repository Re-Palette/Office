"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { useCompany } from "@/lib/store";
import { greeting } from "@/lib/time";
import { CEO } from "@/lib/auth";
import { isActiveStatus } from "@/lib/status";
import { KpiStrip } from "@/components/home/kpi-strip";
import { LiveWorkforce } from "@/components/home/live-workforce";
import { TodayPerformance } from "@/components/home/today-performance";
import { ScheduleStrip } from "@/components/home/schedule-strip";
import { CollaborationFlows } from "@/components/company/collaboration";
import { Recommendations } from "@/components/company/recommendations";
import { CeoInbox } from "@/components/company/ceo-inbox";
import { ProjectList } from "@/components/company/project-list";
import { ActivityFeed } from "@/components/company/activity-feed";
import { LiveDot, Panel, PanelHeader } from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/page-header";

export default function HomePage() {
  const router = useRouter();
  const now = useCompany((s) => s.now);
  const agents = useCompany((s) => s.agents);
  const activity = useCompany((s) => s.activity);
  const approvals = useCompany((s) => s.approvals);
  const sendChat = useCompany((s) => s.sendChat);

  const active = agents.filter((a) => isActiveStatus(a.status)).length;
  const pending = approvals.filter((a) => a.status === "pending" || a.status === "reviewing").length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-1.5 rounded-md bg-live/10 px-2 py-0.5">
              <LiveDot />
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-live">
                Live
              </span>
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
              AI Company Operational Status
            </span>
            <span className="num text-[10px] text-ink-ghost">
              {active} employees working right now
            </span>
          </div>
        }
        title={
          <>
            <span className="text-ink-faint">{greeting(now)},</span> {CEO.name}.
          </>
        }
        description="Company Command Center — 会社の全体像、AI社員の稼働、そしてあなたの判断が必要な事項。"
      />

      <KpiStrip />

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <LiveWorkforce />

          <Panel className="overflow-hidden">
            <PanelHeader
              title="AI Collaboration"
              live
              hint="AI社員間で仕事が流れています"
              action={
                <Link
                  href="/command"
                  className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-ghost transition-colors hover:text-accent-soft"
                >
                  Command
                  <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
                </Link>
              }
            />
            <CollaborationFlows limit={3} />
          </Panel>

          <TodayPerformance />
        </div>

        <div className="space-y-5">
          <Panel className="overflow-hidden">
            <PanelHeader
              title="CEO Inbox"
              hint={pending > 0 ? `${pending} awaiting decision` : "all clear"}
              action={
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-warn">
                  Human approval gate
                </span>
              }
            />
            <CeoInbox compact />
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader title="AI Recommendations" hint="CEOへの提案" />
            <Recommendations
              onAsk={(headline) => {
                sendChat(`この提案の根拠をもう少し詳しく: ${headline}`);
              }}
            />
          </Panel>

          <ScheduleStrip />

          <Panel className="overflow-hidden">
            <PanelHeader
              title="Projects"
              hint="進行中"
              action={
                <Link
                  href="/projects"
                  className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-ghost transition-colors hover:text-accent-soft"
                >
                  All
                </Link>
              }
            />
            <ProjectList limit={4} dense />
          </Panel>

          <Panel className="overflow-hidden 2xl:hidden">
            <PanelHeader
              title="Live Activity"
              live
              action={
                <button
                  onClick={() => router.push("/activity")}
                  className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-ghost transition-colors hover:text-accent-soft"
                >
                  All
                </button>
              }
            />
            <ActivityFeed events={activity} limit={12} dense />
          </Panel>
        </div>
      </div>
    </div>
  );
}
