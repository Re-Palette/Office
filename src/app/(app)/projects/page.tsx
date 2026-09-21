"use client";

import { useState } from "react";
import { PROJECTS } from "@/lib/company/projects";
import { useCompany } from "@/lib/store";
import { FilterTabs, Panel, PanelHeader } from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectList } from "@/components/company/project-list";

type Filter = "all" | "active" | "planning" | "at_risk";

export default function ProjectsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const tasks = useCompany((s) => s.tasks);

  const filtered = PROJECTS.filter((p) => {
    if (filter === "all") return true;
    if (filter === "at_risk") return p.health !== "on_track";
    return p.status === filter;
  });

  const totalAgents = new Set(PROJECTS.flatMap((p) => p.agents)).size;
  const openTasks = tasks.filter(
    (t) => t.project && t.status !== "COMPLETED" && t.status !== "FAILED",
  ).length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<span className="label">Portfolio</span>}
        title="Projects"
        description={`${PROJECTS.length} プロジェクト・${totalAgents} 名のAI社員が関与・${openTasks} 件のタスクが進行中。`}
      />

      <Panel className="px-4 py-2.5">
        <FilterTabs<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "All", count: PROJECTS.length },
            { id: "active", label: "Active", count: PROJECTS.filter((p) => p.status === "active").length },
            { id: "planning", label: "Planning", count: PROJECTS.filter((p) => p.status === "planning").length },
            { id: "at_risk", label: "Needs attention", count: PROJECTS.filter((p) => p.health !== "on_track").length },
          ]}
        />
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader title="All Projects" hint={`${filtered.length} shown`} />
        <ProjectList projects={filtered} />
      </Panel>
    </div>
  );
}
