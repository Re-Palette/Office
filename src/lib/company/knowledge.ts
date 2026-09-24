import type { KnowledgeDoc } from "@/lib/types";
import { ago, days, hours, minutes } from "@/lib/time";

export const KNOWLEDGE: KnowledgeDoc[] = [
  { id: "k-1", title: "Company Operating Principles", category: "ceo_instructions", owner: "coo", updatedAt: ago(days(3)), excerpt: "結論から報告する。選択肢は3案以内。不可逆な行動は必ずCEO承認を経由する。", tags: ["core", "policy"] },
  { id: "k-2", title: "CEO Standing Instructions", category: "ceo_instructions", owner: "chief_of_staff", updatedAt: ago(hours(6)), excerpt: "意思決定のスピードを最優先。朝は判断事項から、夜は成果から報告すること。", tags: ["ceo", "policy"] },
  { id: "k-3", title: "Re-Palette Brand Guidelines", category: "brand", owner: "brand_ai", updatedAt: ago(hours(2)), excerpt: "トーンは知的・上品・押し付けない。彩度の高い表現と誇張表現は使用しない。", tags: ["brand", "re-palette"] },
  { id: "k-4", title: "Re-Palette Tone of Voice", category: "brand", owner: "copy_ai", updatedAt: ago(days(4)), excerpt: "一人称は使わない。断定より提案。専門用語は必ず言い換えを添える。", tags: ["copy", "brand"] },
  { id: "k-5", title: "F.R.I.D.A.Y. Architecture Overview", category: "technical", owner: "cto", updatedAt: ago(minutes(90)), excerpt: "Next.js / TypeScript / Tailwind / Supabase。Agent Layer は Orchestrator 経由で疎結合に接続する。", tags: ["architecture", "friday"] },
  { id: "k-6", title: "Agent Registry Specification", category: "technical", owner: "backend_ai", updatedAt: ago(hours(5)), excerpt: "AI社員は id / role / department / skills / tools / permissions で定義され、UIへ自動反映される。", tags: ["agents", "spec"] },
  { id: "k-7", title: "Approval Gate Policy", category: "technical", owner: "risk_ai", updatedAt: ago(days(2)), excerpt: "送信・公開・課金・本番反映の4系統は例外なくCEO承認を必要とする。", tags: ["security", "policy"] },
  { id: "k-8", title: "美容業界 市場規模レポート 2026", category: "research", owner: "market_ai", updatedAt: ago(minutes(45)), excerpt: "国内市場は前年比+4.2%。サステナビリティ関連セグメントが最も高い成長率を示す。", tags: ["market", "re-palette"] },
  { id: "k-9", title: "競合3社 動向トラッキング", category: "research", owner: "competitor_ai", updatedAt: ago(minutes(70)), excerpt: "A社は新規事業に向けた採用を開始。B社は価格改定。C社は目立った動きなし。", tags: ["competitor"] },
  { id: "k-10", title: "Z世代のコスメ消費行動", category: "research", owner: "trend_ai", updatedAt: ago(hours(3)), excerpt: "情報接触はSNS起点が78%。購買前の平均接触回数は5.4回。", tags: ["trend", "newtone"] },
  { id: "k-11", title: "Instagram トレンド分析 2026-09", category: "reports", owner: "cmo", updatedAt: ago(minutes(5)), excerpt: "保存率の高い投稿は3週間後の流入に寄与。トレンド候補12件を抽出。", tags: ["marketing", "re-palette"] },
  { id: "k-12", title: "Weekly Board Meeting — Week 37", category: "reports", owner: "minutes_ai", updatedAt: ago(days(1)), excerpt: "決定事項6件。NEWTONE 2027 を来週の最優先プロジェクトへ指定。", tags: ["board", "minutes"] },
  { id: "k-13", title: "Daily Executive Report — 09/20", category: "reports", owner: "coo", updatedAt: ago(days(1)), excerpt: "完了48件。認証基盤80%到達。提携候補の母数が充足。", tags: ["daily"] },
  { id: "k-14", title: "Re-Palette Project Charter", category: "projects", owner: "cmo", updatedAt: ago(days(6)), excerpt: "今期の最重要プロジェクト。目標は認知3倍と提携3社の確定。", tags: ["re-palette", "charter"] },
  { id: "k-15", title: "NEWTONE 2027 運営計画", category: "projects", owner: "biz_dev", updatedAt: ago(days(2)), excerpt: "全国の学生美容ブランドを集めたPOPUPストア。出展20組・来場目標800名・損益分岐620名。出展確保が来場集客に先行する二面市場。", tags: ["newtone"] },
  { id: "k-16", title: "大学出願 スケジュール", category: "projects", owner: "assistant_ai", updatedAt: ago(hours(1)), excerpt: "提出期限から逆算した日割り作業計画。活動実績の整理が最優先。", tags: ["university"] },
  { id: "k-17", title: "Company Memory — CEO Preferences", category: "memory", owner: "knowledge_ai", updatedAt: ago(minutes(120)), excerpt: "長文より構造。装飾より情報密度。夜間の通知は重要度: 高のみ。", tags: ["memory", "ceo"] },
  { id: "k-18", title: "Company Memory — Past Decisions", category: "memory", owner: "knowledge_ai", updatedAt: ago(days(5)), excerpt: "過去の意思決定と、その後の結果を対にして保存。同種の判断時に参照する。", tags: ["memory"] },
  { id: "k-19", title: "提携提案書 テンプレート v3", category: "documents", owner: "partnership_ai", updatedAt: ago(hours(4)), excerpt: "提携スキーム・双方の利得・初手のアクションを1枚で示す構成。", tags: ["sales", "template"] },
  { id: "k-20", title: "SaaS 契約一覧と利用状況", category: "documents", owner: "cost_ai", updatedAt: ago(hours(7)), excerpt: "契約14件。うち2件が機能重複。月額¥31,000の削減余地。", tags: ["finance"] },
  // Real company facts, taken from the company homepage. These are the only
  // company-level statements an employee may repeat as fact.
  { id: "k-21", title: "ARQO 会社概要", category: "brand", owner: "chief_of_staff", updatedAt: ago(hours(1)), excerpt: "ARQO Inc.。ミッションは「人と可能性の間に架け橋をつくる。」美容・教育・コミュニティ・テクノロジーの4事業を持つソーシャルベンチャー。", tags: ["company", "arqo", "brand"] },
  { id: "k-22", title: "ARQO 4事業の定義", category: "brand", owner: "coo", updatedAt: ago(hours(1)), excerpt: "01 Re-Palette（美容福祉）/ 02 Education（教育）/ 03 Community & Events / 04 AI & Technology。Re-Palette は美容を通じた孤立状態の若者の社会復帰支援。", tags: ["company", "arqo", "re-palette"] },
  // NEWTONE 2027 — what the project actually is, and what it inherits from
  // Re-Palette's own record. The numbers here were measured, not assumed.
  { id: "k-24", title: "NEWTONE 2027 コンセプト", category: "projects", owner: "coo", updatedAt: ago(hours(2)), excerpt: "全国の学生美容ブランドが一堂に出展するPOPUPストア。学生がつくったものを学生が売り、学生が買う場。出展ブランドの顔ぶれ自体が集客の中身になる。", tags: ["newtone", "charter"] },
  { id: "k-25", title: "NEWTONE 出展条件と法令チェック", category: "projects", owner: "risk_ai", updatedAt: ago(hours(3)), excerpt: "化粧品販売には製造販売業者名・全成分の表示義務。学生ブランドはOEMが多く表示不備が起きやすい。効能効果の逸脱表現も出展前に確認する。1組の不備が会全体を止める。", tags: ["newtone", "risk", "policy"] },
  { id: "k-26", title: "Nuance Lounge 第1回 実施結果", category: "reports", owner: "coo", updatedAt: ago(days(2)), excerpt: "2026年7月5日、株式会社TOMAPオフィスにて開催。中学生から大人まで参加。満足度4.6/5、「普段話せない悩みを安心して話せたか」4.4/5。日本美容福祉学会理事・現役美容師も参加。", tags: ["re-palette", "newtone", "proof"] },
  { id: "k-27", title: "伴走型整容教育 プログラム設計", category: "projects", owner: "user_research", updatedAt: ago(days(3)), excerpt: "①参加前アンケート ②アイスブレイク＋メンタリング ③伴走型施術（再現できるようレクチャー） ④交流会 ⑤参加後アンケート＋個別カード発行。前後比較で自己効力感の変化を測る。", tags: ["re-palette", "program"] },
  { id: "k-28", title: "Re-Palette 対外実績サマリ", category: "brand", owner: "knowledge_ai", updatedAt: ago(hours(4)), excerpt: "2025年8月設立。未来クリエイターズアワード2025 敢闘賞。MY PROJECT AWARD 地域Summit出場。TOKYO STARTUP GATEWAY U-18 LAB 三期生。Sushi Tech Tokyo 2026 ITAMAE Gold Rank。MIRAI CREATOR'Z 2026 福祉・介護部門 選出。", tags: ["re-palette", "credibility"] },
  { id: "k-23", title: "ARQO 未公表情報リスト", category: "brand", owner: "risk_ai", updatedAt: ago(hours(1)), excerpt: "設立年月日・所在地・問い合わせ先・資本金・従業員数は未公表。記事や対外文書でこれらに触れない。推測で補わない。", tags: ["company", "policy", "risk"] },
];

export const KNOWLEDGE_CATEGORIES: { id: KnowledgeDoc["category"]; label: string }[] = [
  { id: "documents", label: "Documents" },
  { id: "projects", label: "Projects" },
  { id: "research", label: "Research" },
  { id: "reports", label: "Reports" },
  { id: "memory", label: "Company Memory" },
  { id: "ceo_instructions", label: "CEO Instructions" },
  { id: "brand", label: "Brand Guidelines" },
  { id: "technical", label: "Technical Docs" },
];
