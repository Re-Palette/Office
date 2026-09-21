import type { BoardMeeting, ScheduleConfig } from "@/lib/types";
import { ago, ahead, days, hours, SEED_NOW } from "@/lib/time";

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  morningBriefing: "08:00",
  dailyReport: "22:00",
  weeklyBoard: "20:00",
  weeklyBoardDay: "Sunday",
};

export interface BriefingSection {
  label: string;
  agentId: string;
  lines: string[];
}

export const MORNING_BRIEFING = {
  generatedAt: ago(hours(8) + 42 * 60_000),
  opening:
    "Good morning, CEO. 昨日のうちに会社は止まらず動いていました。今日、あなたの判断が必要なのは2件です。",
  sections: [
    {
      label: "YESTERDAY",
      agentId: "coo",
      lines: [
        "完了タスク 48件。前日比 +6件。",
        "Re-Palette のSNS保存率が3日連続で改善しました。",
        "開発は認証基盤の実装を80%まで到達させています。",
      ],
    },
    {
      label: "TODAY'S PRIORITIES",
      agentId: "coo",
      lines: [
        "F.R.I.D.A.Y. 認証基盤の完了とDeploy判断。",
        "Re-Palette 提携候補18社のスコアリング完了。",
        "大学出願書類 — 活動実績の整理（期限まで5日）。",
      ],
    },
    {
      label: "AI WORKFORCE",
      agentId: "chief_of_staff",
      lines: [
        "本日の稼働予定 17名。うち Executive 8名は常時稼働。",
        "Creative は午後から制作集中のため、依頼は午前中に。",
        "Research は市場規模の再推計を12:00までに完了予定。",
      ],
    },
    {
      label: "SIGNALS",
      agentId: "news_ai",
      lines: [
        "競合A社が新規事業に向けた採用を開始（重要度: 高）。",
        "美容業界のサステナビリティ規制、来春に改定の見込み。",
        "学生向け支援制度が1件、応募条件に合致しました。",
      ],
    },
    {
      label: "DECISIONS FOR YOU",
      agentId: "coo",
      lines: [
        "本番環境への Deploy — 承認待ち（4時間以内）。",
        "Instagram 投稿3案の公開 — 承認待ち（2時間以内）。",
      ],
    },
    {
      label: "PROPOSAL",
      agentId: "coo",
      lines: [
        "開発リソースを Marketing から Development へ 20% 移すことを提案します。",
        "理由: Development backlog +32% / Marketing idle 18%。",
      ],
    },
  ] satisfies BriefingSection[],
};

export const DAILY_REPORT = {
  scheduledAt: ahead(hours(5) + 18 * 60_000),
  generatedAt: ago(days(1) - hours(0)),
  metrics: [
    { label: "Completed Tasks", value: "51", delta: "+6" },
    { label: "AI Employees Active", value: "17", delta: "+2" },
    { label: "Projects Updated", value: "8", delta: "+1" },
    { label: "Important Findings", value: "6", delta: "+3" },
    { label: "CEO Decisions Required", value: "2", delta: "-1" },
  ],
  summary:
    "本日はマーケティング部がInstagram市場分析を完了し、12件のトレンド候補を抽出しました。開発部ではF.R.I.D.A.Y.の認証機能を実装し、E2Eテストを全件通過させています。営業部は新規提携候補を18社調査し、うち6社を高適合と評価しました。リサーチ部は美容業界の市場規模を一次統計から再推計し、想定より高いセグメントを1つ特定しています。財務部はSaaS支出の重複を検出し、月額¥31,000の削減余地を報告しました。",
  highlights: [
    { agentId: "cmo", text: "Instagram トレンド分析を完了。トレンド候補12件。" },
    { agentId: "cto", text: "認証基盤の実装完了。E2E 12/12 passed。" },
    { agentId: "cso", text: "提携候補18社を評価。高適合6社。" },
    { agentId: "research_director", text: "市場レポート12件を要約し比較表へ。" },
    { agentId: "cfo", text: "SaaS重複契約を検出。月額¥31,000の削減案。" },
  ],
  risks: [
    { level: "high" as const, text: "NEWTONE 2027 の出展者募集が計画比 -28%。集客導線の見直しが必要です。" },
    { level: "medium" as const, text: "大学出願書類の活動実績整理が未着手。残り5日。" },
  ],
  tomorrow: [
    "Deploy承認が下りた場合、午前中に本番反映とスモークテストを実施。",
    "Re-Palette 提携候補の上位6社へ初回接触（CEO承認後）。",
    "NEWTONE 出展者募集の導線をCreativeと再設計。",
    "大学出願書類の活動実績を、AIが下書きまで作成。",
  ],
};

export const BOARD_MEETINGS: BoardMeeting[] = [
  {
    id: "board-w38",
    title: "AI BOARD MEETING — Week 38",
    at: ahead(days(6) + hours(3) + 18 * 60_000),
    status: "scheduled",
    summary: "",
    decisions: [],
    reports: [],
  },
  {
    id: "board-w37",
    title: "AI BOARD MEETING — Week 37",
    at: ago(days(1) + hours(20)),
    status: "completed",
    summary:
      "今週の会社全体の主題は「認知の質」と「実装の速度」でした。Marketing は量から質への転換点にあり、Engineering は基盤実装がクリティカルパス上にあります。Sales は候補の母数が揃い、次は接触の質が成果を決めます。Finance は固定費に削減余地を確認。全体として計画は前進していますが、NEWTONE 2027 のみ計画比で遅れており、来週の最優先で扱うべきです。",
    decisions: [
      "開発リソースを20%増やす提案をCEOへ提出する。",
      "Re-Palette の指標をリーチから保存率へ切り替える。",
      "NEWTONE 2027 を来週の最優先プロジェクトに指定する。",
      "重複SaaS 2件の統合をCFO主導で実行する（CEO承認後）。",
    ],
    reports: [
      {
        agentId: "coo",
        area: "Company Strategy",
        headline: "計画は前進。ただしクリティカルパスは Engineering に集中。",
        points: [
          "全社タスク完了 312件 / 週（前週比 +9%）。",
          "ブロック中タスクの71%が認証基盤の完了待ち。",
          "部署間の待機時間は Marketing が最大。",
        ],
        metric: { label: "Weekly throughput", value: "312", delta: "+9%" },
      },
      {
        agentId: "cto",
        area: "Technology",
        headline: "認証基盤は実装完了。Deploy判断のみ残存。",
        points: [
          "E2E 12/12 passed。既知の劣化なし。",
          "Orchestrator API の設計は35%。来週に設計確定。",
          "技術的負債は現時点で許容範囲。",
        ],
        metric: { label: "Build health", value: "green" },
      },
      {
        agentId: "cmo",
        area: "Marketing",
        headline: "リーチは伸長、保存率は低下。指標の切り替えを提案。",
        points: [
          "フォロワー +18.7%（30日）。",
          "保存率 -4.2%。保存は3週間後の流入と強く相関。",
          "トレンド候補12件から3施策へ集約。",
        ],
        metric: { label: "Followers", value: "248,532", delta: "+18.7%" },
      },
      {
        agentId: "cfo",
        area: "Financial",
        headline: "売上は計画超過。固定費に削減余地。",
        points: [
          "今月売上 ¥3,482,000（計画比 +12.4%）。",
          "SaaS重複で月額 ¥31,000 の削減余地。",
          "NEWTONE の会場費は承認待ち。",
        ],
        metric: { label: "Revenue (MTD)", value: "¥3,482,000", delta: "+12.4%" },
      },
      {
        agentId: "cso",
        area: "Sales",
        headline: "候補の母数は充足。次は接触の質。",
        points: [
          "提携候補 18社を評価、高適合6社。",
          "新規リード 186件（+32.1%）。",
          "初回接触メール3通がCEO承認待ち。",
        ],
        metric: { label: "New leads", value: "186", delta: "+32.1%" },
      },
      {
        agentId: "research_director",
        area: "Market Intelligence",
        headline: "市場は想定より大きい。ただし競合の動きが加速。",
        points: [
          "市場規模を一次統計から再推計、上振れセグメントを1つ特定。",
          "競合A社に新規事業参入の兆候。",
          "一次情報の比率を58% → 71%へ改善。",
        ],
        metric: { label: "Primary sources", value: "71%", delta: "+13pt" },
      },
      {
        agentId: "creative_director",
        area: "Brand & Design",
        headline: "ブランドの一貫性は改善。制作スループットが課題。",
        points: [
          "LP ビジュアルは68%完成。",
          "ブランド定義に使用禁止表現を3件追加。",
          "制作待ち行列が week 単位で +2件。",
        ],
        metric: { label: "Creative output", value: "34 assets", delta: "+5" },
      },
    ],
  },
];

export const NEXT_SCHEDULED = {
  morningBriefing: ahead(hours(15) + 18 * 60_000),
  dailyReport: ahead(hours(5) + 18 * 60_000),
  boardMeeting: ahead(days(6) + hours(3) + 18 * 60_000),
  reference: SEED_NOW,
};
