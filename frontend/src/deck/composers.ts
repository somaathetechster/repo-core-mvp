/**
 * Template composers.
 *
 * The previous template system failed because one renderer read trait flags
 * and adjusted margins and fonts. Six templates that share a layout
 * function are one template. Here each template owns a composer: a function
 * that takes a slide's content and decides, independently, where every
 * element sits on the canvas.
 *
 * The test each composer has to pass: overlay two templates' output for the
 * same slide and the element frames should barely correspond. Different
 * anchor points, different proportions, different reading order, different
 * amounts of the canvas used.
 */
import {
  CANVAS_W, CANVAS_H, makeElement, elementId,
  type SlideElement, type ElementSlide, type SlideKind,
} from "./elements";

/** Normalised content handed to every composer. */
export interface SlideContentInput {
  kind: SlideKind;
  title: string;
  paragraphs: { text: string; source?: string }[];
  image?: string | null;
  logo?: string | null;
  chart?: { chart_type: string; columns: string[]; rows: string[][] } | null;
  team?: { name: string; role: string; bio: string; photo_data_url: string }[] | null;
  contents?: { title: string }[] | null;
  companyName?: string;
  pageNumber?: number;
  totalPages?: number;
}

export type Composer = (c: SlideContentInput) => { elements: SlideElement[]; background?: "paper" | "ink" | "accent" };

/* ------------------------------------------------------------------ */
/* Shared small pieces                                                 */
/* ------------------------------------------------------------------ */

/**
 * Every composer calls this. The logo was vanishing from most templates
 * before because each cover variant re-implemented it and several simply
 * omitted it. Making it a shared, always-called function is the fix.
 */
function chrome(
  c: SlideContentInput,
  opts: {
    margin: number;
    logoSize?: number;
    logoAt?: "top-left" | "top-right" | "bottom-left";
    numberStyle?: "plain" | "padded" | "fraction" | "none";
    inverse?: boolean;
    labelFont?: "label" | "body";
  },
): SlideElement[] {
  const out: SlideElement[] = [];
  const { margin } = opts;
  const color = opts.inverse ? "inverse" : "muted";
  const size = opts.logoSize ?? 28;

  if (c.logo) {
    const pos =
      opts.logoAt === "top-right"
        ? { x: CANVAS_W - margin - size * 3, y: margin - 4 }
        : opts.logoAt === "bottom-left"
          ? { x: margin, y: CANVAS_H - margin - size }
          : { x: margin, y: margin - 4 };
    out.push(
      makeElement("logo", { ...pos, w: size * 3, h: size, z: 40 }, { objectFit: "contain", opacity: opts.inverse ? 0.9 : 0.8 }, {
        src: c.logo,
        locked: true,
      }),
    );
  }

  if (opts.numberStyle && opts.numberStyle !== "none" && c.pageNumber) {
    const label =
      opts.numberStyle === "padded"
        ? String(c.pageNumber).padStart(2, "0")
        : opts.numberStyle === "fraction"
          ? `${c.pageNumber} / ${c.totalPages ?? "—"}`
          : String(c.pageNumber);
    out.push(
      makeElement(
        "pageNumber",
        { x: CANVAS_W - margin - 90, y: CANVAS_H - margin - 18, w: 90, h: 18, z: 40 },
        { color, fontFamily: opts.labelFont ?? "label", fontSize: 11, align: "right" },
        { text: label, locked: true },
      ),
    );
  }

  if (c.companyName) {
    out.push(
      makeElement(
        "caption",
        { x: c.logo && opts.logoAt !== "bottom-left" ? margin : margin, y: CANVAS_H - margin - 18, w: 320, h: 18, z: 40 },
        { color, fontFamily: opts.labelFont ?? "label", fontSize: 11 },
        { text: c.companyName, locked: true },
      ),
    );
  }

  return out;
}

function sourcesElement(c: SlideContentInput, margin: number, y: number, inverse = false): SlideElement[] {
  const unique = [...new Set(c.paragraphs.map((p) => p.source).filter(Boolean))];
  if (unique.length === 0) return [];
  return [
    makeElement(
      "caption",
      { x: margin, y, w: CANVAS_W - margin * 2, h: 16, z: 30 },
      { color: inverse ? "inverse" : "muted", fontFamily: "label", fontSize: 10.5, opacity: 0.75 },
      { text: unique.join("  ·  ") },
    ),
  ];
}

/* ================================================================== */
/* 1. EDITORIAL — asymmetric magazine column                          */
/*    Anchor: title in a narrow left column, body in a wide right one. */
/* ================================================================== */

const EDITORIAL_M = 88;

export const composeEditorial: Composer = (c) => {
  const m = EDITORIAL_M;
  const els: SlideElement[] = [];

  if (c.kind === "cover") {
    els.push(makeElement("shape", { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, z: 0 }, { background: "ink", shape: "rect" }));
    els.push(...chrome(c, { margin: m, logoAt: "top-left", numberStyle: "none", inverse: true, logoSize: 30 }));
    els.push(makeElement("rule", { x: m, y: 402, w: 56, h: 3, z: 10 }, { background: "accent" }));
    els.push(makeElement("heading", { x: m, y: 430, w: 800, h: 150, z: 10 },
      { color: "inverse", fontFamily: "display", fontSize: 66, fontWeight: 600, lineHeight: 1.02, letterSpacing: "-0.02em" },
      { text: c.title }));
    if (c.paragraphs[0]) {
      els.push(makeElement("text", { x: m, y: 596, w: 620, h: 60, z: 10 },
        { color: "inverse", fontFamily: "body", fontSize: 24, lineHeight: 1.4, opacity: 0.72 },
        { text: c.paragraphs[0].text }));
    }
    return { elements: els, background: "ink" };
  }

  els.push(...chrome(c, { margin: m, logoAt: "top-right", numberStyle: "fraction", logoSize: 22 }));

  if (c.kind === "contents") {
    els.push(makeElement("heading", { x: m, y: 92, w: 500, h: 56, z: 10 },
      { color: "ink", fontFamily: "display", fontSize: 42, fontWeight: 600 }, { text: c.title }));
    const entries = c.contents ?? [];
    const half = Math.ceil(entries.length / 2);
    entries.forEach((e, i) => {
      const col = i < half ? 0 : 1;
      const row = i < half ? i : i - half;
      els.push(makeElement("list", { x: m + col * 520, y: 200 + row * 46, w: 480, h: 40, z: 10 },
        { color: "ink", fontFamily: "body", fontSize: 20, borderTop: 1, borderColor: "rule", padding: 10 },
        { text: `${String(i + 3).padStart(2, "0")}    ${e.title}` }));
    });
    return { elements: els };
  }

  if (c.kind === "team" && c.team) {
    els.push(makeElement("heading", { x: m, y: 88, w: 600, h: 54, z: 10 },
      { color: "ink", fontFamily: "display", fontSize: 42, fontWeight: 600 }, { text: c.title }));
    const cols = Math.min(c.team.length, 4);
    const cw = (CANVAS_W - m * 2 - 28 * (cols - 1)) / cols;
    c.team.slice(0, 4).forEach((p, i) => {
      const x = m + i * (cw + 28);
      els.push(makeElement("portrait", { x, y: 200, w: cw, h: cw, z: 10 },
        { objectFit: "cover", filter: "grayscale(0.25)" }, { src: p.photo_data_url || null, text: p.name }));
      els.push(makeElement("rule", { x, y: 200 + cw + 16, w: 26, h: 2, z: 10 }, { background: "accent" }));
      els.push(makeElement("text", { x, y: 200 + cw + 28, w: cw, h: 26, z: 10 },
        { color: "ink", fontFamily: "display", fontSize: 20, fontWeight: 600 }, { text: p.name }));
      els.push(makeElement("caption", { x, y: 200 + cw + 54, w: cw, h: 20, z: 10 },
        { color: "accent", fontFamily: "label", fontSize: 14 }, { text: p.role }));
      els.push(makeElement("text", { x, y: 200 + cw + 78, w: cw, h: 90, z: 10 },
        { color: "muted", fontFamily: "body", fontSize: 14.5, lineHeight: 1.5 }, { text: p.bio }));
    });
    return { elements: els };
  }

  if (c.chart) {
    els.push(makeElement("heading", { x: m, y: 70, w: 900, h: 44, z: 10 },
      { color: "ink", fontFamily: "display", fontSize: 32, fontWeight: 600 }, { text: c.title }));
    els.push(makeElement("chart", { x: m, y: 140, w: CANVAS_W - m * 2, h: 400, z: 10 }, {}, { chart: c.chart }));
    if (c.paragraphs[0]) {
      els.push(makeElement("caption", { x: m, y: 566, w: 760, h: 56, z: 10 },
        { color: "muted", fontFamily: "body", fontSize: 15, lineHeight: 1.45, borderLeft: 2, borderColor: "accent", padding: 14 },
        { text: c.paragraphs[0].text }));
    }
    return { elements: els };
  }

  // Argument: narrow title column left, wide body right. The signature move.
  els.push(makeElement("rule", { x: m, y: 104, w: 44, h: 3, z: 10 }, { background: "accent" }));
  els.push(makeElement("heading", { x: m, y: 126, w: 300, h: 220, z: 10 },
    { color: "ink", fontFamily: "display", fontSize: 40, fontWeight: 600, lineHeight: 1.12, letterSpacing: "-0.015em" },
    { text: c.title }));

  let y = 104;
  c.paragraphs.slice(0, 4).forEach((p, i) => {
    const fs = i === 0 ? 26 : 20;
    const h = Math.max(50, Math.ceil(p.text.length / 52) * (fs * 1.55));
    els.push(makeElement("text", { x: 468, y, w: CANVAS_W - m - 468, h, z: 10 },
      { color: i === 0 ? "ink" : "muted", fontFamily: "body", fontSize: fs, lineHeight: i === 0 ? 1.4 : 1.55 },
      { text: p.text, source: p.source }));
    y += h + 20;
  });

  if (c.image) {
    els.push(makeElement("image", { x: m, y: 400, w: 300, h: 200, z: 10 }, { objectFit: "cover" }, { src: c.image }));
  }
  els.push(...sourcesElement(c, m, CANVAS_H - 96));
  return { elements: els };
};

/* ================================================================== */
/* 2. TECHNICAL BRIEF — full-width header band, dense modular body     */
/*    Anchor: everything hangs off a horizontal rule system.           */
/* ================================================================== */

const TECH_M = 56;

export const composeTechnical: Composer = (c) => {
  const m = TECH_M;
  const els: SlideElement[] = [];

  if (c.kind === "cover") {
    els.push(makeElement("shape", { x: 0, y: 0, w: CANVAS_W, h: 96, z: 0 }, { background: "accent", shape: "rect" }));
    els.push(makeElement("caption", { x: m, y: 38, w: 400, h: 20, z: 10 },
      { color: "inverse", fontFamily: "label", fontSize: 12, letterSpacing: "0.08em" },
      { text: (c.companyName ?? "").toUpperCase() }));
    if (c.logo) {
      els.push(makeElement("logo", { x: CANVAS_W - m - 84, y: 30, w: 84, h: 34, z: 20 },
        { objectFit: "contain", opacity: 0.95 }, { src: c.logo, locked: true }));
    }
    els.push(makeElement("heading", { x: m, y: 250, w: 900, h: 130, z: 10 },
      { color: "ink", fontFamily: "display", fontSize: 54, fontWeight: 700, lineHeight: 1.04, letterSpacing: "-0.025em" },
      { text: c.title }));
    els.push(makeElement("rule", { x: m, y: 404, w: CANVAS_W - m * 2, h: 1, z: 10 }, { background: "rule" }));
    if (c.paragraphs[0]) {
      els.push(makeElement("text", { x: m, y: 428, w: 780, h: 80, z: 10 },
        { color: "muted", fontFamily: "body", fontSize: 20, lineHeight: 1.5 }, { text: c.paragraphs[0].text }));
    }
    // A metadata strip, the kind an engineering document carries.
    const meta = [["DATE", new Date().toLocaleDateString(undefined, { month: "short", year: "numeric" })],
                  ["PAGES", String(c.totalPages ?? "—")],
                  ["STATUS", "CONFIDENTIAL"]];
    meta.forEach(([k, v], i) => {
      const x = m + i * 220;
      els.push(makeElement("caption", { x, y: CANVAS_H - 120, w: 200, h: 16, z: 10 },
        { color: "muted", fontFamily: "label", fontSize: 10, letterSpacing: "0.1em" }, { text: k }));
      els.push(makeElement("text", { x, y: CANVAS_H - 100, w: 200, h: 22, z: 10 },
        { color: "ink", fontFamily: "label", fontSize: 15 }, { text: v }));
    });
    return { elements: els };
  }

  // Header system: label, title, full rule. Every slide repeats it exactly.
  els.push(makeElement("caption", { x: m, y: 44, w: 300, h: 16, z: 10 },
    { color: "accent", fontFamily: "label", fontSize: 10.5, letterSpacing: "0.1em" },
    { text: `§ ${String(c.pageNumber ?? 1).padStart(2, "0")}` }));
  els.push(makeElement("heading", { x: m, y: 66, w: 900, h: 44, z: 10 },
    { color: "ink", fontFamily: "display", fontSize: 32, fontWeight: 600, letterSpacing: "-0.015em" },
    { text: c.title }));
  els.push(makeElement("rule", { x: m, y: 122, w: CANVAS_W - m * 2, h: 1, z: 10 }, { background: "rule" }));
  els.push(...chrome(c, { margin: m, logoAt: "top-right", numberStyle: "padded", logoSize: 18, labelFont: "label" }));

  if (c.kind === "contents") {
    (c.contents ?? []).forEach((e, i) => {
      els.push(makeElement("list", { x: m, y: 152 + i * 38, w: CANVAS_W - m * 2, h: 32, z: 10 },
        { color: "ink", fontFamily: "body", fontSize: 17, borderTop: 1, borderColor: "rule", padding: 8 },
        { text: `${String(i + 3).padStart(2, "0")}   ${e.title}` }));
    });
    return { elements: els };
  }

  if (c.kind === "team" && c.team) {
    c.team.slice(0, 4).forEach((p, i) => {
      const y = 150 + i * 122;
      els.push(makeElement("portrait", { x: m, y, w: 96, h: 96, z: 10 },
        { objectFit: "cover", filter: "grayscale(0.4)" }, { src: p.photo_data_url || null, text: p.name }));
      els.push(makeElement("text", { x: m + 120, y: y + 4, w: 400, h: 24, z: 10 },
        { color: "ink", fontFamily: "display", fontSize: 19, fontWeight: 600 }, { text: p.name }));
      els.push(makeElement("caption", { x: m + 120, y: y + 30, w: 400, h: 18, z: 10 },
        { color: "accent", fontFamily: "label", fontSize: 12.5 }, { text: p.role }));
      els.push(makeElement("text", { x: m + 120, y: y + 54, w: CANVAS_W - m * 2 - 120, h: 50, z: 10 },
        { color: "muted", fontFamily: "body", fontSize: 14, lineHeight: 1.5 }, { text: p.bio }));
      els.push(makeElement("rule", { x: m, y: y + 108, w: CANVAS_W - m * 2, h: 1, z: 10 }, { background: "rule" }));
    });
    return { elements: els };
  }

  if (c.chart) {
    els.push(makeElement("chart", { x: m, y: 152, w: CANVAS_W - m * 2, h: 390, z: 10 }, {}, { chart: c.chart }));
    if (c.paragraphs[0]) {
      els.push(makeElement("rule", { x: m, y: 558, w: CANVAS_W - m * 2, h: 1, z: 10 }, { background: "rule" }));
      els.push(makeElement("caption", { x: m, y: 572, w: 820, h: 46, z: 10 },
        { color: "muted", fontFamily: "body", fontSize: 14, lineHeight: 1.45 }, { text: c.paragraphs[0].text }));
    }
    return { elements: els };
  }

  // Dense numbered rows, full width, hairline separated. Nothing centred,
  // nothing floating: the page reads like a spec.
  c.paragraphs.slice(0, 5).forEach((p, i) => {
    const y = 152 + i * 96;
    els.push(makeElement("caption", { x: m, y: y + 4, w: 40, h: 18, z: 10 },
      { color: "accent", fontFamily: "label", fontSize: 12 }, { text: String(i + 1).padStart(2, "0") }));
    els.push(makeElement("text", { x: m + 56, y, w: CANVAS_W - m * 2 - 56, h: 76, z: 10 },
      { color: i === 0 ? "ink" : "muted", fontFamily: "body", fontSize: i === 0 ? 19 : 16.5, lineHeight: 1.55 },
      { text: p.text, source: p.source }));
    els.push(makeElement("rule", { x: m, y: y + 84, w: CANVAS_W - m * 2, h: 1, z: 10 }, { background: "rule" }));
  });
  els.push(...sourcesElement(c, m, CANVAS_H - 76));
  return { elements: els };
};

/* ================================================================== */
/* 3. STATEMENT — one idea, enormous, inverted fields                  */
/*    Anchor: type fills the canvas; supporting text is nearly absent. */
/* ================================================================== */

const STMT_M = 100;

export const composeStatement: Composer = (c) => {
  const m = STMT_M;
  const els: SlideElement[] = [];

  if (c.kind === "cover") {
    els.push(makeElement("shape", { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, z: 0 }, { background: "accent", shape: "rect" }));
    els.push(...chrome(c, { margin: m, logoAt: "top-left", numberStyle: "none", inverse: true, logoSize: 32 }));
    els.push(makeElement("heading", { x: m, y: 236, w: CANVAS_W - m * 2, h: 320, z: 10 },
      { color: "inverse", fontFamily: "display", fontSize: 108, fontWeight: 800, lineHeight: 0.94, letterSpacing: "-0.045em" },
      { text: c.title }));
    if (c.paragraphs[0]) {
      els.push(makeElement("text", { x: m, y: CANVAS_H - 150, w: 640, h: 70, z: 10 },
        { color: "inverse", fontFamily: "body", fontSize: 22, lineHeight: 1.4, opacity: 0.85 },
        { text: c.paragraphs[0].text }));
    }
    return { elements: els, background: "accent" };
  }

  if (c.kind === "contents") {
    els.push(makeElement("caption", { x: m, y: 96, w: 400, h: 24, z: 10 },
      { color: "accent", fontFamily: "label", fontSize: 16, fontWeight: 700, letterSpacing: "0.06em" },
      { text: c.title.toUpperCase() }));
    (c.contents ?? []).slice(0, 9).forEach((e, i) => {
      els.push(makeElement("list", { x: m, y: 168 + i * 52, w: CANVAS_W - m * 2, h: 44, z: 10 },
        { color: "ink", fontFamily: "display", fontSize: 30, fontWeight: 600, lineHeight: 1.1 },
        { text: e.title }));
    });
    els.push(...chrome(c, { margin: m, numberStyle: "none", logoAt: "top-right", logoSize: 20 }));
    return { elements: els };
  }

  if (c.kind === "team" && c.team) {
    els.push(makeElement("caption", { x: m, y: 86, w: 500, h: 24, z: 10 },
      { color: "accent", fontFamily: "label", fontSize: 15, fontWeight: 700, letterSpacing: "0.06em" },
      { text: c.title.toUpperCase() }));
    const cols = Math.min(c.team.length, 3);
    const cw = (CANVAS_W - m * 2 - 40 * (cols - 1)) / cols;
    c.team.slice(0, 3).forEach((p, i) => {
      const x = m + i * (cw + 40);
      els.push(makeElement("portrait", { x, y: 170, w: cw, h: cw * 1.1, z: 10 },
        { objectFit: "cover", filter: "grayscale(1) contrast(1.2)" }, { src: p.photo_data_url || null, text: p.name }));
      els.push(makeElement("text", { x, y: 170 + cw * 1.1 + 18, w: cw, h: 34, z: 10 },
        { color: "ink", fontFamily: "display", fontSize: 26, fontWeight: 700, lineHeight: 1.1 }, { text: p.name }));
      els.push(makeElement("caption", { x, y: 170 + cw * 1.1 + 54, w: cw, h: 22, z: 10 },
        { color: "accent", fontFamily: "label", fontSize: 14, fontWeight: 600 }, { text: p.role }));
    });
    return { elements: els };
  }

  if (c.chart) {
    els.push(makeElement("heading", { x: m, y: 74, w: 900, h: 50, z: 10 },
      { color: "ink", fontFamily: "display", fontSize: 38, fontWeight: 700, letterSpacing: "-0.02em" }, { text: c.title }));
    els.push(makeElement("chart", { x: m, y: 160, w: CANVAS_W - m * 2, h: 400, z: 10 }, {}, { chart: c.chart }));
    if (c.paragraphs[0]) {
      els.push(makeElement("caption", { x: m, y: 584, w: 700, h: 44, z: 10 },
        { color: "muted", fontFamily: "body", fontSize: 16, lineHeight: 1.4 }, { text: c.paragraphs[0].text }));
    }
    return { elements: els };
  }

  // The signature: dark field, tiny label, enormous single statement.
  const lead = c.paragraphs[0]?.text ?? "";
  const rest = c.paragraphs.slice(1, 3);
  els.push(makeElement("shape", { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, z: 0 }, { background: "ink", shape: "rect" }));
  els.push(makeElement("rule", { x: m, y: 168, w: 88, h: 10, z: 10 }, { background: "accent" }));
  els.push(makeElement("eyebrow", { x: m, y: 200, w: 600, h: 24, z: 10 },
    { color: "inverse", fontFamily: "label", fontSize: 15, opacity: 0.55, letterSpacing: "0.04em" },
    { text: c.title.toUpperCase() }));
  els.push(makeElement("statement", { x: m, y: 244, w: CANVAS_W - m * 2, h: 260, z: 10 },
    {
      color: "inverse", fontFamily: "display",
      fontSize: lead.length < 60 ? 76 : lead.length < 130 ? 54 : 40,
      fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.03em",
    },
    { text: lead, source: c.paragraphs[0]?.source }));
  rest.forEach((p, i) => {
    els.push(makeElement("text", { x: m + i * ((CANVAS_W - m * 2) / 2 + 20), y: 536, w: (CANVAS_W - m * 2) / 2 - 20, h: 90, z: 10 },
      { color: "inverse", fontFamily: "body", fontSize: 17, lineHeight: 1.5, opacity: 0.66 },
      { text: p.text, source: p.source }));
  });
  els.push(...chrome(c, { margin: m, numberStyle: "none", inverse: true, logoAt: "top-right", logoSize: 20 }));
  return { elements: els, background: "ink" };
};

/* ================================================================== */
/* 4. INSTITUTIONAL — centred, ruled, narrow measure                   */
/*    Anchor: a vertical centre line; nothing sits flush left.         */
/* ================================================================== */

const INST_M = 112;
const MEASURE = 680;

export const composeInstitutional: Composer = (c) => {
  const m = INST_M;
  const cx = CANVAS_W / 2;
  const els: SlideElement[] = [];
  const centred = (w: number) => cx - w / 2;

  if (c.kind === "cover") {
    if (c.logo) {
      els.push(makeElement("logo", { x: centred(120), y: 150, w: 120, h: 44, z: 20 },
        { objectFit: "contain" }, { src: c.logo, locked: true }));
    }
    els.push(makeElement("rule", { x: centred(200), y: 234, w: 200, h: 1, z: 10 }, { background: "rule" }));
    els.push(makeElement("heading", { x: centred(860), y: 274, w: 860, h: 110, z: 10 },
      { color: "ink", fontFamily: "display", fontSize: 50, fontWeight: 600, lineHeight: 1.15, align: "center" },
      { text: c.title }));
    if (c.paragraphs[0]) {
      els.push(makeElement("text", { x: centred(MEASURE), y: 398, w: MEASURE, h: 80, z: 10 },
        { color: "muted", fontFamily: "body", fontSize: 21, lineHeight: 1.65, align: "center" },
        { text: c.paragraphs[0].text }));
    }
    els.push(makeElement("rule", { x: centred(200), y: 506, w: 200, h: 1, z: 10 }, { background: "rule" }));
    els.push(makeElement("caption", { x: centred(400), y: 540, w: 400, h: 20, z: 10 },
      { color: "muted", fontFamily: "label", fontSize: 12, align: "center" },
      { text: new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" }) }));
    return { elements: els };
  }

  els.push(makeElement("heading", { x: centred(820), y: 94, w: 820, h: 50, z: 10 },
    { color: "ink", fontFamily: "display", fontSize: 36, fontWeight: 600, align: "center" }, { text: c.title }));
  els.push(makeElement("rule", { x: centred(160), y: 162, w: 160, h: 1, z: 10 }, { background: "rule" }));
  if (c.pageNumber) {
    els.push(makeElement("pageNumber", { x: centred(80), y: CANVAS_H - 62, w: 80, h: 18, z: 40 },
      { color: "muted", fontFamily: "label", fontSize: 11, align: "center" },
      { text: String(c.pageNumber), locked: true }));
  }
  if (c.logo) {
    els.push(makeElement("logo", { x: m, y: CANVAS_H - 66, w: 60, h: 22, z: 40 },
      { objectFit: "contain", opacity: 0.6 }, { src: c.logo, locked: true }));
  }

  if (c.kind === "contents") {
    (c.contents ?? []).forEach((e, i) => {
      els.push(makeElement("list", { x: centred(MEASURE), y: 200 + i * 42, w: MEASURE, h: 34, z: 10 },
        { color: "ink", fontFamily: "body", fontSize: 19, align: "center", borderTop: 1, borderColor: "rule", padding: 8 },
        { text: e.title }));
    });
    return { elements: els };
  }

  if (c.kind === "team" && c.team) {
    const cols = Math.min(c.team.length, 4);
    const cw = 190;
    const totalW = cols * cw + (cols - 1) * 36;
    c.team.slice(0, 4).forEach((p, i) => {
      const x = cx - totalW / 2 + i * (cw + 36);
      els.push(makeElement("portrait", { x: x + (cw - 140) / 2, y: 206, w: 140, h: 140, z: 10 },
        { objectFit: "cover", borderRadius: 70 }, { src: p.photo_data_url || null, text: p.name }));
      els.push(makeElement("text", { x, y: 364, w: cw, h: 26, z: 10 },
        { color: "ink", fontFamily: "display", fontSize: 19, fontWeight: 600, align: "center" }, { text: p.name }));
      els.push(makeElement("caption", { x, y: 390, w: cw, h: 20, z: 10 },
        { color: "muted", fontFamily: "label", fontSize: 13, align: "center" }, { text: p.role }));
      els.push(makeElement("text", { x, y: 416, w: cw, h: 90, z: 10 },
        { color: "muted", fontFamily: "body", fontSize: 13.5, lineHeight: 1.55, align: "center" }, { text: p.bio }));
    });
    return { elements: els };
  }

  if (c.chart) {
    els.push(makeElement("chart", { x: centred(920), y: 196, w: 920, h: 360, z: 10 }, {}, { chart: c.chart }));
    if (c.paragraphs[0]) {
      els.push(makeElement("caption", { x: centred(MEASURE), y: 576, w: MEASURE, h: 44, z: 10 },
        { color: "muted", fontFamily: "body", fontSize: 14.5, lineHeight: 1.5, align: "center" },
        { text: c.paragraphs[0].text }));
    }
    return { elements: els };
  }

  let y = 196;
  c.paragraphs.slice(0, 4).forEach((p, i) => {
    const fs = i === 0 ? 21 : 18;
    const h = Math.max(48, Math.ceil(p.text.length / 62) * (fs * 1.7));
    els.push(makeElement("text", { x: centred(MEASURE), y, w: MEASURE, h, z: 10 },
      { color: i === 0 ? "ink" : "muted", fontFamily: "body", fontSize: fs, lineHeight: 1.7, align: "center" },
      { text: p.text, source: p.source }));
    y += h + 18;
  });
  return { elements: els };
};

/* ================================================================== */
/* 5. MODERNIST — strict module grid, colour blocks, flush left        */
/*    Anchor: a visible 12-column module; blocks snap to it exactly.   */
/* ================================================================== */

const MOD_M = 72;
const MOD_COL = (CANVAS_W - MOD_M * 2 - 11 * 20) / 12;
const modX = (col: number) => MOD_M + col * (MOD_COL + 20);
const modW = (span: number) => span * MOD_COL + (span - 1) * 20;

export const composeModernist: Composer = (c) => {
  const els: SlideElement[] = [];

  if (c.kind === "cover") {
    els.push(makeElement("shape", { x: 0, y: 0, w: CANVAS_W * 0.38, h: CANVAS_H, z: 0 }, { background: "accent", shape: "rect" }));
    if (c.logo) {
      els.push(makeElement("logo", { x: CANVAS_W * 0.38 + 72, y: 96, w: 110, h: 36, z: 20 },
        { objectFit: "contain" }, { src: c.logo, locked: true }));
    }
    els.push(makeElement("heading", { x: CANVAS_W * 0.38 + 72, y: 280, w: 620, h: 140, z: 10 },
      { color: "ink", fontFamily: "display", fontSize: 62, fontWeight: 700, lineHeight: 1.0, letterSpacing: "-0.035em" },
      { text: c.title }));
    if (c.paragraphs[0]) {
      els.push(makeElement("text", { x: CANVAS_W * 0.38 + 72, y: 440, w: 520, h: 80, z: 10 },
        { color: "muted", fontFamily: "body", fontSize: 21, lineHeight: 1.45 }, { text: c.paragraphs[0].text }));
    }
    els.push(makeElement("caption", { x: CANVAS_W * 0.38 + 72, y: CANVAS_H - 110, w: 300, h: 18, z: 10 },
      { color: "muted", fontFamily: "label", fontSize: 11, letterSpacing: "0.08em" },
      { text: (c.companyName ?? "").toUpperCase() }));
    return { elements: els };
  }

  // Header: a thick accent block, then the title flush beneath it.
  els.push(makeElement("rule", { x: MOD_M, y: 72, w: 96, h: 12, z: 10 }, { background: "accent" }));
  els.push(makeElement("heading", { x: MOD_M, y: 102, w: modW(9), h: 52, z: 10 },
    { color: "ink", fontFamily: "display", fontSize: 38, fontWeight: 700, letterSpacing: "-0.03em" },
    { text: c.title }));
  els.push(...chrome(c, { margin: MOD_M, logoAt: "top-right", numberStyle: "padded", logoSize: 18 }));

  if (c.kind === "contents") {
    (c.contents ?? []).forEach((e, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      els.push(makeElement("shape", { x: modX(col * 6), y: 200 + row * 76, w: modW(6) - 16, h: 62, z: 5 },
        { background: "accentSoft", shape: "rect" }));
      els.push(makeElement("list", { x: modX(col * 6) + 20, y: 218 + row * 76, w: modW(6) - 56, h: 28, z: 10 },
        { color: "ink", fontFamily: "body", fontSize: 18, fontWeight: 500 },
        { text: `${String(i + 3).padStart(2, "0")}  ${e.title}` }));
    });
    return { elements: els };
  }

  if (c.kind === "team" && c.team) {
    c.team.slice(0, 4).forEach((p, i) => {
      const x = modX(i * 3);
      els.push(makeElement("portrait", { x, y: 194, w: modW(3), h: modW(3), z: 10 },
        { objectFit: "cover" }, { src: p.photo_data_url || null, text: p.name }));
      els.push(makeElement("shape", { x, y: 194 + modW(3), w: modW(3), h: 6, z: 10 }, { background: "accent", shape: "rect" }));
      els.push(makeElement("text", { x, y: 194 + modW(3) + 20, w: modW(3), h: 26, z: 10 },
        { color: "ink", fontFamily: "display", fontSize: 19, fontWeight: 700 }, { text: p.name }));
      els.push(makeElement("caption", { x, y: 194 + modW(3) + 46, w: modW(3), h: 20, z: 10 },
        { color: "muted", fontFamily: "label", fontSize: 13 }, { text: p.role }));
      els.push(makeElement("text", { x, y: 194 + modW(3) + 70, w: modW(3), h: 80, z: 10 },
        { color: "muted", fontFamily: "body", fontSize: 13.5, lineHeight: 1.5 }, { text: p.bio }));
    });
    return { elements: els };
  }

  if (c.chart) {
    els.push(makeElement("chart", { x: MOD_M, y: 186, w: modW(9), h: 380, z: 10 }, {}, { chart: c.chart }));
    if (c.paragraphs[0]) {
      els.push(makeElement("shape", { x: modX(9), y: 186, w: modW(3), h: 380, z: 5 }, { background: "accentSoft", shape: "rect" }));
      els.push(makeElement("caption", { x: modX(9) + 20, y: 210, w: modW(3) - 40, h: 300, z: 10 },
        { color: "ink", fontFamily: "body", fontSize: 15, lineHeight: 1.55 }, { text: c.paragraphs[0].text }));
    }
    return { elements: els };
  }

  // Content in modular blocks with tinted fills. Strictly on-grid.
  const items = c.paragraphs.slice(0, 4);
  items.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = modX(col * 6);
    const y = 194 + row * 190;
    els.push(makeElement("shape", { x, y, w: modW(6) - 16, h: 168, z: 5 }, { background: "accentSoft", shape: "rect" }));
    els.push(makeElement("shape", { x, y, w: 5, h: 168, z: 6 }, { background: "accent", shape: "rect" }));
    els.push(makeElement("text", { x: x + 28, y: y + 26, w: modW(6) - 72, h: 120, z: 10 },
      { color: "ink", fontFamily: "body", fontSize: i === 0 ? 19 : 17, lineHeight: 1.55 },
      { text: p.text, source: p.source }));
  });
  return { elements: els };
};

/* ================================================================== */
/* 6. NARRATIVE — image dominant, text in scrim panels                 */
/*    Anchor: imagery occupies most of the canvas on every slide.      */
/* ================================================================== */

const NAR_M = 80;

export const composeNarrative: Composer = (c) => {
  const els: SlideElement[] = [];

  if (c.kind === "cover") {
    if (c.image) {
      els.push(makeElement("image", { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, z: 0 }, { objectFit: "cover" }, { src: c.image }));
    } else {
      els.push(makeElement("shape", { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, z: 0 }, { background: "ink", shape: "rect" }));
    }
    els.push(makeElement("shape", { x: 0, y: 0, w: CANVAS_W * 0.62, h: CANVAS_H, z: 1 },
      { background: "ink", opacity: 0.82, shape: "rect" }));
    els.push(...chrome(c, { margin: NAR_M, logoAt: "top-left", numberStyle: "none", inverse: true, logoSize: 30 }));
    els.push(makeElement("heading", { x: NAR_M, y: 300, w: 640, h: 170, z: 10 },
      { color: "inverse", fontFamily: "display", fontSize: 68, fontWeight: 700, lineHeight: 1.02, letterSpacing: "-0.02em" },
      { text: c.title }));
    if (c.paragraphs[0]) {
      els.push(makeElement("text", { x: NAR_M, y: 486, w: 520, h: 80, z: 10 },
        { color: "inverse", fontFamily: "body", fontSize: 21, lineHeight: 1.45, opacity: 0.8 },
        { text: c.paragraphs[0].text }));
    }
    return { elements: els, background: "ink" };
  }

  if (c.kind === "contents") {
    els.push(makeElement("shape", { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, z: 0 }, { background: "ink", shape: "rect" }));
    els.push(makeElement("heading", { x: NAR_M, y: 92, w: 600, h: 54, z: 10 },
      { color: "inverse", fontFamily: "display", fontSize: 42, fontWeight: 700 }, { text: c.title }));
    (c.contents ?? []).forEach((e, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      els.push(makeElement("list", { x: NAR_M + col * 540, y: 200 + row * 52, w: 500, h: 42, z: 10 },
        { color: "inverse", fontFamily: "body", fontSize: 21, opacity: 0.85 }, { text: e.title }));
    });
    return { elements: els, background: "ink" };
  }

  if (c.kind === "team" && c.team) {
    els.push(makeElement("heading", { x: NAR_M, y: 82, w: 600, h: 52, z: 10 },
      { color: "ink", fontFamily: "display", fontSize: 40, fontWeight: 700 }, { text: c.title }));
    const cols = Math.min(c.team.length, 4);
    const cw = (CANVAS_W - NAR_M * 2 - 24 * (cols - 1)) / cols;
    c.team.slice(0, 4).forEach((p, i) => {
      const x = NAR_M + i * (cw + 24);
      els.push(makeElement("portrait", { x, y: 170, w: cw, h: cw * 1.33, z: 10 },
        { objectFit: "cover" }, { src: p.photo_data_url || null, text: p.name }));
      els.push(makeElement("shape", { x, y: 170 + cw * 1.33 - 92, w: cw, h: 92, z: 11 },
        { background: "ink", opacity: 0.75, shape: "rect" }));
      els.push(makeElement("text", { x: x + 16, y: 170 + cw * 1.33 - 74, w: cw - 32, h: 26, z: 12 },
        { color: "inverse", fontFamily: "display", fontSize: 19, fontWeight: 700 }, { text: p.name }));
      els.push(makeElement("caption", { x: x + 16, y: 170 + cw * 1.33 - 46, w: cw - 32, h: 20, z: 12 },
        { color: "inverse", fontFamily: "label", fontSize: 13, opacity: 0.8 }, { text: p.role }));
    });
    return { elements: els };
  }

  if (c.chart) {
    els.push(makeElement("heading", { x: NAR_M, y: 70, w: 800, h: 46, z: 10 },
      { color: "ink", fontFamily: "display", fontSize: 34, fontWeight: 700 }, { text: c.title }));
    els.push(makeElement("chart", { x: NAR_M, y: 148, w: CANVAS_W - NAR_M * 2, h: 400, z: 10 }, {}, { chart: c.chart }));
    if (c.paragraphs[0]) {
      els.push(makeElement("caption", { x: NAR_M, y: 572, w: 740, h: 48, z: 10 },
        { color: "muted", fontFamily: "body", fontSize: 15.5, lineHeight: 1.45 }, { text: c.paragraphs[0].text }));
    }
    return { elements: els };
  }

  // Half-bleed image right, text in the left third over paper.
  const hasImage = !!c.image;
  if (hasImage) {
    els.push(makeElement("image", { x: CANVAS_W * 0.46, y: 0, w: CANVAS_W * 0.54, h: CANVAS_H, z: 0 },
      { objectFit: "cover" }, { src: c.image }));
  }
  const textW = hasImage ? CANVAS_W * 0.46 - NAR_M - 40 : CANVAS_W - NAR_M * 2;
  els.push(makeElement("rule", { x: NAR_M, y: 140, w: 48, h: 4, z: 10 }, { background: "accent" }));
  els.push(makeElement("heading", { x: NAR_M, y: 164, w: textW, h: 110, z: 10 },
    { color: "ink", fontFamily: "display", fontSize: 42, fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.02em" },
    { text: c.title }));
  let ny = 296;
  c.paragraphs.slice(0, 3).forEach((p, i) => {
    const fs = i === 0 ? 20 : 17;
    const h = Math.max(48, Math.ceil(p.text.length / (textW / 9)) * (fs * 1.55));
    els.push(makeElement("text", { x: NAR_M, y: ny, w: textW, h, z: 10 },
      { color: i === 0 ? "ink" : "muted", fontFamily: "body", fontSize: fs, lineHeight: 1.55 },
      { text: p.text, source: p.source }));
    ny += h + 16;
  });
  els.push(...chrome(c, { margin: NAR_M, logoAt: "top-left", numberStyle: "none", logoSize: 20 }));
  return { elements: els };
};

/* ------------------------------------------------------------------ */

export const COMPOSERS: Record<string, Composer> = {
  editorial: composeEditorial,
  technical: composeTechnical,
  statement: composeStatement,
  institutional: composeInstitutional,
  modernist: composeModernist,
  narrative: composeNarrative,
};

export function compose(templateId: string, content: SlideContentInput): ElementSlide {
  const composer = COMPOSERS[templateId] ?? composeEditorial;
  const { elements, background } = composer(content);
  return {
    id: elementId("slide"),
    kind: content.kind,
    title: content.title,
    elements,
    background: background ?? "paper",
    customized: false,
  };
}
