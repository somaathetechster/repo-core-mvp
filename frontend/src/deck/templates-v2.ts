/**
 * Four templates built on genuinely different organizing principles.
 *
 * The existing seven were variations on "text arranged on a background",
 * which is why they read as one template with different fonts. These four
 * each answer a different question about what a slide *is*:
 *
 *   Gallery — the page is a modular image grid; text blocks are cells.
 *   Dossier — the page is a ruled document; findings sit in a table.
 *   Edition — the page is a magazine spread; an image bleeds off the edge.
 *   Signal  — the page is a colour field; type is the only element.
 *
 * Because the structure differs, the same content produces genuinely
 * different pages rather than the same page in a different typeface.
 */
import {
  CANVAS_W, CANVAS_H, makeElement, type SlideElement,
} from "./elements";
import type { Composer } from "./composers";

/* ------------------------------------------------------------------ */
/* 8. GALLERY — the composition is an image grid                       */
/* ------------------------------------------------------------------ */

const GAP = 10;
const GCOL = 12;
const GROW = 8;
const cellW = (CANVAS_W - GAP * (GCOL + 1)) / GCOL;
const cellH = (CANVAS_H - GAP * (GROW + 1)) / GROW;

/** A grid cell rectangle, in canvas pixels. Columns and rows are 1-based
 *  and end-exclusive, matching how CSS grid lines are written. */
function cell(c1: number, c2: number, r1: number, r2: number) {
  return {
    x: Math.round(GAP + (c1 - 1) * (cellW + GAP)),
    y: Math.round(GAP + (r1 - 1) * (cellH + GAP)),
    w: Math.round((c2 - c1) * cellW + (c2 - c1 - 1) * GAP),
    h: Math.round((r2 - r1) * cellH + (r2 - r1 - 1) * GAP),
  };
}

export const composeGallery: Composer = (c) => {
  const els: SlideElement[] = [];
  const images = c.galleryImages ?? (c.image ? [c.image] : []);

  if (c.kind === "cover") {
    const panel = cell(1, 8, 1, 9);
    els.push(makeElement("image", { ...panel, z: 5 },
      { objectFit: "cover", focusY: 0.45 }, { src: images[0] ?? null }));

    const right = cell(8, 13, 1, 9);
    els.push(makeElement("shape", { ...right, z: 5 }, { background: "ink", shape: "rect" }));
    els.push(makeElement("heading",
      { x: right.x + 44, y: right.y + 180, w: right.w - 88, h: 220, z: 12 },
      { color: "inverse", fontFamily: "display", fontSize: 58, fontWeight: 600, lineHeight: 1.04, letterSpacing: "-0.03em" },
      { text: c.title }));
    if (c.paragraphs[0]) {
      els.push(makeElement("text",
        { x: right.x + 44, y: right.y + 420, w: right.w - 88, h: 110, z: 12 },
        { color: "inverse", fontFamily: "body", fontSize: 17, lineHeight: 1.65, opacity: 0.72 },
        { text: c.paragraphs[0].text }));
    }
    if (c.logo) {
      els.push(makeElement("logo", { x: right.x + 44, y: right.y + 48, w: 80, h: 26, z: 14 },
        { objectFit: "contain" }, { src: c.logo, locked: true }));
    }
    return { elements: els, background: "ink" };
  }

  if (c.kind === "contents") {
    // Gallery needs its own contents composition. Without this branch the
    // slide fell through to the normal image-grid body layout, which had no
    // use for c.contents and produced an empty, miscoloured TOC page.
    const header = cell(1, 13, 1, 2);
    els.push(makeElement("shape", { ...header, z: 4 }, { background: "ink", shape: "rect" }));
    els.push(makeElement("heading", { x: 44, y: 28, w: 760, h: 48, z: 12 },
      { color: "inverse", fontFamily: "display", fontSize: 34, fontWeight: 600 },
      { text: c.title }));

    const entries = c.contents ?? [];
    const columns = entries.length > 6 ? 2 : 1;
    const perColumn = Math.max(1, Math.ceil(entries.length / columns));
    entries.forEach((entry, i) => {
      const column = Math.floor(i / perColumn);
      const row = i % perColumn;
      const start = column === 0 ? 1 : 7;
      const end = column === 0 ? 7 : 13;
      const card = cell(start, end, 2 + row, 3 + row);
      els.push(makeElement("shape", { ...card, z: 4 }, { background: "accentSoft", shape: "rect" }));
      els.push(makeElement("pageNumber", {
        x: card.x + 18, y: card.y + 16, w: 54, h: 30, z: 12,
      }, {
        color: "accent", fontFamily: "display", fontSize: 25, fontWeight: 700,
      }, { text: String(i + 3).padStart(2, "0") }));
      els.push(makeElement("text", {
        x: card.x + 82, y: card.y + 17, w: card.w - 102, h: 30, z: 12,
      }, {
        color: "ink", fontFamily: "body", fontSize: 17, fontWeight: 600,
      }, { text: entry.title }));
    });
    return { elements: els, background: "paper" };
  }

  if (c.kind === "team" && c.team?.length) {
    // Portraits fill the grid; names sit in a band beneath each.
    const n = Math.min(c.team.length, 4);
    const span = Math.floor(GCOL / n);
    els.push(makeElement("shape", { ...cell(1, 13, 1, 2), z: 4 }, { background: "ink", shape: "rect" }));
    els.push(makeElement("heading", { x: 44, y: 28, w: 600, h: 48, z: 12 },
      { color: "inverse", fontFamily: "display", fontSize: 34, fontWeight: 600 }, { text: c.title }));
    c.team.slice(0, 4).forEach((p, i) => {
      const f = cell(1 + i * span, 1 + (i + 1) * span, 2, 8);
      els.push(makeElement("portrait", { ...f, z: 8 },
        { objectFit: "cover", focusY: 0.3 }, { src: p.photo_data_url || null, text: p.name }));
      const band = cell(1 + i * span, 1 + (i + 1) * span, 8, 9);
      els.push(makeElement("shape", { ...band, z: 9 }, { background: "accent", shape: "rect" }));
      els.push(makeElement("text", { x: band.x + 20, y: band.y + 14, w: band.w - 40, h: 24, z: 12 },
        { color: "ink", fontFamily: "display", fontSize: 18, fontWeight: 700 }, { text: p.name }));
      els.push(makeElement("caption", { x: band.x + 20, y: band.y + 40, w: band.w - 40, h: 18, z: 12 },
        { color: "ink", fontFamily: "label", fontSize: 12, opacity: 0.7 }, { text: p.role }));
    });
    return { elements: els };
  }

  if (c.chart) {
    els.push(makeElement("shape", { ...cell(1, 13, 1, 2), z: 4 }, { background: "ink", shape: "rect" }));
    els.push(makeElement("heading", { x: 44, y: 26, w: 700, h: 44, z: 12 },
      { color: "inverse", fontFamily: "display", fontSize: 32, fontWeight: 600 }, { text: c.title }));
    els.push(makeElement("chart", { ...cell(1, 9, 2, 9), z: 8 }, {}, { chart: c.chart }));
    const side = cell(9, 13, 2, 9);
    els.push(makeElement("shape", { ...side, z: 6 }, { background: "accentSoft", shape: "rect" }));
    if (c.paragraphs[0]) {
      els.push(makeElement("text", { x: side.x + 32, y: side.y + 36, w: side.w - 64, h: side.h - 72, z: 10 },
        { color: "ink", fontFamily: "body", fontSize: 16, lineHeight: 1.6 }, { text: c.paragraphs[0].text }));
    }
    return { elements: els };
  }

  // Body: a large text panel, an image panel, and supporting cells. The
  // arrangement alternates with the page number so consecutive slides in a
  // deck do not mirror each other exactly.
  const flip = (c.pageNumber ?? 0) % 2 === 0;
  const textPanel = flip ? cell(1, 8, 1, 5) : cell(6, 13, 1, 5);
  const imgPanel = flip ? cell(8, 13, 1, 5) : cell(1, 6, 1, 5);

  els.push(makeElement("shape", { ...textPanel, z: 5 }, { background: "ink", shape: "rect" }));
  els.push(makeElement("caption",
    { x: textPanel.x + 44, y: textPanel.y + 44, w: 300, h: 18, z: 12 },
    { color: "accent", fontFamily: "label", fontSize: 11, letterSpacing: "0.16em" },
    { text: `${String(c.pageNumber ?? 1).padStart(2, "0")} — ${(c.kind ?? "").toUpperCase().replace("_", " ")}` }));
  els.push(makeElement("heading",
    { x: textPanel.x + 44, y: textPanel.y + 90, w: textPanel.w - 88, h: 130, z: 12 },
    { color: "inverse", fontFamily: "display", fontSize: 48, fontWeight: 600, lineHeight: 1.06, letterSpacing: "-0.025em" },
    { text: c.title }));
  if (c.paragraphs[0]) {
    els.push(makeElement("text",
      { x: textPanel.x + 44, y: textPanel.y + 232, w: textPanel.w - 88, h: textPanel.h - 276, z: 12 },
      { color: "inverse", fontFamily: "body", fontSize: 16.5, lineHeight: 1.65, opacity: 0.74 },
      { text: c.paragraphs[0].text, source: c.paragraphs[0].source }));
  }

  els.push(makeElement("image", { ...imgPanel, z: 5 },
    { objectFit: "cover", focusY: 0.45 }, { src: images[0] ?? null }));

  // Lower band: two image cells and an accent panel carrying a point.
  els.push(makeElement("image", { ...cell(1, 4, 5, 9), z: 5 },
    { objectFit: "cover" }, { src: images[1] ?? null }));
  els.push(makeElement("image", { ...cell(4, 7, 5, 9), z: 5 },
    { objectFit: "cover" }, { src: images[2] ?? null }));

  const accent = cell(7, 13, 5, 9);
  els.push(makeElement("shape", { ...accent, z: 5 }, { background: "accent", shape: "rect" }));
  const point = c.paragraphs[1]?.text ?? c.paragraphs[0]?.text ?? "";
  els.push(makeElement("heading",
    { x: accent.x + 44, y: accent.y + 40, w: accent.w - 88, h: accent.h - 130, z: 12 },
    { color: "ink", fontFamily: "display", fontSize: 34, fontWeight: 600, lineHeight: 1.18 },
    { text: point }));
  els.push(makeElement("caption",
    { x: accent.x + 44, y: accent.y + accent.h - 54, w: 200, h: 18, z: 12 },
    { color: "ink", fontFamily: "label", fontSize: 11, opacity: 0.6, letterSpacing: "0.12em" },
    { text: (c.companyName ?? "").toUpperCase(), locked: true }));
  els.push(makeElement("pageNumber",
    { x: accent.x + accent.w - 100, y: accent.y + accent.h - 74, w: 60, h: 44, z: 12 },
    { color: "ink", fontFamily: "display", fontSize: 40, fontWeight: 700, align: "right" },
    { text: String(c.pageNumber ?? 1).padStart(2, "0"), locked: true }));

  return { elements: els };
};

/* ------------------------------------------------------------------ */
/* 9. DOSSIER — a ruled technical document                             */
/* ------------------------------------------------------------------ */

const DM = 64;

export const composeDossier: Composer = (c) => {
  const els: SlideElement[] = [];

  // The document's masthead, identical on every page.
  els.push(makeElement("shape", { x: 0, y: 0, w: CANVAS_W, h: 5, z: 6 },
    { background: "accent", shape: "rect" }));
  els.push(makeElement("caption", { x: DM, y: 46, w: 520, h: 20, z: 10 },
    { color: "ink", fontFamily: "label", fontSize: 15, fontWeight: 700, letterSpacing: "0.06em" },
    { text: (c.kind === "cover" ? (c.companyName ?? "") : c.title).toUpperCase() }));
  els.push(makeElement("caption", { x: CANVAS_W - DM - 420, y: 48, w: 420, h: 18, z: 10 },
    { color: "muted", fontFamily: "label", fontSize: 12, align: "right" },
    { text: `${(c.companyName ?? "").toUpperCase()} · §${String(c.pageNumber ?? 1).padStart(2, "0")}`, locked: true }));
  els.push(makeElement("rule", { x: DM, y: 80, w: CANVAS_W - DM * 2, h: 1.5, z: 10 },
    { background: "ink" }));
  els.push(makeElement("rule", { x: DM, y: CANVAS_H - 60, w: CANVAS_W - DM * 2, h: 1, z: 10 },
    { background: "rule" }));
  els.push(makeElement("caption", { x: DM, y: CANVAS_H - 48, w: 400, h: 16, z: 10 },
    { color: "muted", fontFamily: "label", fontSize: 10.5 },
    { text: "PREPARED WITH PROVISIO", locked: true }));
  els.push(makeElement("pageNumber", { x: CANVAS_W - DM - 60, y: CANVAS_H - 48, w: 60, h: 16, z: 10 },
    { color: "muted", fontFamily: "label", fontSize: 10.5, align: "right" },
    { text: String(c.pageNumber ?? 1).padStart(2, "0"), locked: true }));
  if (c.kind === "cover") {
    els.push(makeElement("heading", { x: DM, y: 250, w: 820, h: 140, z: 10 },
      { color: "ink", fontFamily: "display", fontSize: 62, fontWeight: 600, lineHeight: 1.05, letterSpacing: "-0.03em" },
      { text: c.title }));
    els.push(makeElement("rule", { x: DM, y: 410, w: CANVAS_W - DM * 2, h: 1, z: 10 }, { background: "rule" }));
    if (c.paragraphs[0]) {
      els.push(makeElement("text", { x: DM, y: 436, w: 700, h: 100, z: 10 },
        { color: "muted", fontFamily: "body", fontSize: 19, lineHeight: 1.6 },
        { text: c.paragraphs[0].text }));
    }
    if (c.logo) {
      els.push(makeElement("logo", { x: CANVAS_W - DM - 120, y: 250, w: 120, h: 38, z: 12 },
        { objectFit: "contain" }, { src: c.logo, locked: true }));
    }
    const meta: [string, string][] = [
      ["DATE", new Date().toLocaleDateString(undefined, { month: "short", year: "numeric" })],
      ["SECTIONS", String(c.totalPages ?? "—")],
      ["STATUS", "FOR REVIEW"],
    ];
    meta.forEach(([k, v], i) => {
      const x = DM + i * 230;
      els.push(makeElement("caption", { x, y: CANVAS_H - 160, w: 200, h: 14, z: 10 },
        { color: "muted", fontFamily: "label", fontSize: 10, letterSpacing: "0.12em" }, { text: k }));
      els.push(makeElement("text", { x, y: CANVAS_H - 140, w: 200, h: 22, z: 10 },
        { color: "ink", fontFamily: "label", fontSize: 15 }, { text: v }));
    });
    return { elements: els };
  }

  if (c.kind === "contents") {
    // Dossier is a ruled document, so the TOC must use the same masthead and
    // table rhythm as the rest of the template instead of falling through to
    // the finding/body layout.
    els.push(makeElement("heading", { x: DM, y: 118, w: 500, h: 58, z: 10 },
      { color: "ink", fontFamily: "display", fontSize: 38, fontWeight: 600 },
      { text: c.title }));
    const entries = c.contents ?? [];
    const rowH = Math.min(62, Math.floor(470 / Math.max(entries.length, 1)));
    entries.forEach((entry, i) => {
      const y = 205 + i * rowH;
      els.push(makeElement("caption", { x: DM, y: y + 18, w: 42, h: 18, z: 10 },
        { color: "accent", fontFamily: "label", fontSize: 12, fontWeight: 700 },
        { text: String(i + 3).padStart(2, "0") }));
      els.push(makeElement("text", { x: DM + 58, y: y + 12, w: CANVAS_W - DM * 2 - 58, h: rowH - 18, z: 10 },
        { color: "ink", fontFamily: "body", fontSize: 18, lineHeight: 1.3 },
        { text: entry.title }));
      els.push(makeElement("rule", { x: DM, y: y + rowH - 1, w: CANVAS_W - DM * 2, h: 1, z: 10 },
        { background: "rule" }));
    });
    return { elements: els };
  }

  // Body: a narrow left rail carrying the question and a verdict, and a
  // wide ruled table of findings on the right. This is the shape a real
  // diligence memo takes.
  const railW = 330;
  els.push(makeElement("heading", { x: DM, y: 118, w: railW, h: 110, z: 10 },
    { color: "ink", fontFamily: "display", fontSize: 32, fontWeight: 600, lineHeight: 1.14, letterSpacing: "-0.02em" },
    { text: c.title }));

  const lead = c.paragraphs[0];
  if (lead) {
    els.push(makeElement("text", { x: DM, y: 240, w: railW, h: 78, z: 10 },
      { color: "muted", fontFamily: "body", fontSize: 14, lineHeight: 1.6 },
      { text: lead.text, source: lead.source }));
    els.push(makeElement("shape", { x: DM, y: 336, w: railW, h: 92, z: 5 },
      { background: "accentSoft", shape: "rect" }));
    els.push(makeElement("shape", { x: DM, y: 336, w: 3, h: 92, z: 6 },
      { background: "accent", shape: "rect" }));
    els.push(makeElement("caption", { x: DM + 18, y: 354, w: railW - 36, h: 14, z: 10 },
      { color: "accent", fontFamily: "label", fontSize: 10.5, letterSpacing: "0.1em" }, { text: "VERDICT" }));
    els.push(makeElement("text", { x: DM + 18, y: 374, w: railW - 36, h: 44, z: 10 },
      { color: "ink", fontFamily: "body", fontSize: 14, lineHeight: 1.55 },
      { text: c.paragraphs[1]?.text ?? "Assessed from the production repository." }));
  }

  const tableX = DM + railW + 40;
  const tableW = CANVAS_W - DM - tableX;
  els.push(makeElement("caption", { x: tableX, y: 118, w: 30, h: 14, z: 10 },
    { color: "muted", fontFamily: "label", fontSize: 10, letterSpacing: "0.1em" }, { text: "#" }));
  els.push(makeElement("caption", { x: tableX + 52, y: 118, w: 300, h: 14, z: 10 },
    { color: "muted", fontFamily: "label", fontSize: 10, letterSpacing: "0.1em" }, { text: "FINDING" }));
  els.push(makeElement("rule", { x: tableX, y: 140, w: tableW, h: 1, z: 10 }, { background: "ink" }));

  const rows = c.paragraphs.slice(lead ? 2 : 0, (lead ? 2 : 0) + 4);
  const rowH = Math.min(108, Math.floor((CANVAS_H - 200 - 140) / Math.max(rows.length, 1)));
  rows.forEach((p, i) => {
    const y = 140 + i * rowH;
    els.push(makeElement("caption", { x: tableX, y: y + 22, w: 34, h: 16, z: 10 },
      { color: "accent", fontFamily: "label", fontSize: 12 }, { text: String(i + 1).padStart(2, "0") }));
    els.push(makeElement("text", { x: tableX + 52, y: y + 18, w: tableW - 52, h: rowH - 36, z: 10 },
      { color: "ink", fontFamily: "body", fontSize: 14, lineHeight: 1.6 },
      { text: p.text, source: p.source }));
    els.push(makeElement("rule", { x: tableX, y: y + rowH, w: tableW, h: 1, z: 10 }, { background: "rule" }));
  });

  if (c.chart) {
    els.push(makeElement("chart", { x: tableX, y: 160, w: tableW, h: 380, z: 10 }, {}, { chart: c.chart }));
  }
  return { elements: els };
};

/* ------------------------------------------------------------------ */
/* 10. EDITION — a magazine spread                                     */
/* ------------------------------------------------------------------ */

export const composeEdition: Composer = (c) => {
  const els: SlideElement[] = [];
  if (c.kind === "contents") {
    els.push(makeElement("shape", { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, z: 0 }, { background: "paper", shape: "rect" }));
    els.push(makeElement("heading", { x: 64, y: 70, w: 720, h: 70, z: 10 },
      { color: "ink", fontFamily: "display", fontSize: 48, fontWeight: 700 }, { text: c.title }));
    (c.contents ?? []).forEach((entry, i) => {
      const y = 170 + i * 48;
      els.push(makeElement("caption", { x: 64, y, w: 48, h: 20, z: 10 },
        { color: "accent", fontFamily: "label", fontSize: 12, fontWeight: 700 },
        { text: String(i + 3).padStart(2, "0") }));
      els.push(makeElement("text", { x: 128, y: y - 2, w: 900, h: 28, z: 10 },
        { color: "ink", fontFamily: "body", fontSize: 19 }, { text: entry.title }));
      els.push(makeElement("rule", { x: 64, y: y + 30, w: 1060, h: 1, z: 10 }, { background: "rule" }));
    });
    return { elements: els };
  }
  const splitAt = Math.round(CANVAS_W * 0.52);
  const imageLeft = (c.pageNumber ?? 0) % 2 === 1;
  const imgX = imageLeft ? 0 : splitAt;
  const txtX = imageLeft ? splitAt : 0;
  const pad = 64;

  els.push(makeElement("image",
    { x: imgX, y: 0, w: CANVAS_W - splitAt + (imageLeft ? 0 : 0), h: CANVAS_H, z: 2 },
    { objectFit: "cover", focusY: 0.42 }, { src: c.image ?? null }));
  // The image panel is the full remaining width, whichever side it is on.
  els[els.length - 1].frame.w = imageLeft ? splitAt : CANVAS_W - splitAt;

  const colX = txtX + pad + (imageLeft ? 8 : 0);
  const colW = (imageLeft ? CANVAS_W - splitAt : splitAt) - pad * 2;

  els.push(makeElement("caption", { x: colX, y: 76, w: colW, h: 16, z: 10 },
    { color: "accent", fontFamily: "label", fontSize: 10.5, letterSpacing: "0.2em" },
    { text: (c.kind ?? "section").toUpperCase().replace("_", " ") }));

  els.push(makeElement("heading", { x: colX, y: 110, w: colW, h: 150, z: 10 },
    { color: "ink", fontFamily: "display", fontSize: 46, fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.015em" },
    { text: c.title }));

  els.push(makeElement("rule", { x: colX, y: 286, w: 52, h: 2, z: 10 }, { background: "accent" }));

  let y = 312;
  c.paragraphs.slice(0, 3).forEach((p, i) => {
    const h = i === 0 ? 150 : 92;
    els.push(makeElement("text", { x: colX, y, w: colW, h, z: 10 },
      { color: i === 0 ? "ink" : "muted", fontFamily: "body", fontSize: i === 0 ? 15.5 : 14, lineHeight: 1.75 },
      { text: p.text, source: p.source }));
    y += h + 14;
  });

  els.push(makeElement("rule", { x: colX, y: CANVAS_H - 86, w: colW, h: 1, z: 10 }, { background: "rule" }));
  els.push(makeElement("caption", { x: colX, y: CANVAS_H - 70, w: 220, h: 16, z: 10 },
    { color: "muted", fontFamily: "label", fontSize: 11, letterSpacing: "0.08em" },
    { text: (c.companyName ?? "").toUpperCase(), locked: true }));
  els.push(makeElement("pageNumber", { x: colX + colW - 60, y: CANVAS_H - 72, w: 60, h: 20, z: 10 },
    { color: "ink", fontFamily: "display", fontSize: 15, fontWeight: 700, align: "right" },
    { text: String(c.pageNumber ?? 1).padStart(2, "0"), locked: true }));
  if (c.logo) {
    els.push(makeElement("logo", { x: colX + colW - 74, y: 70, w: 74, h: 24, z: 12 },
      { objectFit: "contain", opacity: 0.75 }, { src: c.logo, locked: true }));
  }

  if (c.chart) {
    els.push(makeElement("chart", { x: colX, y: 312, w: colW, h: 300, z: 11 }, {}, { chart: c.chart }));
  }
  return { elements: els };
};

/* ------------------------------------------------------------------ */
/* 11. SIGNAL — a colour field, type only                              */
/* ------------------------------------------------------------------ */

const SM = 72;

export const composeSignal: Composer = (c) => {
  const els: SlideElement[] = [
    makeElement("shape", { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, z: 0 },
      { background: c.kind === "cover" ? "ink" : "accent", shape: "rect" }),
  ];

  if (c.kind === "contents") {
    els.push(makeElement("heading", { x: SM, y: 110, w: 900, h: 70, z: 10 },
      { color: "inverse", fontFamily: "display", fontSize: 58, fontWeight: 700 }, { text: c.title }));
    (c.contents ?? []).forEach((entry, i) => {
      const y = 220 + i * 48;
      els.push(makeElement("caption", { x: SM, y, w: 52, h: 20, z: 10 },
        { color: "inverse", fontFamily: "label", fontSize: 12, opacity: 0.7 },
        { text: String(i + 3).padStart(2, "0") }));
      els.push(makeElement("text", { x: SM + 72, y: y - 2, w: 900, h: 28, z: 10 },
        { color: "inverse", fontFamily: "body", fontSize: 19 }, { text: entry.title }));
    });
    return { elements: els, background: "accent" };
  }

  els.push(makeElement("caption", { x: SM, y: 56, w: 340, h: 18, z: 10 },
    { color: "inverse", fontFamily: "label", fontSize: 11, letterSpacing: "0.2em", opacity: 0.65 },
    { text: (c.companyName ?? "").toUpperCase(), locked: true }));
  els.push(makeElement("pageNumber", { x: CANVAS_W - SM - 160, y: 56, w: 160, h: 18, z: 10 },
    { color: "inverse", fontFamily: "label", fontSize: 11, letterSpacing: "0.2em", align: "right", opacity: 0.65 },
    { text: `${String(c.pageNumber ?? 1).padStart(2, "0")} / ${c.totalPages ?? "—"}`, locked: true }));
  if (c.logo) {
    // Beside the company name rather than stacked under it, which left the
    // header reading as three cramped lines.
    els.push(makeElement("logo", { x: CANVAS_W - SM - 74 - 190, y: 50, w: 74, h: 24, z: 12 },
      { objectFit: "contain", opacity: 0.8 }, { src: c.logo, locked: true }));
  }

  const lead = c.paragraphs[0]?.text ?? "";
  // The headline is the slide. Size steps down only as the text lengthens,
  // so short claims land enormous and long ones stay readable.
  const size = lead.length < 30 ? 168 : lead.length < 70 ? 118 : lead.length < 130 ? 82 : 58;

  // The headline is vertically centred in the band between the header and
  // the base rule, so a short claim and a long one both sit balanced
  // instead of hugging the top and leaving the middle empty.
  const bandTop = 150;
  const bandBottom = CANVAS_H - 190;
  const fontSize = c.kind === "cover" ? 156 : size;
  const text = c.kind === "cover" ? c.title : lead || c.title;
  const estLines = Math.max(1, Math.ceil(text.length / Math.max(12, (CANVAS_W - SM * 2) / (fontSize * 0.46))));
  const headH = Math.min(bandBottom - bandTop, estLines * fontSize * 0.94);
  const headY = Math.round(bandTop + (bandBottom - bandTop - headH) / 2);

  if (c.kind !== "cover" && c.title && lead) {
    els.push(makeElement("caption", { x: SM, y: headY - 42, w: 560, h: 20, z: 10 },
      { color: "inverse", fontFamily: "label", fontSize: 13, letterSpacing: "0.14em", opacity: 0.7 },
      { text: c.title.toUpperCase() }));
  }

  els.push(makeElement("heading", { x: SM, y: headY, w: CANVAS_W - SM * 2, h: Math.ceil(headH), z: 10 },
    { color: "inverse", fontFamily: "display", fontSize,
      fontWeight: 700, lineHeight: 0.94, letterSpacing: "-0.045em" },
    { text }));

  els.push(makeElement("rule", { x: SM, y: CANVAS_H - 168, w: CANVAS_W - SM * 2, h: 1, z: 10 },
    { background: "inverse", opacity: 0.25 }));

  const support = c.paragraphs.slice(c.kind === "cover" ? 0 : 1, c.kind === "cover" ? 1 : 3);
  support.forEach((p, i) => {
    els.push(makeElement("text",
      { x: SM + i * ((CANVAS_W - SM * 2) / 2 + 20), y: CANVAS_H - 140, w: (CANVAS_W - SM * 2) / 2 - 30, h: 90, z: 10 },
      { color: "inverse", fontFamily: "body", fontSize: 17, lineHeight: 1.55, opacity: 0.85 },
      { text: p.text, source: p.source }));
  });

  if (c.chart) {
    els.push(makeElement("chart", { x: SM, y: 200, w: CANVAS_W - SM * 2, h: 340, z: 11 }, {}, { chart: c.chart }));
  }
  return { elements: els, background: c.kind === "cover" ? "ink" : "accent" };
};
