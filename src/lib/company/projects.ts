import type { Project } from "@/lib/types";
import { ago, ahead, days, SEED_NOW } from "@/lib/time";

export const PROJECTS: Project[] = [
  {
    id: "friday",
    name: "F.R.I.D.A.Y.",
    codename: "AI COMPANY OS",
    summary:
      "AI社員だけで構成された会社を、CEO一人で経営するための統合オペレーティングシステム。",
    status: "active",
    progress: 68,
    health: "on_track",
    owner: "cto",
    agents: ["cto", "frontend_ai", "backend_ai", "infra_ai", "qa_ai", "designer_ai", "data_eng"],
    departments: ["engineering", "creative", "strategy"],
    startedAt: ago(days(96)),
    deadline: ahead(days(34)),
    milestones: [
      { id: "m1", label: "Agent Registry 設計", done: true, due: ago(days(40)) },
      { id: "m2", label: "Command Center UI", done: true, due: ago(days(12)) },
      { id: "m3", label: "認証基盤", done: false, due: ahead(days(6)) },
      { id: "m4", label: "Orchestrator 接続", done: false, due: ahead(days(20)) },
      { id: "m5", label: "Scheduled Reports", done: false, due: ahead(days(31)) },
    ],
  },
  {
    id: "re_palette",
    name: "Re-Palette",
    codename: "BEAUTY / SUSTAINABILITY",
    summary: "美容 × 循環をテーマにしたブランド。今期の最重要プロジェクト。",
    status: "active",
    progress: 75,
    health: "on_track",
    owner: "cmo",
    agents: ["cmo", "creative_director", "content_ai", "social_ai", "designer_ai", "lead_ai", "market_ai"],
    departments: ["marketing", "creative", "sales", "research"],
    startedAt: ago(days(180)),
    deadline: ahead(days(12)),
    milestones: [
      { id: "m1", label: "ブランド定義", done: true, due: ago(days(120)) },
      { id: "m2", label: "SNS基盤構築", done: true, due: ago(days(60)) },
      { id: "m3", label: "認知3倍施策", done: false, due: ahead(days(9)) },
      { id: "m4", label: "提携先3社確定", done: false, due: ahead(days(12)) },
    ],
  },
  {
    id: "newtone",
    name: "NEWTONE 2027",
    codename: "STUDENT COSME POPUP",
    summary: "学生コスメPOPUPの企画・運営。体験設計と集客を並行して進行。",
    status: "active",
    progress: 42,
    health: "at_risk",
    owner: "coo",
    agents: ["coo", "biz_dev", "proposal_ai", "designer_ai", "schedule_ai", "cfo"],
    departments: ["strategy", "creative", "finance", "operations"],
    startedAt: ago(days(52)),
    deadline: ahead(days(48)),
    milestones: [
      { id: "m1", label: "コンセプト確定", done: true, due: ago(days(30)) },
      { id: "m2", label: "会場仮押さえ", done: true, due: ago(days(8)) },
      { id: "m3", label: "出展者募集", done: false, due: ahead(days(14)) },
      { id: "m4", label: "集客施策", done: false, due: ahead(days(40)) },
    ],
  },
  {
    id: "university",
    name: "University",
    codename: "総合型選抜",
    summary: "大学受験・出願書類の作成と進捗管理。期限管理が最優先。",
    status: "active",
    progress: 35,
    health: "at_risk",
    owner: "chief_of_staff",
    agents: ["chief_of_staff", "assistant_ai", "copy_ai", "knowledge_ai"],
    departments: ["operations", "creative"],
    startedAt: ago(days(70)),
    deadline: ahead(days(21)),
    milestones: [
      { id: "m1", label: "志望理由の骨子", done: true, due: ago(days(20)) },
      { id: "m2", label: "活動実績の整理", done: false, due: ahead(days(5)) },
      { id: "m3", label: "出願書類 提出", done: false, due: ahead(days(21)) },
    ],
  },
  {
    id: "new_business",
    name: "New Business",
    codename: "0 → 1",
    summary: "新規事業アイデアの探索と検証。週次で5案を生成し3案に絞る。",
    status: "planning",
    progress: 22,
    health: "on_track",
    owner: "coo",
    agents: ["coo", "strategy_planner", "biz_dev", "market_ai", "trend_ai", "forecast_ai"],
    departments: ["strategy", "research", "finance"],
    startedAt: ago(days(26)),
    deadline: ahead(days(60)),
    milestones: [
      { id: "m1", label: "領域の絞り込み", done: true, due: ago(days(10)) },
      { id: "m2", label: "アイデア5案", done: false, due: ahead(days(3)) },
      { id: "m3", label: "需要検証", done: false, due: ahead(days(28)) },
    ],
  },
  {
    id: "research_lab",
    name: "Research Lab",
    codename: "MARKET INTELLIGENCE",
    summary: "市場・競合・技術の常時監視。全プロジェクトへ判断材料を供給する。",
    status: "active",
    progress: 61,
    health: "on_track",
    owner: "research_director",
    agents: ["research_director", "market_ai", "competitor_ai", "trend_ai", "tech_research", "news_ai"],
    departments: ["research", "operations"],
    startedAt: ago(days(140)),
    deadline: ahead(days(90)),
    milestones: [
      { id: "m1", label: "監視対象の定義", done: true, due: ago(days(110)) },
      { id: "m2", label: "週次レポート自動化", done: true, due: ago(days(30)) },
      { id: "m3", label: "一次情報ソース拡充", done: false, due: ahead(days(25)) },
    ],
  },
];

export const PROJECTS_BY_ID: Record<string, Project> = Object.fromEntries(
  PROJECTS.map((p) => [p.id, p]),
);

export const projectName = (id?: string) =>
  id ? (PROJECTS_BY_ID[id]?.name ?? id) : undefined;

export const SEED_REFERENCE = SEED_NOW;
