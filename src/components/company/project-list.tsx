"use client";

import Link from "next/link";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { PROJECTS } from "@/lib/company/projects";
import { useCompany } from "@/lib/store";
import { formatCountdown } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/types";
import { Avatar, Chip, Progress } from "@/components/ui/primitives";

const HEALTH = {
  on_track: { label: "ON TRACK", chip: "bg-live/10 text-live", tone: "live" as const },
  at_risk: { label: "AT RISK", chip: "bg-warn/10 text-warn", tone: "warn" as const },
  blocked: { label: "BLOCKED", chip: "bg-danger/10 text-danger", tone: "danger" as const },
};

export function ProjectList({
  projects = PROJECTS,
  limit,
  dense = false,
}: {
  projects?: Project[];
  limit?: number;
  dense?: boolean;
}) {
  const now = useCompany((s) => s.now);
  const shown = limit ? projects.slice(0, limit) : projects;

  return (
    <ul className="divide-y divide-hairline">
      {shown.map((project) => {
        const health = HEALTH[project.health];
        const team = project.agents.slice(0, 5);

        return (
          <li key={project.id}>
            <Link
              href={`/projects/${project.id}`}
              className={cn(
                "group flex items-center gap-4 px-5 transition-colors hover:bg-white/[0.025]",
                dense ? "py-3" : "py-3.5",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-ink">{project.name}</span>
                  <Chip className={health.chip}>{health.label}</Chip>
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-ghost">
                    {project.codename}
                  </span>
                </div>

                {!dense && (
                  <p className="mt-1 truncate text-[11px] text-ink-faint">{project.summary}</p>
                )}

                <div className="mt-2 flex items-center gap-3">
                  <Progress
                    value={project.progress}
                    tone={health.tone}
                    className="max-w-[220px] flex-1"
                  />
                  <span className="num shrink-0 text-[11px] font-medium text-ink-muted">
                    {project.progress}%
                  </span>
                </div>
              </div>

              <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
                <div className="flex -space-x-1.5">
                  {team.map((id) => {
                    const agent = AGENTS_BY_ID[id];
                    if (!agent) return null;
                    return (
                      <Avatar
                        key={id}
                        name={agent.name}
                        accent={agent.accent}
                        size="xs"
                        className="ring-2 ring-surface"
                      />
                    );
                  })}
                  {project.agents.length > 5 && (
                    <span className="num flex h-5 w-5 items-center justify-center rounded-lg bg-white/5 text-[8px] text-ink-faint ring-2 ring-surface">
                      +{project.agents.length - 5}
                    </span>
                  )}
                </div>
                <span className="num text-[10px] text-ink-ghost">
                  {formatCountdown(project.deadline, now)}
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export { HEALTH as PROJECT_HEALTH };
