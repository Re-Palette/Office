# F.R.I.D.A.Y. — AI Company OS

AI社員だけで構成された会社を、人間の社長1人が経営するための統合経営ダッシュボード。
会社紹介サイトではなく、CEOがログインして会社の全部をリアルタイムで把握・指示・管理する
「AI企業司令室」です。

> 最終意思決定者は常にCEO。AIは提案・分析・実行・報告を行いますが、
> 不可逆な外部アクション（送信・公開・課金・本番反映）は必ずCEO承認を経由します。

---

## 現在のフェーズ

| Phase | 内容 | 状態 |
| --- | --- | --- |
| 1 | 完全なUI / UX | ✅ 完了 |
| 2 | Mock Agent System | ✅ 完了 |
| 3 | Database (Supabase) | 未着手 |
| 4 | Claude API | 未着手 |
| 5 | Real Tools | 未着手 |
| 6 | Scheduled Reports (Cron) | 未着手 |
| 7 | External Integrations | 未着手 |

Phase 1–2 が完了しており、Claude API を接続していない状態でも
「AI社員が実際に働いているように見える」状態まで作り込んであります。

---

## 起動

```bash
npm install
npm run dev        # http://localhost:3000
```

ログイン画面から `Enter Command Center` を押すとダッシュボードへ入ります
（Phase 3 で Supabase Auth に差し替える前提のモック認証です）。

```bash
npm run build      # 本番ビルド
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
```

---

## 画面

| ルート | 画面 | 役割 |
| --- | --- | --- |
| `/login` | Login | CEO専用のアクセスゲート |
| `/` | Company Command Center | 会社の現在地を一目で把握するホーム |
| `/command` | Command Center | 一言の指示をタスクグラフへ分解する |
| `/employees` | AI Employees | 全48名の一覧・検索・フィルター |
| `/employees/[id]` | Employee Detail | Role / Mission / Skills / Permissions / Memory |
| `/departments` | Departments | 8部署と部署間の連携経路 |
| `/departments/[id]` | Department Detail | 部署内のAI社員とタスク |
| `/projects` | Projects | 全プロジェクトのポートフォリオ |
| `/projects/[id]` | Project Detail | 進捗・マイルストーン・担当・活動 |
| `/tasks` | Task Engine | ステータス別ボードと依頼の入り口 |
| `/activity` | Activity | 全AI社員の行動イベントストリーム |
| `/reports` | Reports | Morning Briefing / Daily Executive Report |
| `/meetings` | AI Board Meeting | 各Directorの週次報告とCOO統合 |
| `/knowledge` | Knowledge Center | 会社の知識とCompany Memory |
| `/analytics` | Analytics | 生産性・収益・AI稼働の分析 |
| `/settings` | Settings | 定期実行・権限ゲート・Agent Registry |

---

## アーキテクチャ

```
src/
├── app/
│   ├── (app)/              認証後のシェル配下の全画面
│   ├── login/              アクセスゲート
│   └── layout.tsx          フォント / メタデータ
├── components/
│   ├── shell/              Sidebar · Topbar · RightPanel · AppShell
│   ├── ui/                 Panel · Button · Avatar · Progress · Charts
│   ├── home/               KPI · Live Workforce · Today's Performance
│   ├── company/            Activity · CEO Inbox · Collaboration · Chat
│   └── command/            Plan Graph
└── lib/
    ├── types.ts            ドメインモデル（Agent / Task / Activity / Approval …）
    ├── company/            Agent Registry・部署・プロジェクト・タスク・知識・レポート
    ├── engine/
    │   ├── orchestrator.ts CEOの指示 → タスク分解 → 部署への割り当て
    │   ├── chat.ts         CEO → COO → Departments → Employees のルーティング
    │   └── simulator.ts    Mock Agent System（活動イベント生成と稼働バランス）
    ├── store.ts            会社の単一ステート（zustand）
    ├── status.ts           ステータスの表示メタデータ
    └── time.ts             会社時計
```

**Stack**: Next.js 15 (App Router) / TypeScript / Tailwind CSS / Framer Motion / Recharts / zustand

### Agent Registry

AI社員は `src/lib/company/agents.ts` の1箇所で定義されます。

```ts
{
  id, name, role, department, seniority,
  mission, systemPrompt,
  skills[], tools[], permissions[],
  reportsTo, collaborators[],
  status, currentTask, memory[]
}
```

registryに1行追加すると、一覧・部署ページ・フィルター・組織図・コマンドルーター・
アクティビティシミュレーターすべてに自動反映されます。
UIに特定のAI社員をハードコードしている箇所はありません。

現在の構成: C-suite 8名（COO / CTO / CMO / CFO / CSO / Research Director /
Creative Director / Executive Assistant）+ 各部署のスペシャリスト40名 = 48名。

### Human Approval Gate

`permissions` のうち以下はCEO承認を必須とします。

- `spend_budget` — 予算の支出
- `send_external_email` — 外部メール送信
- `publish_social` — SNS公開
- `deploy_production` — 本番Deploy
- `connect_external_service` — 外部サービス接続

承認待ちは CEO Inbox（ホーム / Command Center / 右パネル）に集約され、
Approve / Reject / Review で処理します。

### Task Engine

```
QUEUED → PLANNING → RUNNING → WAITING → REVIEW → COMPLETED
                                              ↘ FAILED
```

### Activity Engine

すべての行動は単一のイベントとして記録されます。

```
agent.started / agent.thinking / agent.tool_called / agent.completed / agent.handoff
task.created / task.assigned / task.completed
approval.requested / approval.approved / approval.rejected
report.generated / insight.found
```

---

## Mock Agent System

`src/lib/engine/simulator.ts` が一定間隔でイベントを生成し、AI社員の状態を遷移させます。
稼働人数は 14〜21 名のバンド内に保たれ、C-suiteは常時稼働、スペシャリストは
`idle` / `waiting` / `completed` を行き来します。全員が常に働いている不自然な状態にはなりません。

Claude API へ差し替える際は、イベントの供給元を `simulator.ts` から実際の
Agent Orchestrator へ置き換えるだけで、UI側の変更は不要です。
`orchestrator.ts` の `planCommand()` も同様に、Claudeの呼び出しへ置き換え可能な形にしてあります。

---

## 会社時計について

サーバーとクライアントで同じHTMLを描画するため、シード値の時刻は
`src/lib/time.ts` の `SEED_NOW`（2026-09-21 16:42 JST）を基準にした相対オフセットで定義し、
マウント後にリアルタイムで進行します。時刻表示はすべて Asia/Tokyo 固定です。

---

## レスポンシブ

PC最優先。1440 / 1920 / 2560px で情報密度が最大化されるよう設計しています。
右パネルは xl 未満ではオーバーレイとして開閉し、モバイルでは簡易版を表示します。
