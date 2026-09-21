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
| 2.5 | Report · PDF · Approval · Notification Workflow | ✅ 完了 |
| 3 | Database (Supabase) | 未着手 |
| 4 | Claude API | 未着手 |
| 5 | Real Tools | 未着手 |
| 6 | Scheduled Reports (Cron) | 未着手 |
| 7 | External Integrations | 未着手 |

Phase 1–2.5 が完了しており、Claude API を接続していない状態でも
「AI社員が実際に働いているように見える」状態まで作り込んであります。

さらに、AI社員の仕事が**正式なレポートになり、PDFとして出力され、CEOへ通知され、
CEOの承認を経て次へ進む**という一連のWorkflowが実際に動作します。

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
| `/reports` | Report Center | 全レポートの管理・生成・PDF・確認欄 |
| `/reports/[id]` | Report Detail | 本文・PDFプレビュー・CEO承認 |
| `/reports/[id]/pdf` | PDF | 実際のPDFを返すRoute Handler |
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
├── assets/fonts/           PDF埋め込み用 Noto Sans JP サブセット（JIS X 0208）
├── components/
│   ├── shell/              Sidebar · Topbar · RightPanel · AppShell
│   ├── ui/                 Panel · Button · Avatar · Progress · Charts
│   ├── home/               KPI · Live Workforce · Reports · Today's Performance
│   ├── company/            Activity · CEO Inbox · CEO Action · Notification · Chat
│   ├── reports/            Report Status · PDF Link
│   └── command/            Plan Graph
├── server/
│   ├── report-store.ts     サーバー側レポートレジストリ
│   ├── report-pdf.ts       PDFレンダラー（A4・11セクション構成）
│   └── font-coverage.ts    埋め込みフォントの収録文字範囲
└── lib/
    ├── types.ts            ドメインモデル（Agent / Task / Report / Approval / Notification …）
    ├── company/            Agent Registry・部署・プロジェクト・タスク・知識・レポート
    ├── engine/
    │   ├── orchestrator.ts CEOの指示 → タスク分解 → 部署への割り当て
    │   ├── chat.ts         CEO → COO → Departments → Employees のルーティング
    │   ├── report-builder.ts 実データを集約してレポート本文を生成
    │   ├── workflow.ts     Task → Report → Approval → Notification の連鎖
    │   └── simulator.ts    Mock Agent System（活動イベント生成と稼働バランス）
    ├── store.ts            会社の単一ステート（zustand）
    ├── persistence.ts      CEOの判断をブラウザに保存
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

---

## Report · PDF · Approval · Notification Workflow

この4つは独立した機能ではなく、1本のWorkflowとして設計しています。

```
AI社員が仕事をする
   ↓
成果がレポートになる            generateReport()  — Task / Activity / Project /
   ↓                                              Department / Analytics を集約
PDFが生成される                 /reports/{id}/pdf — 実際のPDFを返すRoute Handler
   ↓
PDF URLが発行される             report.pdfUrl
   ↓
CEO確認待ちになる               status = PENDING_REVIEW
   ↓
CEOへ通知が届く                 APPROVAL_REQUIRED 通知 + 🔔 バッジ + バナー
   ↓
CEO Inbox / Approval Queue に入る
   ↓
CEOが Approve / Request Revision / Reject
   ↓
Activity Log に記録され、止まっていた仕事が再開する
```

### レポート

7種類（Daily / Weekly / Project / Department / Research / Task Completion /
Executive、加えて Morning Briefing）を生成できます。
本文は自由記述ではなく、ダッシュボードが表示しているのと同じ
タスク・活動・プロジェクト・部署・分析データを集約して構成されます。

状態遷移:

```
DRAFT → GENERATING → GENERATED → PENDING_REVIEW → APPROVED
                                               ↘ REVISION_REQUIRED → 新しいバージョン
                                               ↘ REJECTED
```

修正依頼を出すと、作成したAI社員に Revision Task が割り当てられ、
修正内容を反映した v2 が新しいレポートとして提出されます。

### PDF

`/reports/{id}/pdf` が本物のPDF（`application/pdf`）を返します。
別タブで開く / ダッシュボード内の iframe でプレビュー / `?download=1` で保存、
のいずれにも同じURLを使います。

構成は Cover → Executive Summary → Key Metrics → Department Performance →
Project Progress → Major Achievements → Important Findings → Problems / Risks →
CEO Decisions Required → Next Actions → Appendix の11セクション。

日本語を確実に表示するため、Noto Sans JP（OFL）を JIS X 0208 へサブセットして
リポジトリに同梱し、PDFへ埋め込んでいます。
pdf-lib 側のサブセット機能（`subset: true`）はこのフォントでグリフを破損させるため、
**意図的に使用していません**。詳細は `src/assets/fonts/LICENSE.md` を参照。
フォント未収録の文字は空白ではなく `〓` として可視化されます。

### 通知

| Level | 用途 | バナー表示 |
| --- | --- | --- |
| `INFO` | 参考情報 | — |
| `SUCCESS` | 完了報告 | — |
| `WARNING` | 注意喚起・期限 | — |
| `APPROVAL_REQUIRED` | CEO承認が必要 | ✅ |
| `ERROR` | エラー対応 | ✅ |
| `URGENT` | 緊急 | ✅ |

🔔 は未読件数をバッジ表示し、クリックで Notification Center を開きます。
通知はクリックすると対象ページへ直接遷移し、未読は既読になります。
`URGENT` / `APPROVAL_REQUIRED` の未読が1件以上あるときだけ、
画面上部に1行のバナーが出ます（閉じられます）。

### CEO Action Required

「AIが仕事をしている」ことより「AIがCEOに何を求めているか」を最重要情報として扱います。
承認待ちは発生源（レポート / タスク / 予算 / Deploy …）を問わず1つのリストに集約され、
URGENT → HIGH → MEDIUM → LOW の順に並びます。
表示場所は HOME の最上部・Command Center・右パネルの3か所で、いずれも同じデータです。

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

## CEOの判断の保存

承認・却下・修正依頼と、実行中に生成したレポートは `localStorage` に保存され、
リロード後も残ります（`src/lib/persistence.ts`）。
AI社員の稼働状況・活動ログ・会社時計は毎回シードから再生成されるため、
ダッシュボードは常にライブのまま、判断だけが積み上がります。
Settings → Stored decisions から初期状態へ戻せます。

実行中に生成したレポートは `POST /api/reports` でサーバー側レジストリにも登録され、
PDF URL が解決できるようになります。サーバーを再起動すると実行時レポートは失われます
（シードレポートは常に解決します）。Phase 3 で Supabase へ移行します。

---

## 定期実行

Daily Executive Report は、設定した時刻（既定 22:00 JST）を会社時計が越えた時点で
自動生成されます。すぐに確認したい場合は Report Center の Generate から
同じ処理を手動で実行できます。

---

## 会社時計について

サーバーとクライアントで同じHTMLを描画するため、シード値の時刻は
`src/lib/time.ts` の `SEED_NOW`（2026-09-21 16:42 JST）を基準にした相対オフセットで定義し、
マウント後にリアルタイムで進行します。時刻表示はすべて Asia/Tokyo 固定です。

---

## レスポンシブ

PC最優先。1440 / 1920 / 2560px で情報密度が最大化されるよう設計しています。
右パネルは xl 未満ではオーバーレイとして開閉し、モバイルでは簡易版を表示します。
