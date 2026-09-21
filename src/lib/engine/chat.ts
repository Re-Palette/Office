import { AGENTS, AGENTS_BY_ID, DEPARTMENT_HEADS } from "@/lib/company/agents";
import { DEPARTMENTS } from "@/lib/company/departments";
import { PROJECTS } from "@/lib/company/projects";
import type { Agent, Approval, DepartmentId, Task } from "@/lib/types";

export interface ChatSnapshot {
  agents: Agent[];
  tasks: Task[];
  approvals: Approval[];
}

export interface ChatReply {
  agentId: string;
  text: string;
  routing: { agentId: string; note: string }[];
}

const ACTIVE_STATES = new Set([
  "working", "thinking", "researching", "coding", "writing", "designing",
]);

function activeAgents(agents: Agent[]) {
  return agents.filter((a) => ACTIVE_STATES.has(a.status));
}

function deptOf(input: string): DepartmentId | undefined {
  const map: Record<string, DepartmentId> = {
    営業: "sales", セールス: "sales",
    マーケ: "marketing", マーケティング: "marketing",
    開発: "engineering", エンジニア: "engineering", 技術: "engineering",
    財務: "finance", 経理: "finance", 会計: "finance",
    リサーチ: "research", 調査: "research",
    クリエイティブ: "creative", デザイン: "creative",
    戦略: "strategy",
    運用: "operations", 秘書: "operations",
  };
  const hit = Object.keys(map).find((k) => input.includes(k));
  return hit ? map[hit] : undefined;
}

/**
 * CEO → COO → departments → employees.
 * The COO answers unless the question clearly belongs to one department head.
 */
export function replyToCeo(input: string, snap: ChatSnapshot): ChatReply {
  const q = input.trim();
  const lower = q.toLowerCase();
  const active = activeAgents(snap.agents);
  const completed = snap.tasks.filter((t) => t.status === "COMPLETED").length;
  const running = snap.tasks.filter((t) => t.status === "RUNNING" || t.status === "PLANNING").length;
  const waiting = snap.tasks.filter((t) => t.status === "WAITING" || t.status === "REVIEW").length;
  const pending = snap.approvals.filter((a) => a.status === "pending");

  // ── 今日の成果 ────────────────────────────────────────────────────────────
  if (/成果|今日|進捗|状況を教え|どうなってる|summary/.test(lower)) {
    const dept = deptOf(q);
    if (dept) return departmentStatus(dept, snap);

    return {
      agentId: "coo",
      text: [
        `現在 ${active.length} 名のAI社員が稼働中です。`,
        `本日のタスクは完了 ${completed} 件 / 進行中 ${running} 件 / 待機 ${waiting} 件。`,
        `特筆すべき成果は3点です。`,
        `1. Marketing が Instagram トレンド分析を完了し、候補を12件抽出。`,
        `2. Engineering が認証基盤を実装し、E2Eを全件通過。`,
        `3. Sales が提携候補18社を評価し、高適合6社を特定。`,
        pending.length > 0
          ? `\nCEOの判断が必要なのは ${pending.length} 件です。最優先は「${pending[0].title}」。`
          : `\n現在、CEO承認待ちの案件はありません。`,
      ].join("\n"),
      routing: [
        { agentId: "coo", note: "全部署へ状況を照会" },
        { agentId: "insight_ai", note: "KPIから特筆事項を抽出" },
        { agentId: "chief_of_staff", note: "判断事項を優先度順に整列" },
      ],
    };
  }

  // ── 一番重要な問題 ────────────────────────────────────────────────────────
  if (/問題|リスク|課題|ブロック|遅れ/.test(lower)) {
    return {
      agentId: "coo",
      text: [
        `最も重要な問題は NEWTONE 2027 の出展者募集が計画比 -28% であることです。`,
        `会場費の承認期限が迫っており、来場目標800名に対して現在の導線では届きません。`,
        `次点は、大学出願書類の活動実績整理が未着手であること（残り5日）。`,
        `\n推奨: NEWTONE の集客導線を Creative と再設計し、出展者募集を今週中に再開すること。`,
      ].join("\n"),
      routing: [
        { agentId: "coo", note: "全プロジェクトの健全性を評価" },
        { agentId: "risk_ai", note: "リスクを影響度順に整列" },
        { agentId: "biz_dev", note: "NEWTONE の計画差分を算出" },
      ],
    };
  }

  // ── 部署の状況 ────────────────────────────────────────────────────────────
  const dept = deptOf(q);
  if (dept) return departmentStatus(dept, snap);

  // ── プロジェクト ──────────────────────────────────────────────────────────
  const project = PROJECTS.find((p) => q.includes(p.name) || lower.includes(p.id));
  if (project) {
    return {
      agentId: DEPARTMENT_HEADS[project.departments[0]] ?? "coo",
      text: [
        `${project.name} は進捗 ${project.progress}%、ステータスは ${project.health === "on_track" ? "順調" : project.health === "at_risk" ? "要注意" : "停滞"} です。`,
        `担当は ${project.agents.length} 名、関与部署は ${project.departments.length} です。`,
        `未完了のマイルストーンは ${project.milestones.filter((m) => !m.done).length} 件。次は「${project.milestones.find((m) => !m.done)?.label ?? "—"}」です。`,
        `\n進めてよろしければ、担当へ即時に着手を指示します。`,
      ].join("\n"),
      routing: [
        { agentId: "coo", note: `${project.name} の担当へ照会` },
        { agentId: project.owner, note: "進捗とブロッカーを報告" },
      ],
    };
  }

  // ── 指示（〜して / 〜を進めて） ───────────────────────────────────────────
  if (/して|進めて|やって|作って|考えて|調べて/.test(q)) {
    return {
      agentId: "coo",
      text: [
        `承知しました。指示を分解し、担当へ割り当てます。`,
        `完了次第、統合した結果を1つの報告としてCEOへ提出します。`,
        `外部への送信・公開を伴う場合は、実行前に必ず承認を求めます。`,
        `\nCommand Center で分解の過程を確認できます。`,
      ].join("\n"),
      routing: [
        { agentId: "coo", note: "タスクを分解し担当を決定" },
        { agentId: "chief_of_staff", note: "期日と記録を設定" },
      ],
    };
  }

  // ── 既定 ──────────────────────────────────────────────────────────────────
  return {
    agentId: "coo",
    text: [
      `ご質問を受け取りました。関係する部署へ照会します。`,
      `現在の稼働は ${active.length} 名、進行中タスクは ${running} 件です。`,
      `より具体的に指示いただければ、該当部署へ直接タスクとして展開します。`,
    ].join("\n"),
    routing: [{ agentId: "coo", note: "関係部署を特定中" }],
  };
}

function departmentStatus(dept: DepartmentId, snap: ChatSnapshot): ChatReply {
  const meta = DEPARTMENTS.find((d) => d.id === dept)!;
  const head = DEPARTMENT_HEADS[dept];
  const members = snap.agents.filter((a) => a.department === dept);
  const activeMembers = activeAgents(members);
  const tasks = snap.tasks.filter((t) => t.department === dept);
  const done = tasks.filter((t) => t.status === "COMPLETED").length;
  const open = tasks.filter((t) => t.status !== "COMPLETED" && t.status !== "FAILED");

  return {
    agentId: head,
    text: [
      `${meta.name} は ${members.length} 名中 ${activeMembers.length} 名が稼働中です。`,
      `本日のタスクは完了 ${done} 件 / 進行中 ${open.length} 件。`,
      open.length > 0
        ? `現在の最優先は「${open[0].title}」（${AGENTS_BY_ID[open[0].assignedAgent]?.role ?? open[0].assignedAgent} が担当）。`
        : `未完了のタスクはありません。`,
      `\n${meta.mandate}`,
    ].join("\n"),
    routing: [
      { agentId: "coo", note: `${meta.name} へ照会` },
      { agentId: head, note: "部署内の状況を集約" },
      ...(open[0] ? [{ agentId: open[0].assignedAgent, note: "担当タスクの進捗を報告" }] : []),
    ],
  };
}

export const CHAT_SUGGESTIONS = [
  "今日の成果を教えて",
  "今一番重要な問題は？",
  "営業部の状況は？",
  "Re-Palette を進めて",
  "マーケティング部に新しい施策を考えさせて",
];

export const COMMAND_SUGGESTIONS = [
  "今月の売上を伸ばすための施策を考えて",
  "Re-Palette の企業提携候補を調査して",
  "新規事業のアイデアを5つ出して",
  "競合3社の動きをまとめて",
];

export const ALL_AGENT_IDS = AGENTS.map((a) => a.id);
