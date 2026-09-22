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
| 4 | Claude API — AI社員が実際に動作する | ✅ 完了 |
| 5 | Real Tools — Web検索 / コード実行 / 社内データ | ✅ 完了 |
| 3 | Database (Supabase) | ✅ 完了 |
| 6 | Scheduled Reports (Cron) | 部分的 — 日次note記事はサーバー側で発火 |
| 7 | External Integrations — Google (Gmail / Calendar) | ✅ 完了 |
| 7 | External Integrations — note（記事の自動執筆・毎日17:00） | ✅ 完了 |
| 7 | External Integrations — GitHub / Vercel / Instagram | 未着手 |

**APIキーを設定すると、AI社員は実際に働きます。**
Claudeを呼び出し、Webを検索し、コードを実行し、社内データを読み書きし、
互いに仕事を委譲し、承認が必要な場面では停止してCEOの判断を待ちます。

キーがない場合はデモ動作になり、従来どおりシミュレーションで画面が動きます。
どちらの状態かは画面右上のバッジで常に分かります。

---

## 起動

```bash
npm install
cp .env.example .env.local     # ANTHROPIC_API_KEY を設定すると LIVE になる
npm run dev                    # http://localhost:3000
```

### DEMO と LIVE

| | DEMO | LIVE |
| --- | --- | --- |
| 条件 | キーなし | `ANTHROPIC_API_KEY` を設定 |
| AI社員の活動 | シミュレーション | Claudeが実際に実行 |
| ツール | なし | Web検索・Webページ取得・コード実行・社内データ |
| レポート | 定型文から生成 | AI社員が実データを読んで執筆 |
| 承認 | 画面上の状態遷移 | 実際に実行中のAI社員が停止し、承認で再開 |
| 保存先 | ブラウザ | サーバー（`.friday/work-state.json`） |
| 課金 | なし | あり |

LIVE では実際に課金されます。1回の指示で複数のAI社員が動くため、
まずは小さな指示から試してください。

ログイン画面から `Enter Command Center` を押すとダッシュボードへ入ります
（Phase 3 で Supabase Auth に差し替える前提のモック認証です）。

```bash
npm run build      # 本番ビルド
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm run selftest   # Workflow自己テスト（モデル呼び出しのみスタブ・課金なし）
```

`npm run selftest` は、ループ・ツール実行・委譲・承認ゲート・レポート生成・PDF出力・
承認後の再開までを実際に動かして検証します。

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
| `/note` | Note Drafts | 毎日17:00に書かれたnote記事。コピー・.md出力・投稿管理 |
| `/knowledge` | Knowledge Center | 会社の知識とCompany Memory |
| `/analytics` | Analytics | 生産性・収益・AI稼働の分析 |
| `/settings` | Settings | 定期実行・外部連携・権限ゲート・Agent Registry |

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

## 配色

すべての本文・ラベルが WCAG AA（4.5:1）以上を満たしています。
全12画面のレンダリング後のDOMを走査して実測しており、現在 AA 未満のテキストは 0 件です。

### 文字（サーフェス #0D0E10 上）

| トークン | 用途 | コントラスト |
| --- | --- | --- |
| `ink` | 見出し・数値 | 17.7:1 |
| `ink-muted` | 本文 | 8.7:1 |
| `ink-faint` | ラベル・補足 | 5.8:1 |
| `ink-ghost` | 件数などの最小情報 | 4.9:1 |

以前の `ink-faint` は 3.9:1、`ink-ghost` は 2.3:1 でした。
この2つがセクション見出し・時刻・注釈のほぼすべてを担っていたことが、
「見にくい」の主因でした。

### 部署の色（カテゴリカル）

8部署に8色。**並び順そのものが色覚多様性への安全機構**なので、
`DEPARTMENTS` の順序と対応させたまま、並べ替えてはいけません。

| | 部署 | 色 |
| --- | --- | --- |
| 1 | Strategy | `#3987e5` blue |
| 2 | Engineering | `#d95926` orange |
| 3 | Marketing | `#199e70` aqua |
| 4 | Sales | `#c98500` yellow |
| 5 | Finance | `#d55181` magenta |
| 6 | Research | `#008300` green |
| 7 | Creative | `#9085e9` violet |
| 8 | Operations | `#e66767` red |

このサーフェス上で検証済み: 隣接ペアの最悪 CVD ΔE 8.4 / 通常視 ΔE 19.3、
8色すべて 3:1 以上。変更したら必ず再検証してください。

以前の配色は青・水色・紫が固まっており、
`#A78BFA` と `#4FA8FF` は第二色覚では ΔE 0.9（ほぼ判別不能）、
`#4FA8FF` と `#6C7CFF` は通常視でも ΔE 11.1 しかありませんでした。

**部署名は必ず ink で表示し、色は隣の四角が担います。**
色付きの文字は読みにくく、色だけが手がかりになると識別できない人が出ます。
この規則は `DepartmentTag` に集約してあるので、全画面で自動的に守られます。

### ステータスの色

`live` / `warn` / `danger` / `info` は状態専用で、カテゴリカル色には使いません。
必ずラベルを伴い、色だけで意味を伝えません。
稼働中の状態（Working / Thinking / Researching / Coding / Writing / Designing）は
寒色系でまとめ、CEOの対応が要る状態（Waiting / Needs Approval / Error）だけを
意図的に外しています。

### グラフ

- 2系列以上には必ず凡例を付ける
- 線は 2px、棒の端は 4px 角丸、ホバーの点は 4px + サーフェス色の縁取り
- 軸ラベルは `ink-faint`（以前は 3.9:1 で実質読めませんでした）
- 部署別の完了数は横棒にして部署名を省略せず表示

---

## AI社員は実際に何をするのか

LIVE では、CEOの指示は本物のAI社員の実行になります。

```
CEO「Re-Paletteの提携候補を調査して」
   ↓
COO が起動                         Claude API / claude-opus-5
   ↓
  log_progress                     ダッシュボードに進捗が出る
  get_company_data                 実際のタスク・部署・分析データを読む
  search_knowledge                 社内の記録を先に当たる
   ↓
  delegate → Research Director     本物のサブ実行が立ち上がる
       ↓
       web_search / web_fetch      実際にWebを検索し、ページを読む
       get_company_data            社内データと突き合わせる
       → 結果をCOOへ返す
   ↓
  request_ceo_approval             外部送信が必要 → ここで実行が止まる
   ↓
CEOが Approve
   ↓
止まっていたAI社員が、中断した地点から続きを実行する
```

### AI社員が使えるツール

| ツール | 実体 |
| --- | --- |
| `web_search` / `web_fetch` | Anthropicのサーバーツール。実際にWebを検索し取得する |
| `code_execution` | Anthropicのサーバーツール。実際にコードを実行して計算する |
| `get_company_data` | タスク・プロジェクト・部署・AI社員・分析データの読み取り |
| `search_knowledge` / `save_knowledge` | Knowledge Center の検索と追記 |
| `create_task` / `complete_task` | 実際のタスクボードの更新 |
| `delegate` | 他のAI社員を実行し、結果を受け取る |
| `request_ceo_approval` | 実行を停止してCEOの判断を待つ |
| `submit_report` | レポートを提出し、PDFを生成して確認待ちに入れる |
| `read_email` | Gmailの実際の受信箱を検索して読む（Google連携時） |
| `send_email` | 完成した文面をCEOの承認に回す。送信はサーバーが行う（Google連携時） |
| `list_calendar_events` | Googleカレンダーの実際の空きを確認する（Google連携時） |
| `create_calendar_event` | 予定を作成する。招待つきはCEO承認（Google連携時） |
| `write_note_article` | note記事を書き、文書ファイルとして保存する |

Web検索の動的フィルタリングは内部でコード実行を使うため、
同じAI社員に両方を渡すことはしません。担当領域に応じてどちらかを割り当てます。

### 守らせていること

- 外部送信・SNS公開・支出・契約・本番反映・外部サービス接続は、
  system prompt で禁止したうえで `request_ceo_approval` を必ず経由させます。
  承認前に実行する迂回路はツール側にも存在しません。
- **取り消せない操作は、モデルが引き金を持ちません。** `send_email` を呼んでも
  メールは送信されず、文面がそのまま承認待ちに入って実行が停止します。
  承認後に送信するのはサーバーで、使われるのは申請時に記録された内容
  ——つまりCEOが画面で読んだものそのものです。モデルがあとから何を言っても、
  送られる中身は変わりません。却下すればGoogleには何も届きません。
- 会社の数値に触れる前に必ずデータを読ませます。読めなかった項目は
  その旨を書くよう指示しています。
- 1回の実行のステップ数と委譲数に上限を設けています（既定 24 / 5）。

### 実行状態

`Agent Runs` パネル（Command Center / Activity）に、どのAI社員が今動いていて、
どのツールを何回呼び、何ステップ進み、いくらトークンを使ったかが出ます。
失敗した実行はエラー内容をそのまま表示します。

---

## Google 連携（Gmail / Calendar）

OAuthクライアント1つで Gmail と Calendar の両方が繋がり、8名のAI社員が
実際の受信箱とカレンダーを扱えるようになります。

| AI社員 | Gmail | Calendar |
| --- | :-: | :-: |
| COO | | ● |
| CSO | ● | |
| Executive Assistant | ● | ● |
| Schedule AI | ● | ● |
| Personal Assistant AI | ● | ● |
| Outreach AI | ● | |
| Partnership AI | ● | |
| Lifecycle AI | ● | |

誰がどのツールを持つかは Agent Registry の `tools` がそのまま反映されます。
レジストリに `email` を足せば、そのAI社員は次の実行から受信箱を読み始めます。

### 設定

```bash
npm run google-auth
```

ブラウザで許可すると、`.env.local` に貼る3行が表示されます。
事前に Google Cloud Console で Gmail API と Google Calendar API を有効化し、
OAuth クライアントID（デスクトップアプリ）を作成しておいてください。
Settings 画面の Integrations パネルに同じ手順があります。

必要なスコープは3つだけです。

| スコープ | 用途 |
| --- | --- |
| `gmail.readonly` | 受信箱の検索と閲覧 |
| `gmail.send` | 承認後の送信 |
| `calendar.events` | 予定の確認と作成 |

設定しなければ該当のツールは配布されず、他の機能はそのまま動きます。

### 何が自動で、何が止まるか

| 操作 | 実行 |
| --- | --- |
| 受信メールの検索・閲覧 | そのまま実行 |
| カレンダーの空き確認 | そのまま実行 |
| 自分だけの予定を入れる | そのまま実行（取り消せる・誰も見ない） |
| **メール送信** | **CEO承認。文面がそのまま承認カードに載る** |
| **招待つきの予定作成** | **CEO承認（Googleが相手に招待メールを送るため）** |

承認カードには宛先・件名・本文が実物のまま表示されます。要約ではありません。

---

## note への記事投稿

Content AI が**毎日17:00（JST）に記事を1本**書きます。
CMO と Social Media AI も同じツールを使えます。
`note` は Agent Registry の capability なので、他のAI社員に持たせるなら
レジストリに1行足すだけです。

### なぜ「文書ファイル」なのか

**note には記事投稿の公式APIがありません。**
非公開エンドポイントを叩く方法は存在しますが、予告なく変わります。
そこで既定では **note に一切接続せず**、書き上がった記事を
Markdown の文書ファイルとして保存します。

```
毎日 17:00 JST
   ↓
Content AI が社内ナレッジと会社の実データを読んで記事を書く
   ↓
.friday/note-drafts/2026-09-22-<タイトル>.md   ← 文書ファイル
   ↓
NOTE DRAFTS 画面に「未投稿」として並ぶ + CEOに通知
   ↓ CEO
コピーして note に貼り付け → 「投稿済みにする」
```

壊れる部分がありません。AI社員の仕事は完成原稿までで、投稿はCEOのものです。

### NOTE DRAFTS 画面

サイドバーの **NOTE DRAFTS** に未投稿件数がバッジで出ます。

- タイトルと本文を**別々にコピー**（note の入力欄が2つあるため）
- `.md` をダウンロード
- 「今すぐ書く」で17:00を待たずに生成
- 投稿したら「投稿済みにする」。バッジが減ります

ファイルの中身は、そのまま読めて、そのまま貼れる形です。

```markdown
# AIだけの会社を、ひとりで経営するということ

## はじめに
...

---

タグ: #AI #経営 #スタートアップ
作成: Content AI / 更新: 2026-09-22 17:00 JST
```

### 17:00 に確実に動かす

ジョブは**JSTの日付で重複排除**されます。何度叩いても1日1回しか実行されません。
だから発火させる経路を複数持てます。

| 経路 | いつ |
| --- | --- |
| `vercel.json` の cron | 08:00 UTC = 17:00 JST |
| ダッシュボードのポーリング | 開いている間、3分ごと |
| NOTE DRAFTS の「今すぐ書く」 | 手動 |
| `curl localhost:3000/api/cron` | 手動 |

時刻は `NOTE_DAILY_DRAFT_AT`（JST・既定 17:00）で変えられます。
本番で `/api/cron` を保護するなら `CRON_SECRET` を設定してください
（Vercel Cron は自動で付与します）。

### note に直接保存したい場合

`NOTE_OUTPUT` を切り替えると、note の非公開エンドポイントを使います。
**予告なく変わる可能性があり、自分のアカウントに自分の記事を投稿する用途に限ってください。**

| `NOTE_OUTPUT` | 動作 |
| --- | --- |
| `file`（既定） | 文書ファイルに保存。note には接続しない |
| `draft` | note に非公開の下書きを保存。公開はCEOが note 上で手動 |
| `publish` | CEOが承認したらサーバーが note に公開 |

`file` 以外には `NOTE_AUTH_TOKEN`（note.com の `note_gql_auth_token` cookie）が要ります。
実装は仕様変更を前提にしていて、想定外の応答が返ったらそこで止まります。
空の記事が静かに公開されることはありません。

### Markdown の変換

AI社員は Markdown で書きます。`draft` / `publish` では note の editor が保存する
HTML に変換し、note が実際に描画する範囲だけを出力します。

| 書いたもの | note |
| --- | --- |
| `#` `##` | 大見出し |
| `###` 以下 | 小見出し |
| `- ` | 箇条書き |
| `> ` | 引用 |
| `**強調**` / `[文字](URL)` | 強調 / リンク |

対応外の記法は段落に落とすので、`**` がそのまま記事に出ることはありません。

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

## 保存先

会社の状態（活動ログ・タスク・レポート・承認・note下書き・実行履歴）は
2つの保存先のどちらかに入ります。同じ形なので、切り替えても動作は変わりません。

| | 条件 | 保存先 | 生き残るか |
| --- | --- | --- | --- |
| **Supabase** | `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` がある | `work_state` テーブルの1行 | ✅ どこでも |
| **ファイル** | 未設定 | `.friday/work-state.json` | サーバーなら ✅ / サーバーレスは ❌ |

**サーバーレスでは Supabase が必須です。** Vercel の関数は書き込める場所が `/tmp`
だけで、そこは実行インスタンスごとに分かれ、コールドスタートで消えます。
17:00 に書いた記事を、別のインスタンスが受けた次のリクエストでは読めません。

### なぜ1行なのか

既存の呼び出し側は状態オブジェクトを同期的に書き換えます。テーブルに分割すると
その全てを書き直すことになるため、**1行に丸ごと入れて、リクエストの入口で読み、
出口で書き戻す**形にしました（`withState()`）。下流のコードは一切変えていません。

### 同時書き込み

`version` 列で楽観ロックしています。書き込み時に読んだバージョンを指定し、
行が進んでいれば0行更新になります。そのときは**相手の状態を読み直してマージ**し、
もう一度書きます。マージはid単位の和集合なので、夜のジョブとCEOの操作が
ぶつかっても、どちらかの成果が黙って消えることはありません。

- 読み取りは `read()`、書き込みは `mutate()` と分けてあります。
  ダッシュボードは数秒ごとにポーリングするため、読むだけで行を書いてしまうと
  AI社員の書き込みと競合し続けます。

### セキュリティ

`work_state` は RLS 有効・ポリシーなしです。到達できるのは RLS を迂回する
service_role キーを持つサーバーだけで、ブラウザにキーは渡りません。

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

2種類あります。

**Daily Executive Report** — 設定した時刻（既定 22:00 JST）を会社時計が越えた時点で
生成されます。クライアント側の会社時計で動くため、ダッシュボードを開いている必要があります。
すぐ確認したい場合は Report Center の Generate から手動実行できます。

**日次note記事** — サーバー側のジョブです（既定 17:00 JST）。
`/api/cron` が入口で、ジョブはJSTの日付で重複排除されるため、
何度叩いても1日1回しか実行されません。だから発火経路を複数持てます。

| 経路 | いつ |
| --- | --- |
| `vercel.json` の cron | 08:00 UTC = 17:00 JST |
| ダッシュボードのポーリング | 開いている間、3分ごと |
| NOTE DRAFTS の「今すぐ書く」 | 手動 |
| `curl localhost:3000/api/cron` | 手動 |

実行履歴は work state の `jobs` に残ります。

---

## 会社時計について

サーバーとクライアントで同じHTMLを描画するため、シード値の時刻は
`src/lib/time.ts` の `SEED_NOW`（2026-09-21 16:42 JST）を基準にした相対オフセットで定義し、
マウント後にリアルタイムで進行します。時刻表示はすべて Asia/Tokyo 固定です。

---

## レスポンシブ

PC最優先。1440 / 1920 / 2560px で情報密度が最大化されるよう設計しています。
右パネルは xl 未満ではオーバーレイとして開閉し、モバイルでは簡易版を表示します。
