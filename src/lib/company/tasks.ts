import type { Task, TaskPriority, TaskStatus, DepartmentId } from "@/lib/types";
import { ago, ahead, days, hours, minutes } from "@/lib/time";

type Row = [
  id: string,
  title: string,
  status: TaskStatus,
  priority: TaskPriority,
  agent: string,
  dept: DepartmentId,
  project: string | undefined,
  createdAgoMin: number,
  progress: number,
  description: string,
];

const ROWS: Row[] = [
  ["t-1001", "Dashboard authentication の実装", "RUNNING", "high", "cto", "engineering", "friday", 92, 64, "Supabase Auth を用いたCEOログインと、セッション保持・権限判定を実装する。"],
  ["t-1002", "Command Center UI の実装", "RUNNING", "high", "frontend_ai", "engineering", "friday", 180, 78, "CEOの自然言語指示を受け取り、タスク分解の過程を可視化する画面を実装する。"],
  ["t-1003", "Agent Orchestrator API 設計", "PLANNING", "high", "backend_ai", "engineering", "friday", 240, 35, "各AI社員の実行・委譲・報告を扱うオーケストレーション層のインターフェースを設計する。"],
  ["t-1004", "本番環境への Deploy", "WAITING_FOR_CEO", "critical", "infra_ai", "engineering", "friday", 40, 95, "認証基盤を含むビルドを本番へ反映する。CEO承認待ち。"],
  ["t-1005", "Dashboard のリグレッション検証", "RUNNING", "normal", "qa_ai", "engineering", "friday", 60, 48, "主要導線のE2Eを再実行し、前回リリースからの劣化を検出する。"],
  ["t-1006", "Activity Event スキーマ整備", "RUNNING", "normal", "data_eng", "engineering", "friday", 300, 55, "全AI社員の行動を単一のイベント表に集約できるスキーマへ統一する。"],

  ["t-2001", "Instagram トレンド分析", "COMPLETED", "high", "cmo", "marketing", "re_palette", 420, 100, "直近30日の投稿反応からトレンド候補を抽出し、施策仮説へ変換する。"],
  ["t-2002", "Re-Palette note記事の執筆", "RUNNING", "normal", "content_ai", "marketing", "re_palette", 110, 42, "ブランドの世界観を伝える長文記事の初稿を作成する。"],
  ["t-2003", "Instagram 投稿3案の作成", "WAITING_FOR_CEO", "high", "social_ai", "marketing", "re_palette", 55, 100, "トレンド分析の結果をもとに投稿案を3つ作成。CEO承認後に公開。"],
  ["t-2004", "競合キーワードギャップ分析", "RUNNING", "normal", "seo_ai", "marketing", "re_palette", 150, 61, "競合が獲得していて自社が取れていない検索語を洗い出す。"],
  ["t-2005", "CAC / LTV の再計算", "RUNNING", "normal", "ads_ai", "marketing", undefined, 200, 70, "チャネル別の獲得単価と生涯価値を最新データで再計算する。"],

  ["t-3001", "提携候補18社のスコアリング", "RUNNING", "high", "cso", "sales", "re_palette", 75, 58, "発見済みの候補を適合度・想定リターン・接触難易度で評価する。"],
  ["t-3002", "美容D2C企業リストの拡充", "COMPLETED", "normal", "lead_ai", "sales", "re_palette", 130, 100, "条件に合致する企業を20件追加し、担当者情報を整理する。"],
  ["t-3003", "提携提案書のドラフト作成", "RUNNING", "normal", "partnership_ai", "sales", "re_palette", 95, 44, "提携スキームと双方の利得を明示した提案書を作る。"],
  ["t-3004", "学生ブランド向け出展案内資料", "RUNNING", "high", "proposal_ai", "sales", "newtone", 160, 52, "出展料・提供物・当日の導線・売上分配を1枚で示す、学生ブランドが親や学校に見せられる案内資料を作る。"],
  ["t-3005", "外部メール3通の送信", "WAITING_FOR_CEO", "high", "outreach_ai", "sales", "re_palette", 30, 100, "初回接触メール。CEO承認後に送信。"],

  ["t-4001", "今月の収支レポート再集計", "RUNNING", "high", "cfo", "finance", undefined, 85, 72, "9月の売上・費用を確定値で再集計し、予実差を説明する。"],
  ["t-4002", "9月分の取引分類", "COMPLETED", "normal", "accounting_ai", "finance", undefined, 210, 100, "取引を勘定科目へ分類し、未分類をゼロにする。"],
  ["t-4003", "売上3シナリオのシミュレーション", "PLANNING", "normal", "forecast_ai", "finance", "new_business", 140, 28, "保守・標準・強気の3シナリオで今後6ヶ月を試算する。"],
  ["t-4004", "SaaS支出の重複検出", "RUNNING", "low", "cost_ai", "finance", undefined, 260, 66, "機能が重複する契約を洗い出し、統合案を作る。"],
  ["t-4005", "学生支援制度の監視", "RUNNING", "normal", "grant_ai", "finance", "university", 400, 80, "補助金・コンテスト情報を継続監視し、該当時に通知する。"],

  ["t-5001", "美容業界の市場規模を再推計", "RUNNING", "high", "market_ai", "research", "re_palette", 45, 62, "一次統計をもとに国内市場規模とセグメント構成を更新する。"],
  ["t-5002", "競合3社の新施策を追跡", "RUNNING", "normal", "competitor_ai", "research", "re_palette", 70, 55, "競合の発表・求人・SNSから動きを推定する。"],
  ["t-5003", "Z世代のコスメ消費行動分析", "COMPLETED", "normal", "trend_ai", "research", "newtone", 190, 100, "購買導線と情報接触点の変化を分析する。"],
  ["t-5004", "Agent Orchestration 手法の比較", "PLANNING", "normal", "tech_research", "research", "friday", 220, 30, "主要なオーケストレーション設計を比較し採用案を出す。"],
  ["t-5005", "市場レポート12件の要約", "COMPLETED", "normal", "research_director", "research", "re_palette", 105, 100, "収集したレポートを比較可能な形式へ要約する。"],

  ["t-6001", "ランディングページのビジュアル制作", "RUNNING", "high", "designer_ai", "creative", "re_palette", 65, 68, "ブランドの世界観を一枚で伝えるLPのビジュアルを制作する。"],
  ["t-6002", "LP ヘッドライン10案", "REVIEW", "normal", "copy_ai", "creative", "re_palette", 50, 100, "訴求軸を変えた見出しを10案作成する。"],
  ["t-6003", "Re-Palette ブランド定義の更新", "RUNNING", "normal", "brand_ai", "creative", "re_palette", 175, 40, "トーン・カラー・使用禁止表現を最新の方針へ更新する。"],
  ["t-6004", "ホームページデザインの提出", "COMPLETED", "high", "creative_director", "creative", "friday", 125, 100, "Command Center のビジュアル方針をまとめ提出する。"],

  ["t-7001", "明日のCEOスケジュール最適化", "RUNNING", "high", "schedule_ai", "operations", undefined, 25, 74, "会議の密度を下げ、集中作業の連続時間を確保する。"],
  ["t-7002", "Board Meeting 議事録の整形", "RUNNING", "normal", "minutes_ai", "operations", undefined, 115, 50, "決定事項・宿題・担当を分離した形式へ整える。"],
  ["t-7003", "Company Memory の重複統合", "RUNNING", "low", "knowledge_ai", "operations", undefined, 280, 45, "同義の記録を統合し、検索精度を上げる。"],
  ["t-7004", "業界ニュースの24時間監視", "RUNNING", "normal", "news_ai", "operations", "research_lab", 480, 88, "重要度の高いニュースのみをCEOへ通知する。"],
  ["t-7005", "大学出願書類の期限リマインド", "RUNNING", "critical", "assistant_ai", "operations", "university", 35, 60, "提出期限から逆算し、必要な作業を日割りで提示する。"],

  ["t-8001", "Q4リソース配分プランの再計算", "PLANNING", "critical", "coo", "strategy", undefined, 15, 38, "部署別の負荷と成果からリソース移動案を作る。"],
  ["t-8002", "新規事業アイデアの実現可能性評価", "RUNNING", "high", "strategy_planner", "strategy", "new_business", 145, 47, "5案それぞれの実現難度と必要資源を評価する。"],
  ["t-8003", "NEWTONE 収益モデル検証", "RUNNING", "normal", "biz_dev", "strategy", "newtone", 205, 53, "出展料・物販手数料・協賛の3収入で、来場620名の損益分岐が成立するか確認する。"],
  ["t-8004", "外部サービス連携の規約確認", "WAITING", "high", "risk_ai", "strategy", "friday", 60, 85, "外部API連携の利用規約と権限範囲を確認する。"],
  ["t-8005", "週次KPIから異常値を抽出", "COMPLETED", "normal", "insight_ai", "strategy", undefined, 90, 100, "前週比で外れ値となった指標を抽出し原因仮説を添える。"],

  // ── NEWTONE 2027 ───────────────────────────────────────────────────────────
  //
  // A two-sided event: brands on one side, visitors on the other. The lineup
  // is what the visitor campaign sells, so brand recruitment leads everything
  // and its slippage is what puts the project at risk.
  ["t-9001", "全国の学生美容ブランド候補リスト作成", "RUNNING", "critical", "lead_ai", "sales", "newtone", 220, 45, "美容専門学校・大学のサークル・学生起業家コミュニティ・Instagramから、実際に商品を持つ学生ブランドを全国で探す。所在地・商材・SNS規模・連絡先を揃える。"],
  ["t-9002", "出展ブランドへの初回接触文面", "WAITING_FOR_CEO", "critical", "outreach_ai", "sales", "newtone", 48, 100, "候補ブランドへの初回接触メール。学生同士であること、出展負担の小ささ、得られる露出を先に伝える。CEO承認後に送信。"],
  ["t-9003", "出展ブランドの選考基準を定義", "PLANNING", "high", "coo", "strategy", "newtone", 150, 30, "20組という枠に対し、商材の重複・安全性・当日運営の負荷・世界観の一貫性で選ぶ基準を決める。落とす理由を説明できる形にする。"],
  ["t-9004", "化粧品の表示・広告表現チェック", "RUNNING", "critical", "risk_ai", "strategy", "newtone", 175, 40, "学生ブランドの多くはOEM製造。薬機法上の表示義務（製造販売業者名・全成分）と、効能効果の逸脱表現を出展条件として確認する。1組の違反が会全体を止める。"],
  ["t-9005", "物販オペレーション設計", "PLANNING", "high", "ops_strategy", "strategy", "newtone", 130, 25, "決済手段の統一、在庫の預かり方、売上の集計と各ブランドへの分配、現金の扱い。誰がいつ何を触るかまで決める。"],
  ["t-9006", "会場レイアウトと什器計画", "RUNNING", "normal", "designer_ai", "creative", "newtone", 190, 38, "20組が横並びで埋もれない配置と、試用・撮影・会話が同時に起きる動線を設計する。"],
  ["t-9007", "NEWTONE 2027 ビジュアルアイデンティティ", "RUNNING", "high", "brand_ai", "creative", "newtone", 205, 55, "20組のばらばらな世界観を一つの会として束ねる、主張しすぎないビジュアル体系を作る。ARQOのトーンに接続する。"],
  ["t-9008", "来場者向け告知の設計", "PLANNING", "high", "social_ai", "marketing", "newtone", 115, 20, "出展ブランド確定を待って着火する集客計画。ブランド1組ごとの紹介を素材にし、出展者自身の発信を主導線にする。"],
  ["t-9009", "協賛・会場提供先の候補整理", "RUNNING", "high", "partnership_ai", "sales", "newtone", 165, 35, "美容専門学校・美容メーカー・商業施設を、提供できるもの（場所・什器・サンプル・送客）で分類し、初手を決める。"],
  ["t-9010", "当日運営スタッフの募集計画", "PLANNING", "normal", "schedule_ai", "operations", "newtone", 100, 18, "必要人数とシフトを時間帯ごとに出し、学生スタッフの募集開始日を逆算する。"],
  ["t-9011", "Nuance Lounge の実績を出展訴求へ転用", "RUNNING", "normal", "content_ai", "marketing", "newtone", 140, 48, "満足度4.6・「普段話せない悩みを安心して話せた」4.4という実測値を、出展ブランドと協賛先に向けた信頼材料として文章化する。"],
  ["t-9012", "来場者アンケートの設計", "QUEUED", "normal", "user_research", "research", "newtone", 80, 10, "伴走型整容教育と同じ前後比較の型で、来場前後の自己効力感の変化を測れる設問にする。イベントを一度きりで終わらせないための素材。"],
];

/** Completed-today rows that pad the daily counters without cluttering boards. */
const COMPLETED_PAD = 44;

function toTask(row: Row): Task {
  const [id, title, status, priority, agent, dept, project, createdAgoMin, progress, description] = row;
  const createdAt = ago(minutes(createdAgoMin));
  return {
    id,
    title,
    description,
    status,
    priority,
    assignedAgent: agent,
    department: dept,
    project,
    createdAt,
    updatedAt: ago(minutes(Math.max(0, createdAgoMin - 20))),
    deadline: ahead(hours(6) + minutes(createdAgoMin * 3)),
    subTasks: [],
    progress,
    output:
      status === "COMPLETED"
        ? "成果物を Knowledge Center へ保存し、担当部署へ共有済み。"
        : undefined,
  };
}

const BLOCKED: Record<string, { reason: string; approvalId: string }> = {
  "t-1004": {
    reason: "Production deployment requires CEO approval.",
    approvalId: "ap-1",
  },
  "t-2003": {
    reason: "External publishing requires CEO approval.",
    approvalId: "ap-2",
  },
  "t-3005": {
    reason: "Sending external email is irreversible and requires CEO approval.",
    approvalId: "ap-3",
  },
  "t-8004": {
    reason: "Connecting an external service requires CEO approval.",
    approvalId: "ap-5",
  },
  "t-9002": {
    reason: "Sending external email is irreversible and requires CEO approval.",
    approvalId: "ap-3",
  },
};

export const TASKS: Task[] = ROWS.map(toTask).map((task) =>
  BLOCKED[task.id]
    ? {
        ...task,
        status: task.id === "t-8004" ? task.status : ("WAITING_FOR_CEO" as const),
        blockedReason: BLOCKED[task.id].reason,
        approvalId: BLOCKED[task.id].approvalId,
      }
    : task,
);

export const TASKS_BY_ID: Record<string, Task> = Object.fromEntries(
  TASKS.map((t) => [t.id, t]),
);

/**
 * Daily totals shown on the command centre. Board rows are the live slice;
 * the rest are already-closed items from earlier in the day.
 */
export const TASK_TOTALS = {
  today: TASKS.length + COMPLETED_PAD,
  completed: TASKS.filter((t) => t.status === "COMPLETED").length + COMPLETED_PAD,
  padding: COMPLETED_PAD,
};

export const DEPARTMENT_TASK_DELTA: Record<DepartmentId, number> = {
  marketing: 12,
  engineering: 18,
  research: 14,
  sales: 9,
  creative: 7,
  finance: 6,
  strategy: 5,
  operations: 11,
};

export const TASK_DEADLINE_HORIZON = ahead(days(3));
