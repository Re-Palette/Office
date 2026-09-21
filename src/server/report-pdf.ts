import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  rgb,
  type RGB,
} from "pdf-lib";
import { AGENTS_BY_ID } from "@/lib/company/agents";
import { DEPARTMENTS } from "@/lib/company/departments";
import { PROJECTS_BY_ID } from "@/lib/company/projects";
import { REPORT_STATUS } from "@/lib/status";
import { formatDate, formatTime } from "@/lib/time";
import { REPORT_TYPE_LABEL, type Report } from "@/lib/types";
import { isCovered } from "./font-coverage";

/* ── Page geometry (A4) ───────────────────────────────────────────────────── */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 54;
const MARGIN_TOP = 64;
const MARGIN_BOTTOM = 62;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

/* ── Print palette ────────────────────────────────────────────────────────── */

const C = {
  ink: rgb(0.08, 0.09, 0.1),
  body: rgb(0.22, 0.24, 0.27),
  muted: rgb(0.42, 0.45, 0.5),
  faint: rgb(0.58, 0.61, 0.66),
  rule: rgb(0.89, 0.9, 0.92),
  ruleSoft: rgb(0.95, 0.955, 0.96),
  accent: rgb(0.29, 0.35, 0.84),
  accentSoft: rgb(0.93, 0.94, 0.99),
  green: rgb(0.11, 0.6, 0.42),
  greenSoft: rgb(0.92, 0.97, 0.95),
  amber: rgb(0.72, 0.47, 0.11),
  amberSoft: rgb(0.99, 0.96, 0.9),
  red: rgb(0.77, 0.23, 0.28),
  redSoft: rgb(0.99, 0.94, 0.94),
  cover: rgb(0.051, 0.055, 0.063),
  coverInk: rgb(0.95, 0.96, 0.97),
  coverMuted: rgb(0.55, 0.58, 0.63),
  white: rgb(1, 1, 1),
};

/* ── Fonts ────────────────────────────────────────────────────────────────── */

const FONT_DIR = path.join(process.cwd(), "src", "assets", "fonts");

let fontCache: { regular: Uint8Array; bold: Uint8Array } | null = null;

function loadFontBytes() {
  if (!fontCache) {
    fontCache = {
      regular: new Uint8Array(readFileSync(path.join(FONT_DIR, "NotoSansJP-Regular.ttf"))),
      bold: new Uint8Array(readFileSync(path.join(FONT_DIR, "NotoSansJP-Bold.ttf"))),
    };
  }
  return fontCache;
}

/* ── Layout helpers ───────────────────────────────────────────────────────── */

/**
 * Width-based wrapping that works for Japanese (which has no spaces) and for
 * Latin (which must not break mid-word). Applies the basic kinsoku rule that a
 * line may not begin with closing punctuation.
 */
const NO_LINE_START = "、。，．）」』】〕〉》’”?!？！ー々ゝゞぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ:;,.";
const LATIN = /[A-Za-z0-9@#$%&'"()[\]{}<>+=_\-/\\.:;!?]/;

/** Replaces anything outside the embedded fonts so it cannot render blank. */
function sanitize(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    out += cp === 0x0a || isCovered(cp) ? ch : "\u3013";
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text) return [];
  const paragraphs = sanitize(text).split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    let line = "";
    let latinRun = "";

    const flushRunInto = (candidate: string) => candidate;

    for (const ch of paragraph) {
      // Keep Latin words intact by buffering them until a boundary.
      if (LATIN.test(ch)) {
        latinRun += ch;
        continue;
      }
      if (latinRun) {
        const merged = flushRunInto(line + latinRun);
        if (font.widthOfTextAtSize(merged, size) > maxWidth && line) {
          lines.push(line);
          line = latinRun;
        } else {
          line = merged;
        }
        latinRun = "";
      }

      const next = line + ch;
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
        if (NO_LINE_START.includes(ch)) {
          // Pull the punctuation onto the current line rather than orphaning it.
          lines.push(next);
          line = "";
        } else {
          lines.push(line);
          line = ch;
        }
      } else {
        line = next;
      }
    }

    if (latinRun) {
      const merged = line + latinRun;
      if (font.widthOfTextAtSize(merged, size) > maxWidth && line) {
        lines.push(line);
        line = latinRun;
      } else {
        line = merged;
      }
    }
    lines.push(line);
  }

  return lines;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** Cursor-based document builder with automatic pagination. */
class Doc {
  page!: PDFPage;
  y = 0;
  pageNumber = 0;
  readonly bodyPages: PDFPage[] = [];

  constructor(
    private readonly pdf: PDFDocument,
    private readonly fonts: Fonts,
    private readonly report: Report,
  ) {}

  newPage() {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.bodyPages.push(this.page);
    this.pageNumber += 1;
    this.y = PAGE_H - MARGIN_TOP;
    this.runningHead();
    return this.page;
  }

  private runningHead() {
    const { regular } = this.fonts;
    const label = `${REPORT_TYPE_LABEL[this.report.type]} · ${this.report.content.period}`;
    this.page.drawText(sanitize(label), {
      x: MARGIN_X,
      y: PAGE_H - 38,
      size: 7.5,
      font: regular,
      color: C.faint,
    });
    const mark = "F.R.I.D.A.Y. AI COMPANY OS";
    this.page.drawText(sanitize(mark), {
      x: PAGE_W - MARGIN_X - regular.widthOfTextAtSize(mark, 7.5),
      y: PAGE_H - 38,
      size: 7.5,
      font: regular,
      color: C.faint,
    });
    this.page.drawRectangle({
      x: MARGIN_X,
      y: PAGE_H - 48,
      width: CONTENT_W,
      height: 0.6,
      color: C.rule,
    });
  }

  ensure(height: number) {
    if (this.y - height < MARGIN_BOTTOM) this.newPage();
  }

  gap(h: number) {
    this.y -= h;
  }

  /** Draws wrapped text and advances the cursor, paginating as needed. */
  text(
    content: string,
    opts: {
      size?: number;
      bold?: boolean;
      color?: RGB;
      leading?: number;
      x?: number;
      width?: number;
      indent?: number;
    } = {},
  ) {
    const size = opts.size ?? 9.5;
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    const color = opts.color ?? C.body;
    const leading = opts.leading ?? size * 1.75;
    const x = opts.x ?? MARGIN_X;
    const width = opts.width ?? CONTENT_W - (opts.indent ?? 0);

    for (const line of wrap(content, font, size, width)) {
      this.ensure(leading);
      this.page.drawText(sanitize(line), {
        x: x + (opts.indent ?? 0),
        y: this.y - size,
        size,
        font,
        color,
      });
      this.y -= leading;
    }
  }

  sectionTitle(label: string, index?: number) {
    this.ensure(56);
    this.gap(14);
    const { bold, regular } = this.fonts;

    if (index !== undefined) {
      const num = String(index).padStart(2, "0");
      this.page.drawText(sanitize(num), {
        x: MARGIN_X,
        y: this.y - 10,
        size: 10,
        font: bold,
        color: C.accent,
      });
    }
    this.page.drawText(sanitize(label.toUpperCase()), {
      x: MARGIN_X + (index !== undefined ? 24 : 0),
      y: this.y - 10,
      size: 10,
      font: bold,
      color: C.ink,
    });
    this.y -= 18;
    this.page.drawRectangle({
      x: MARGIN_X,
      y: this.y,
      width: CONTENT_W,
      height: 0.8,
      color: C.rule,
    });
    void regular;
    this.y -= 12;
  }

  bullet(text: string, opts: { color?: RGB; marker?: string; size?: number } = {}) {
    const size = opts.size ?? 9.5;
    const leading = size * 1.75;
    const marker = opts.marker ?? "•";
    this.ensure(leading);
    this.page.drawText(sanitize(marker), {
      x: MARGIN_X + 2,
      y: this.y - size,
      size,
      font: this.fonts.regular,
      color: opts.color ?? C.faint,
    });
    this.text(text, { indent: 16, size });
  }

  keyValueRow(label: string, value: string) {
    const leading = 16;
    this.ensure(leading);
    this.page.drawText(sanitize(label), {
      x: MARGIN_X,
      y: this.y - 9,
      size: 8.5,
      font: this.fonts.regular,
      color: C.muted,
    });
    const lines = wrap(value, this.fonts.regular, 8.5, CONTENT_W - 150);
    this.page.drawText(sanitize(lines[0] ?? ""), {
      x: MARGIN_X + 150,
      y: this.y - 9,
      size: 8.5,
      font: this.fonts.bold,
      color: C.ink,
    });
    this.y -= leading;
    for (const extra of lines.slice(1)) {
      this.ensure(leading);
      this.page.drawText(sanitize(extra), {
        x: MARGIN_X + 150,
        y: this.y - 9,
        size: 8.5,
        font: this.fonts.regular,
        color: C.ink,
      });
      this.y -= leading;
    }
  }

  footers(total: number) {
    const { regular } = this.fonts;
    this.bodyPages.forEach((page, i) => {
      const label = `${i + 1} / ${total}`;
      page.drawRectangle({
        x: MARGIN_X,
        y: MARGIN_BOTTOM - 18,
        width: CONTENT_W,
        height: 0.6,
        color: C.ruleSoft,
      });
      page.drawText("CONFIDENTIAL · CEO EYES ONLY", {
        x: MARGIN_X,
        y: MARGIN_BOTTOM - 32,
        size: 7,
        font: regular,
        color: C.faint,
      });
      page.drawText(sanitize(label), {
        x: PAGE_W - MARGIN_X - regular.widthOfTextAtSize(label, 7),
        y: MARGIN_BOTTOM - 32,
        size: 7,
        font: regular,
        color: C.faint,
      });
    });
  }
}

/* ── Drawing primitives ───────────────────────────────────────────────────── */

function chip(
  page: PDFPage,
  font: PDFFont,
  raw: string,
  x: number,
  y: number,
  fill: RGB,
  ink: RGB,
) {
  const text = sanitize(raw);
  const size = 7.5;
  const w = font.widthOfTextAtSize(text, size) + 14;
  page.drawRectangle({ x, y: y - 3, width: w, height: 15, color: fill });
  page.drawText(sanitize(text), { x: x + 7, y: y + 1.5, size, font, color: ink });
  return w;
}

function metricCards(doc: Doc, fonts: Fonts, metrics: Report["content"]["keyMetrics"]) {
  const perRow = 3;
  const gutter = 10;
  const cardW = (CONTENT_W - gutter * (perRow - 1)) / perRow;
  const cardH = 54;

  for (let i = 0; i < metrics.length; i += perRow) {
    const row = metrics.slice(i, i + perRow);
    doc.ensure(cardH + 10);
    const top = doc.y;

    row.forEach((m, j) => {
      const x = MARGIN_X + j * (cardW + gutter);
      doc.page.drawRectangle({
        x,
        y: top - cardH,
        width: cardW,
        height: cardH,
        color: C.white,
        borderColor: C.rule,
        borderWidth: 0.8,
      });
      doc.page.drawRectangle({
        x,
        y: top - cardH,
        width: 2.5,
        height: cardH,
        color: C.accent,
      });

      const label = wrap(m.label.toUpperCase(), fonts.regular, 7, cardW - 26)[0] ?? m.label;
      doc.page.drawText(sanitize(label), {
        x: x + 12,
        y: top - 18,
        size: 7,
        font: fonts.regular,
        color: C.muted,
      });
      doc.page.drawText(sanitize(m.value), {
        x: x + 12,
        y: top - 40,
        size: 15,
        font: fonts.bold,
        color: C.ink,
      });
      if (m.delta) {
        const vw = fonts.bold.widthOfTextAtSize(m.value, 15);
        doc.page.drawText(sanitize(m.delta), {
          x: x + 12 + vw + 6,
          y: top - 38,
          size: 8,
          font: fonts.regular,
          color: m.positive === false ? C.red : C.green,
        });
      }
    });

    doc.y = top - cardH - gutter;
  }
}

function progressBar(doc: Doc, x: number, width: number, value: number, color: RGB) {
  doc.page.drawRectangle({ x, y: doc.y - 6, width, height: 3.5, color: C.rule });
  doc.page.drawRectangle({
    x,
    y: doc.y - 6,
    width: (width * Math.max(0, Math.min(100, value))) / 100,
    height: 3.5,
    color,
  });
}

/* ── Cover ────────────────────────────────────────────────────────────────── */

function drawCover(pdf: PDFDocument, fonts: Fonts, report: Report) {
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: C.cover });

  // Accent hairline down the left edge.
  page.drawRectangle({ x: 0, y: 0, width: 3, height: PAGE_H, color: C.accent });

  page.drawText("F.R.I.D.A.Y.", {
    x: MARGIN_X,
    y: PAGE_H - 92,
    size: 13,
    font: fonts.bold,
    color: C.coverInk,
  });
  page.drawText("AI COMPANY OS", {
    x: MARGIN_X,
    y: PAGE_H - 108,
    size: 7.5,
    font: fonts.regular,
    color: C.coverMuted,
  });

  const status = REPORT_STATUS[report.status];
  chip(
    page,
    fonts.bold,
    status.label,
    MARGIN_X,
    PAGE_H - 190,
    rgb(0.13, 0.14, 0.16),
    C.coverInk,
  );

  page.drawText(sanitize(REPORT_TYPE_LABEL[report.type].toUpperCase()), {
    x: MARGIN_X,
    y: PAGE_H - 232,
    size: 8,
    font: fonts.regular,
    color: C.accent,
  });

  // Title, wrapped.
  let y = PAGE_H - 262;
  for (const line of wrap(report.title, fonts.bold, 26, CONTENT_W - 40)) {
    page.drawText(sanitize(line), { x: MARGIN_X, y: y - 26, size: 26, font: fonts.bold, color: C.coverInk });
    y -= 36;
  }

  y -= 6;
  for (const line of wrap(report.content.subtitle, fonts.regular, 11, CONTENT_W - 60)) {
    page.drawText(sanitize(line), { x: MARGIN_X, y: y - 11, size: 11, font: fonts.regular, color: C.coverMuted });
    y -= 18;
  }

  // Metadata block at the foot of the cover.
  const rows: [string, string][] = [
    ["PREPARED FOR", "陽大 — CEO / Founder"],
    ["PREPARED BY", AGENTS_BY_ID[report.createdBy]?.role ?? report.createdBy],
    ["PERIOD", report.content.period],
    ["SOURCES", `${report.sources.length} AI employees`],
    ["VERSION", `v${report.version}`],
    ["GENERATED", `${formatDate(report.createdAt)} ${formatTime(report.createdAt)} JST`],
  ];

  let ry = 250;
  page.drawRectangle({ x: MARGIN_X, y: ry + 24, width: CONTENT_W, height: 0.8, color: rgb(0.2, 0.21, 0.24) });
  for (const [label, value] of rows) {
    page.drawText(sanitize(label), { x: MARGIN_X, y: ry, size: 7, font: fonts.regular, color: C.coverMuted });
    page.drawText(sanitize(value), { x: MARGIN_X + 130, y: ry, size: 9, font: fonts.bold, color: C.coverInk });
    ry -= 20;
  }

  page.drawText("CONFIDENTIAL · CEO EYES ONLY", {
    x: MARGIN_X,
    y: 58,
    size: 7,
    font: fonts.regular,
    color: C.coverMuted,
  });
}

/* ── Body ─────────────────────────────────────────────────────────────────── */

export async function renderReportPdf(report: Report): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const bytes = loadFontBytes();
  // NOTE: `subset: true` is deliberately not used. @pdf-lib/fontkit's subsetter
  // drops glyph outlines for this font (text extracts correctly but renders
  // blank), so the fonts are pre-subset to JIS X 0208 on disk and embedded as
  // they are. See src/assets/fonts/LICENSE.md.
  const fonts: Fonts = {
    regular: await pdf.embedFont(bytes.regular),
    bold: await pdf.embedFont(bytes.bold),
  };

  pdf.setTitle(report.title);
  pdf.setAuthor(`${AGENTS_BY_ID[report.createdBy]?.role ?? report.createdBy} — F.R.I.D.A.Y. AI Company OS`);
  pdf.setSubject(report.content.subtitle);
  pdf.setProducer("F.R.I.D.A.Y. AI Company OS");
  pdf.setCreator("F.R.I.D.A.Y. AI Company OS");

  drawCover(pdf, fonts, report);

  const doc = new Doc(pdf, fonts, report);
  doc.newPage();
  const c = report.content;
  let n = 1;

  /* 01 Executive Summary */
  doc.sectionTitle("Executive Summary", n++);
  doc.text(c.executiveSummary, { size: 10, leading: 18, color: C.body });

  /* 02 Key Metrics */
  if (c.keyMetrics.length) {
    doc.sectionTitle("Key Metrics", n++);
    metricCards(doc, fonts, c.keyMetrics);
  }

  /* 03 Department Performance */
  if (c.departmentResults.length) {
    doc.sectionTitle("Department Performance", n++);
    for (const d of c.departmentResults) {
      const meta = DEPARTMENTS.find((x) => x.id === d.department);
      doc.ensure(46);
      doc.gap(4);
      doc.page.drawText(sanitize((meta?.label ?? d.department).toUpperCase()), {
        x: MARGIN_X,
        y: doc.y - 9,
        size: 8.5,
        font: fonts.bold,
        color: C.accent,
      });
      if (d.metric) {
        const t = `${d.metric.label}: ${d.metric.value}`;
        doc.page.drawText(sanitize(t), {
          x: PAGE_W - MARGIN_X - fonts.regular.widthOfTextAtSize(t, 8),
          y: doc.y - 9,
          size: 8,
          font: fonts.regular,
          color: C.muted,
        });
      }
      doc.y -= 16;
      doc.text(d.headline, { size: 9.5, color: C.ink });
      for (const p of d.points) doc.bullet(p, { size: 9 });
      doc.gap(6);
    }
  }

  /* 04 Project Progress */
  if (c.projectResults.length) {
    doc.sectionTitle("Project Progress", n++);
    for (const p of c.projectResults) {
      const project = PROJECTS_BY_ID[p.projectId];
      const color = p.health === "on_track" ? C.green : p.health === "at_risk" ? C.amber : C.red;
      doc.ensure(44);
      doc.page.drawText(sanitize(project?.name ?? p.projectId), {
        x: MARGIN_X,
        y: doc.y - 9,
        size: 9.5,
        font: fonts.bold,
        color: C.ink,
      });
      const pct = `${p.progress}%`;
      doc.page.drawText(sanitize(pct), {
        x: PAGE_W - MARGIN_X - fonts.bold.widthOfTextAtSize(pct, 9.5),
        y: doc.y - 9,
        size: 9.5,
        font: fonts.bold,
        color,
      });
      const healthLabel = p.health.replace("_", " ").toUpperCase();
      doc.page.drawText(sanitize(healthLabel), {
        x: PAGE_W - MARGIN_X - fonts.bold.widthOfTextAtSize(pct, 9.5) - 12 -
           fonts.regular.widthOfTextAtSize(healthLabel, 7),
        y: doc.y - 8,
        size: 7,
        font: fonts.regular,
        color,
      });
      doc.y -= 16;
      progressBar(doc, MARGIN_X, CONTENT_W, p.progress, color);
      doc.y -= 12;
      doc.text(p.note, { size: 8.5, color: C.muted });
      doc.gap(6);
    }
  }

  /* 05 Major Achievements */
  if (c.achievements.length) {
    doc.sectionTitle("Major Achievements", n++);
    for (const a of c.achievements) {
      const role = AGENTS_BY_ID[a.agentId]?.role ?? a.agentId;
      doc.ensure(30);
      doc.page.drawText(sanitize(role), {
        x: MARGIN_X,
        y: doc.y - 9,
        size: 8.5,
        font: fonts.bold,
        color: C.accent,
      });
      doc.y -= 14;
      doc.text(a.text, { size: 9, indent: 0 });
      doc.gap(4);
    }
  }

  /* 06 Important Findings */
  if (c.findings.length) {
    doc.sectionTitle("Important Findings", n++);
    for (const f of c.findings) doc.bullet(f, { marker: "—" });
  }

  /* 07 Problems / Risks */
  if (c.risks.length) {
    doc.sectionTitle("Problems / Risks", n++);
    for (const r of c.risks) {
      const [fill, ink, label] =
        r.level === "high"
          ? [C.redSoft, C.red, "HIGH"]
          : r.level === "medium"
            ? [C.amberSoft, C.amber, "MEDIUM"]
            : [C.ruleSoft, C.muted, "LOW"];

      const lines = wrap(r.text, fonts.regular, 9, CONTENT_W - 78);
      const boxH = Math.max(28, lines.length * 15 + 14);
      doc.ensure(boxH + 8);
      doc.page.drawRectangle({
        x: MARGIN_X,
        y: doc.y - boxH,
        width: CONTENT_W,
        height: boxH,
        color: fill,
      });
      doc.page.drawRectangle({
        x: MARGIN_X,
        y: doc.y - boxH,
        width: 2.5,
        height: boxH,
        color: ink,
      });
      doc.page.drawText(sanitize(label), {
        x: MARGIN_X + 12,
        y: doc.y - 18,
        size: 7,
        font: fonts.bold,
        color: ink,
      });
      lines.forEach((line, i) => {
        doc.page.drawText(sanitize(line), {
          x: MARGIN_X + 62,
          y: doc.y - 18 - i * 15,
          size: 9,
          font: fonts.regular,
          color: C.body,
        });
      });
      doc.y -= boxH + 8;
    }
  }

  /* 08 CEO Decisions Required */
  doc.sectionTitle("CEO Decisions Required", n++);
  c.decisions.forEach((d, i) => {
    doc.ensure(24);
    doc.page.drawText(String(i + 1).padStart(2, "0"), {
      x: MARGIN_X,
      y: doc.y - 9,
      size: 9,
      font: fonts.bold,
      color: C.accent,
    });
    doc.text(d, { indent: 22, size: 9.5 });
    doc.gap(3);
  });

  /* 09 Next Actions */
  if (c.nextActions.length) {
    doc.sectionTitle("Next Actions", n++);
    c.nextActions.forEach((a, i) => {
      doc.ensure(24);
      doc.page.drawText(String(i + 1).padStart(2, "0"), {
        x: MARGIN_X,
        y: doc.y - 9,
        size: 9,
        font: fonts.bold,
        color: C.muted,
      });
      doc.text(a, { indent: 22, size: 9.5 });
      doc.gap(3);
    });
  }

  /* 10 Appendix */
  doc.sectionTitle("Appendix", n++);
  doc.keyValueRow("Report ID", report.id);
  doc.keyValueRow("Status", REPORT_STATUS[report.status].label);
  doc.keyValueRow(
    "Sources",
    report.sources.map((id) => AGENTS_BY_ID[id]?.role ?? id).join(" · "),
  );
  if (report.reviewedBy) {
    doc.keyValueRow("Reviewed by", `${report.reviewedBy}${report.reviewedAt ? ` · ${formatDate(report.reviewedAt)}` : ""}`);
  }
  if (report.reviewComment) doc.keyValueRow("Review comment", report.reviewComment);
  for (const row of c.appendix) doc.keyValueRow(row.label, row.value);

  doc.footers(doc.bodyPages.length);

  return pdf.save();
}
