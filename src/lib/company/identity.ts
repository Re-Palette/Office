/**
 * Who this company actually is.
 *
 * Every AI employee was writing about a company it had never been told the
 * name of. The agent prompts described a department and a job; nothing said
 * what ARQO does, so anything an employee wrote about the company itself was
 * invention. This file is the single source of that truth, and it is injected
 * into every agent's system prompt.
 *
 * Source: the company's own homepage (Re-Palette/-ARQO-HP, src/lib/content.ts).
 * Only the copy that site presents as fact is carried over — its news entries
 * are marked dummy there and its contact address is still example.com, so
 * neither appears here. `unknown` below is deliberate: an employee that reads
 * "まだ決まっていない" asks the CEO instead of filling the gap itself.
 */

export const COMPANY = {
  name: "ARQO",
  legalName: "ARQO Inc.",
  site: "https://arqo-hp.vercel.app",
  mission: "人と可能性の間に架け橋をつくる。",
  missionEn: "Building bridges between people and possibility.",
  vision: "美容・教育・コミュニティ・テクノロジーで、誰もが自分らしく生きられる社会をつくる。",
  positioning:
    "美容・教育・コミュニティ・テクノロジーの4つの事業を通じて、" +
    "一人ひとりが新しい一歩を踏み出せる機会を創造するソーシャルベンチャー。",
  ceo: "陽大",
  businesses: [
    { no: "01", name: "Re-Palette", ja: "美容福祉事業", what: "美容を通じて、社会的孤立状態にある若者の社会復帰を支援する。" },
    { no: "02", name: "Education", ja: "教育事業", what: "人の可能性を広げる教育を通じて、未来の選択肢を増やす。" },
    { no: "03", name: "Community & Events", ja: "コミュニティ・イベント事業", what: "人と人がつながり、挑戦し合う場をつくり、新しい価値を生み出す。" },
    { no: "04", name: "AI & Technology", ja: "AI・IT事業", what: "テクノロジーで、教育・美容・福祉の可能性を広げる。" },
  ],
  /** Facts the homepage does not yet state. Nothing here may be guessed. */
  unknown: ["設立年月日", "所在地", "公式の問い合わせ先", "資本金", "従業員数"],
} as const;

/**
 * The block every employee sees. Kept short on purpose: it rides in the cached
 * part of the system prompt, so it is read on every single run by all 48
 * employees, and length here is a cost paid thousands of times a month.
 */
export function companyBrief(): string {
  const lines = [
    `[COMPANY] ${COMPANY.name}（${COMPANY.legalName}） — ${COMPANY.site}`,
    `ミッション: ${COMPANY.mission}（${COMPANY.missionEn}）`,
    `ビジョン: ${COMPANY.vision}`,
    `事業: ${COMPANY.positioning}`,
    ...COMPANY.businesses.map((b) => `  ${b.no} ${b.name}／${b.ja} — ${b.what}`),
    `CEO: ${COMPANY.ceo}`,
    `まだ公表していない情報（推測で書かない・必要ならCEOに確認する）: ${COMPANY.unknown.join("・")}`,
  ];
  return lines.join("\n");
}
