"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { CornerDownLeft, Search, ShieldAlert } from "lucide-react";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { DEPARTMENTS } from "@/lib/company/departments";
import { PROJECTS_BY_ID } from "@/lib/company/projects";
import { TASK_TOTALS } from "@/lib/company/tasks";
import { useCompany } from "@/lib/store";
import { PRIORITY_META, TASK_STATUS } from "@/lib/status";
import { formatRelative } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Task, TaskStatus } from "@/lib/types";
import {
  Avatar,
  Button,
  Chip,
  FilterTabs,
  Panel,
  PanelHeader,
  Progress,
} from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/page-header";

const COLUMNS: TaskStatus[] = [
  "PLANNING",
  "RUNNING",
  "WAITING_FOR_CEO",
  "WAITING",
  "REVIEW",
  "COMPLETED",
];

type Scope = "all" | "open" | "blocked" | (typeof DEPARTMENTS)[number]["id"];

export default function TasksPage() {
  const router = useRouter();
  const tasks = useCompany((s) => s.tasks);
  const runCommand = useCompany((s) => s.runCommand);

  const [scope, setScope] = useState<Scope>("all");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks
      .filter((t) => {
        if (scope === "all") return true;
        if (scope === "open") return t.status !== "COMPLETED" && t.status !== "FAILED";
        if (scope === "blocked")
          return (
            t.status === "WAITING" || t.status === "WAITING_FOR_CEO" || t.status === "REVIEW"
          );
        return t.department === scope;
      })
      .filter((t) =>
        q ? `${t.title} ${t.description}`.toLowerCase().includes(q) : true,
      );
  }, [tasks, scope, query]);

  const byStatus = COLUMNS.map((status) => ({
    status,
    items: filtered.filter((t) => t.status === status),
  }));

  function delegate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    runCommand(trimmed);
    setDraft("");
    router.push("/command");
  }

  const open = tasks.filter((t) => t.status !== "COMPLETED" && t.status !== "FAILED").length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<span className="label">Task Engine</span>}
        title="Tasks"
        description={`本日 ${TASK_TOTALS.today} 件のタスク。${open} 件が進行中です。AI社員への依頼はCOOが分解して割り当てます。`}
        actions={
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-ghost"
              strokeWidth={1.75}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="タスクを検索"
              aria-label="Search tasks"
              className="h-9 w-[220px] rounded-lg border border-hairline bg-white/[0.03] pl-9 pr-3 text-xs text-ink placeholder:text-ink-ghost focus:border-accent-line focus:outline-none"
            />
          </div>
        }
      />

      {/* Delegation composer */}
      <Panel className="overflow-hidden">
        <PanelHeader title="Delegate to your AI company" hint="COOがタスクを分解します" />
        <form onSubmit={delegate} className="flex items-center gap-3 px-5 py-4">
          <span className="num shrink-0 text-accent-soft">›</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Re-Paletteの企業提携候補を調査して"
            aria-label="Delegate a task"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-ghost focus:outline-none"
          />
          <Button type="submit" variant="primary" size="sm" disabled={!draft.trim()}>
            Assign
            <CornerDownLeft className="h-3 w-3" strokeWidth={2} />
          </Button>
        </form>
      </Panel>

      <Panel className="px-4 py-2.5">
        <FilterTabs<Scope>
          value={scope}
          onChange={setScope}
          options={[
            { id: "all", label: "All", count: tasks.length },
            { id: "open", label: "Open", count: open },
            {
              id: "blocked",
              label: "Needs attention",
              count: tasks.filter(
                (t) =>
                  t.status === "WAITING" ||
                  t.status === "WAITING_FOR_CEO" ||
                  t.status === "REVIEW",
              ).length,
            },
            ...DEPARTMENTS.map((d) => ({
              id: d.id as Scope,
              label: d.name,
              count: tasks.filter((t) => t.department === d.id).length,
            })),
          ]}
        />
      </Panel>

      {/* Board */}
      <div className="grid gap-4 lg:grid-cols-3 2xl:grid-cols-6">
        {byStatus.map((column) => (
          <div key={column.status} className="flex min-w-0 flex-col">
            <div className="mb-2.5 flex items-center gap-2 px-1">
              <Chip className={TASK_STATUS[column.status].chip}>
                {TASK_STATUS[column.status].label}
              </Chip>
              <span className="num text-[10px] text-ink-ghost">{column.items.length}</span>
            </div>

            <div className="space-y-2.5">
              {column.items.map((task, i) => (
                <TaskCard key={task.id} task={task} index={i} />
              ))}
              {column.items.length === 0 && (
                <div className="rounded-xl border border-dashed border-hairline px-3 py-6 text-center">
                  <span className="text-[10px] text-ink-ghost">なし</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskCard({ task, index }: { task: Task; index: number }) {
  const router = useRouter();
  const now = useCompany((s) => s.now);
  const agent = AGENTS_BY_ID[task.assignedAgent];
  const project = task.project ? PROJECTS_BY_ID[task.project] : undefined;

  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.02, 0.2) }}
      className={cn(
        "rounded-xl border border-hairline bg-surface/70 p-3.5 transition-colors hover:border-hairline-strong hover:bg-surface-hover/40",
        task.priority === "critical" && "border-danger/25",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip className={PRIORITY_META[task.priority].chip}>
          {PRIORITY_META[task.priority].label}
        </Chip>
        {project && <Chip>{project.name}</Chip>}
      </div>

      <h4 className="mt-2 text-[12px] font-medium leading-snug text-ink">{task.title}</h4>
      <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-ink-faint">
        {task.description}
      </p>

      {task.status === "WAITING_FOR_CEO" && (
        <div className="mt-2 rounded-lg border border-warn/25 bg-warn/[0.06] px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="h-3 w-3 shrink-0 text-warn" strokeWidth={1.75} />
            <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-warn">
              Waiting for CEO
            </span>
          </div>
          {task.blockedReason && (
            <p className="mt-1 text-[10px] leading-relaxed text-warn/90">{task.blockedReason}</p>
          )}
          <button
            onClick={() => router.push("/command")}
            className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-warn transition-opacity hover:opacity-80"
          >
            Review task →
          </button>
        </div>
      )}

      {task.status !== "COMPLETED" && (
        <div className="mt-2.5 flex items-center gap-2">
          <Progress value={task.progress} className="flex-1" />
          <span className="num text-[10px] text-ink-ghost">{task.progress}%</span>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-2.5">
        {agent && (
          <Link href={`/employees/${agent.id}`} className="flex min-w-0 items-center gap-1.5">
            <Avatar name={agent.name} accent={agent.accent} size="xs" status={agent.status} />
            <span className="truncate text-[10px] text-ink-faint transition-colors hover:text-accent-soft">
              {agent.role}
            </span>
          </Link>
        )}
        <span className="num ml-auto shrink-0 text-[10px] text-ink-ghost">
          {formatRelative(task.updatedAt, now)}
        </span>
      </div>
    </motion.article>
  );
}
