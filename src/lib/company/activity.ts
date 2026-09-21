import type { ActivityEvent, ActivityKind } from "@/lib/types";
import { ago, minutes } from "@/lib/time";

type Row = [minsAgo: number, kind: ActivityKind, agent: string, message: string, detail?: string, target?: string];

const ROWS: Row[] = [
  [0, "agent.thinking", "coo", "Q4リソース配分を再計算しています", "Development backlog +32% を検知"],
  [1, "agent.tool_called", "market_ai", "一次統計データベースへ接続", "tool: web_research"],
  [2, "agent.started", "cto", "タスクを開始", "Dashboard authentication"],
  [3, "insight.found", "research_director", "関連する市場レポートを12件発見", "うち一次情報は7件", undefined],
  [5, "agent.completed", "cmo", "Instagram トレンド分析を完了", "トレンド候補12件を抽出"],
  [6, "agent.handoff", "coo", "Sales AI へタスクを割り当て", "提携候補のスコアリング", "cso"],
  [8, "approval.requested", "social_ai", "Instagram 投稿3案の公開承認を申請", "CEO承認が必要"],
  [9, "agent.completed", "creative_director", "ホームページデザインを提出", "Command Center ビジュアル方針"],
  [11, "task.completed", "lead_ai", "新規企業リストを20件追加", "美容D2C / 条件合致"],
  [13, "agent.tool_called", "frontend_ai", "コードを実行", "tool: code_execution"],
  [14, "agent.handoff", "cmo", "Creative Director へ制作を依頼", "投稿クリエイティブ3案", "creative_director"],
  [16, "task.created", "chief_of_staff", "リマインドタスクを作成", "大学出願書類 — 残り21日"],
  [18, "agent.completed", "trend_ai", "Z世代のコスメ消費行動分析を完了", "情報接触点の変化を5点で整理"],
  [20, "approval.requested", "infra_ai", "本番環境への Deploy 承認を申請", "認証基盤を含むビルド"],
  [22, "agent.started", "seo_ai", "調査を開始", "競合キーワードギャップ"],
  [25, "agent.completed", "insight_ai", "週次KPIの異常値抽出を完了", "外れ値 3 指標"],
  [27, "agent.handoff", "research_director", "Marketing AI へ調査結果を引き渡し", "市場レポート12件の要約", "cmo"],
  [29, "agent.tool_called", "news_ai", "ニュースソースを巡回", "tool: browser"],
  [32, "task.assigned", "coo", "Finance AI へ収益シミュレーションを依頼", "3シナリオ試算", "cfo"],
  [35, "agent.completed", "accounting_ai", "9月分の取引分類を完了", "未分類 0 件"],
  [38, "insight.found", "competitor_ai", "競合A社の新規施策を検知", "求人情報から新規事業の兆候"],
  [41, "agent.started", "designer_ai", "制作を開始", "ランディングページ ビジュアル"],
  [44, "report.generated", "chief_of_staff", "Morning Briefing を生成", "本日 08:00"],
  [47, "agent.completed", "qa_ai", "E2Eテストを完了", "12 / 12 passed"],
  [52, "agent.handoff", "cso", "Proposal AI へ資料作成を依頼", "NEXY Summit 提案書", "proposal_ai"],
  [58, "task.completed", "research_director", "市場レポート12件の要約を完了", "比較表として保存"],
  [64, "agent.tool_called", "grant_ai", "支援制度データベースを照会", "tool: web_research"],
  [71, "agent.completed", "brand_ai", "ブランド定義の差分をまとめ", "使用禁止表現を3件追加"],
  [80, "task.created", "coo", "新規タスクを作成", "Q4リソース配分プラン"],
  [92, "agent.completed", "minutes_ai", "前回Board Meetingの議事録を整形", "決定事項 6 件"],
];

export const SEED_ACTIVITY: ActivityEvent[] = ROWS.map((row, i) => {
  const [minsAgo, kind, agentId, message, detail, targetAgentId] = row;
  return {
    id: `seed-act-${i}`,
    kind,
    agentId,
    at: ago(minutes(minsAgo)),
    message,
    detail,
    targetAgentId,
    severity:
      kind === "approval.requested"
        ? "important"
        : kind === "insight.found"
          ? "important"
          : "normal",
  } satisfies ActivityEvent;
});
