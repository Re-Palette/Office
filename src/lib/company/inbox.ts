import type {
  Approval,
  CollaborationFlow,
  NotificationItem,
  Recommendation,
} from "@/lib/types";
import { ago, ahead, hours, minutes } from "@/lib/time";

/**
 * The Human Approval Gate.
 * No agent may take an irreversible external action without a decision here.
 */
export const SEED_APPROVALS: Approval[] = [
  {
    id: "ap-1",
    kind: "deploy",
    title: "本番環境への Deploy",
    requestedBy: "infra_ai",
    requestedAt: ago(minutes(20)),
    summary:
      "認証基盤を含む F.R.I.D.A.Y. のビルドを本番環境へ反映します。ロールバック手順は用意済みです。",
    impact: "承認すると本番環境が更新され、現在のセッションは再認証が必要になります。",
    risk: "medium",
    status: "pending",
    deadline: ahead(hours(4)),
    payload: [
      { label: "Environment", value: "production" },
      { label: "Build", value: "friday-os@0.6.2" },
      { label: "Changed", value: "auth / session / middleware" },
      { label: "Rollback", value: "1 command (≈40s)" },
    ],
  },
  {
    id: "ap-2",
    kind: "social_post",
    title: "Instagram 投稿 3案の公開",
    requestedBy: "social_ai",
    requestedAt: ago(minutes(8)),
    summary:
      "トレンド分析から生成した Re-Palette の投稿案3件を、本日18:00に予約投稿します。",
    impact: "承認すると外部SNSへ公開され、取り消しても閲覧履歴は残ります。",
    risk: "medium",
    status: "pending",
    deadline: ahead(hours(2)),
    payload: [
      { label: "Account", value: "@re_palette" },
      { label: "Posts", value: "3 (carousel / reel / still)" },
      { label: "Schedule", value: "Today 18:00 JST" },
      { label: "Reviewed by", value: "Creative Director" },
    ],
  },
  {
    id: "ap-3",
    kind: "email",
    title: "外部メール 3通の送信",
    requestedBy: "outreach_ai",
    requestedAt: ago(minutes(31)),
    summary:
      "提携候補3社の担当者へ初回接触メールを送信します。文面はCSOがレビュー済みです。",
    impact: "承認すると実在する企業へメールが送信されます。撤回はできません。",
    risk: "high",
    status: "pending",
    deadline: ahead(hours(6)),
    payload: [
      { label: "Recipients", value: "3 companies" },
      { label: "From", value: "ceo@re-palette.jp" },
      { label: "Template", value: "partnership-intro-v3" },
    ],
  },
  {
    id: "ap-4",
    kind: "budget",
    title: "NEWTONE 2027 会場費の確保",
    requestedBy: "cfo",
    requestedAt: ago(hours(1) + minutes(12)),
    summary:
      "会場の仮押さえを本押さえへ切り替えるため、¥480,000 の支出を承認してください。",
    impact: "承認すると支出が確定し、キャンセル料が発生する期間に入ります。",
    risk: "high",
    status: "pending",
    deadline: ahead(hours(20)),
    payload: [
      { label: "Amount", value: "¥480,000" },
      { label: "Category", value: "Venue / NEWTONE 2027" },
      { label: "Payback", value: "来場800名で回収見込み" },
      { label: "Cancel fee", value: "承認後30日で50%" },
    ],
  },
  {
    id: "ap-5",
    kind: "external_service",
    title: "外部API連携の有効化",
    requestedBy: "risk_ai",
    requestedAt: ago(hours(2)),
    summary:
      "分析用の外部データAPIを接続します。利用規約と権限範囲の確認は完了しています。",
    impact: "承認すると社内データの一部が外部サービスへ送信されます。",
    risk: "low",
    status: "pending",
    payload: [
      { label: "Service", value: "Market Data API" },
      { label: "Scope", value: "read-only / aggregated" },
      { label: "Terms", value: "確認済み — 再販条項なし" },
    ],
  },
];

export const SEED_RECOMMENDATIONS: Recommendation[] = [
  {
    id: "rec-1",
    fromAgent: "coo",
    headline: "今週、開発リソースを Marketing から Development へ 20% 移すことを提案します。",
    rationale:
      "開発のバックログが前週比 +32% で積み上がる一方、マーケティングは施策の待機時間が増えています。F.R.I.D.A.Y. の認証基盤が遅れると、以降の全機能がブロックされます。",
    evidence: [
      { label: "Development backlog", value: "+32%" },
      { label: "Marketing idle time", value: "18%" },
      { label: "Blocked downstream tasks", value: "7" },
    ],
    confidence: 86,
    status: "open",
  },
  {
    id: "rec-2",
    fromAgent: "cmo",
    headline: "Re-Palette の認知施策を、リーチ重視から保存率重視へ切り替えることを提案します。",
    rationale:
      "直近30日で、リーチは伸びているものの保存率が下がっています。保存率の高い投稿は3週間後の流入に効いており、認知3倍の目標には保存率の方が相関します。",
    evidence: [
      { label: "Reach", value: "+18.7%" },
      { label: "Save rate", value: "-4.2%" },
      { label: "Correlation (save → visit)", value: "0.71" },
    ],
    confidence: 78,
    status: "open",
  },
  {
    id: "rec-3",
    fromAgent: "cfo",
    headline: "重複している SaaS 契約2件の統合で、月額 ¥31,000 の削減が可能です。",
    rationale:
      "機能が重複する分析ツールを2件契約しています。利用ログ上、片方は過去60日で3回しか使われていません。",
    evidence: [
      { label: "Monthly saving", value: "¥31,000" },
      { label: "Usage (tool B)", value: "3 sessions / 60d" },
      { label: "Migration effort", value: "≈2h" },
    ],
    confidence: 92,
    status: "open",
  },
];

/** Work visibly moving between AI employees. */
export const SEED_FLOWS: CollaborationFlow[] = [
  {
    id: "flow-1",
    title: "Re-Palette の認知向上施策",
    origin: "CEO",
    startedAt: ago(minutes(46)),
    projectId: "re_palette",
    steps: [
      { id: "s1", agentId: "coo", action: "指示を受け、タスクを分解", state: "done", at: ago(minutes(46)) },
      { id: "s2", agentId: "cmo", action: "認知向上施策の調査を依頼", state: "done", at: ago(minutes(42)) },
      { id: "s3", agentId: "research_director", action: "類似事例を12件分析", state: "done", at: ago(minutes(31)) },
      { id: "s4", agentId: "cmo", action: "分析結果をもとに3案を作成", state: "active", at: ago(minutes(14)) },
      { id: "s5", agentId: "creative_director", action: "クリエイティブ制作を開始", state: "active", at: ago(minutes(9)) },
      { id: "s6", agentId: "coo", action: "統合してCEOへ提出", state: "queued" },
    ],
  },
  {
    id: "flow-2",
    title: "提携候補の発掘と初回接触",
    origin: "COO",
    startedAt: ago(hours(2)),
    projectId: "re_palette",
    steps: [
      { id: "s1", agentId: "cso", action: "対象条件を定義", state: "done", at: ago(hours(2)) },
      { id: "s2", agentId: "lead_ai", action: "候補を20社リストアップ", state: "done", at: ago(minutes(96)) },
      { id: "s3", agentId: "cso", action: "18社へ絞りスコアリング", state: "active", at: ago(minutes(75)) },
      { id: "s4", agentId: "outreach_ai", action: "初回接触メールを作成", state: "active", at: ago(minutes(31)) },
      { id: "s5", agentId: "coo", action: "CEO承認へ送付", state: "queued" },
    ],
  },
  {
    id: "flow-3",
    title: "F.R.I.D.A.Y. 認証基盤のリリース",
    origin: "CEO",
    startedAt: ago(hours(3)),
    projectId: "friday",
    steps: [
      { id: "s1", agentId: "cto", action: "設計と実装方針を決定", state: "done", at: ago(hours(3)) },
      { id: "s2", agentId: "backend_ai", action: "API と権限判定を実装", state: "done", at: ago(minutes(140)) },
      { id: "s3", agentId: "frontend_ai", action: "ログイン導線を実装", state: "done", at: ago(minutes(98)) },
      { id: "s4", agentId: "qa_ai", action: "E2Eで検証", state: "done", at: ago(minutes(47)) },
      { id: "s5", agentId: "infra_ai", action: "本番Deployの承認を申請", state: "active", at: ago(minutes(20)) },
    ],
  },
];

export const SEED_NOTIFICATIONS: NotificationItem[] = [
  {
    id: "n-1",
    kind: "approval",
    title: "CEO承認が必要です",
    body: "Instagram 投稿3案の公開 — Social Media AI",
    at: ago(minutes(8)),
    read: false,
    agentId: "social_ai",
  },
  {
    id: "n-2",
    kind: "approval",
    title: "CEO承認が必要です",
    body: "本番環境への Deploy — Infrastructure AI",
    at: ago(minutes(20)),
    read: false,
    agentId: "infra_ai",
  },
  {
    id: "n-3",
    kind: "discovery",
    title: "重要な発見",
    body: "競合A社の求人情報から、新規事業参入の兆候を検知しました。",
    at: ago(minutes(38)),
    read: false,
    agentId: "competitor_ai",
  },
  {
    id: "n-4",
    kind: "deadline",
    title: "期限が近づいています",
    body: "大学出願書類 — 残り21日。活動実績の整理は5日以内に完了が必要です。",
    at: ago(minutes(35)),
    read: false,
    agentId: "assistant_ai",
  },
  {
    id: "n-5",
    kind: "recommendation",
    title: "COO から提案",
    body: "開発リソースを Marketing から Development へ 20% 移す提案があります。",
    at: ago(minutes(15)),
    read: true,
    agentId: "coo",
  },
  {
    id: "n-6",
    kind: "task_completed",
    title: "タスク完了",
    body: "Instagram トレンド分析 — トレンド候補12件を抽出しました。",
    at: ago(minutes(5)),
    read: true,
    agentId: "cmo",
  },
];
