/**
 * Four new, self-contained design systems.
 *
 * Each is a coherent system rather than a reskin: its own canvas ground,
 * accent discipline, type scale and structural moves. They follow the same
 * composer contract as templates-v2 — a `(SlideContentInput) => { elements,
 * background }` function using `makeElement` — and every one handles all slide
 * kinds (cover, contents, team, chart, and a generic body that serves
 * problem/solution/market/… and any other kind) without crashing on absent
 * content.
 *
 * Colour identity is expressed as literal hex (via element `color`/`background`
 * styles, which resolve as-is) so each system holds its look. Fonts stay on the
 * theme tokens ("display"/"body"/"label"), as every composer in this codebase
 * does; the per-template font families are declared in TEMPLATES and used by
 * the viewer. Content blocks are injected by the shared `compose()` wrapper, so
 * composers do not render them here.
 */
import { CANVAS_W, CANVAS_H, makeElement, type SlideElement } from "./elements";
import type { Composer, SlideContentInput } from "./composers";

function canvas(color: string): SlideElement {
  return makeElement("shape", { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, z: 0 }, { background: color, shape: "rect" });
}

function kindLabel(c: SlideContentInput): string {
  return (c.kind ?? "custom").replace(/_/g, " ").toUpperCase();
}

/* ================================================================== */
/* 1. OBSIDIAN — near-black canvas, gold accents, high contrast         */
/* ================================================================== */

const OBS = { bg: "#0d0d0b", text: "#f5f0e8", gold: "#c9a84c" };
const OBM = 88;

export const composeObsidian: Composer = (c) => {
  const els: SlideElement[] = [canvas(OBS.bg)];
  const lead = c.paragraphs?.[0];

  if (c.logo) {
    els.push(makeElement("logo", { x: OBM, y: 56, w: 92, h: 28, z: 40 },
      { objectFit: "contain", opacity: 0.9 }, { src: c.logo, locked: true }));
  }

  if (c.kind === "cover") {
    els.push(makeElement("rule", { x: OBM, y: 360, w: 120, h: 1, z: 10 }, { background: OBS.gold }));
    els.push(makeElement("heading", { x: OBM, y: 380, w: 960, h: 130, z: 10 },
      { color: OBS.text, fontFamily: "display", fontSize: 72, fontWeight: 400, lineHeight: 1.04, letterSpacing: "-0.015em" },
      { text: c.title }));
    if (lead) {
      els.push(makeElement("text", { x: OBM, y: 520, w: 720, h: 80, z: 10 },
        { color: OBS.text, fontFamily: "body", fontSize: 24, fontWeight: 300, lineHeight: 1.45, opacity: 0.65 },
        { text: lead.text }));
    }
    els.push(makeElement("caption", { x: CANVAS_W - OBM - 280, y: CANVAS_H - 58, w: 280, h: 16, z: 40 },
      { color: OBS.gold, fontFamily: "label", fontSize: 12, align: "right", letterSpacing: "0.1em", opacity: 0.6 },
      { text: "CONFIDENTIAL", locked: true }));
    return { elements: els, background: "ink" };
  }

  const header = (title: string) => {
    els.push(makeElement("heading", { x: OBM, y: 52, w: 960, h: 52, z: 10 },
      { color: OBS.text, fontFamily: "display", fontSize: 42, fontWeight: 400, lineHeight: 1.05 }, { text: title }));
    els.push(makeElement("rule", { x: OBM, y: 108, w: CANVAS_W - OBM * 2, h: 1, z: 10 }, { background: OBS.gold }));
  };
  const footer = () => {
    els.push(makeElement("caption", { x: OBM, y: CANVAS_H - 48, w: 360, h: 16, z: 40 },
      { color: OBS.text, fontFamily: "label", fontSize: 11, letterSpacing: "0.08em", opacity: 0.4 },
      { text: (c.companyName ?? "").toUpperCase(), locked: true }));
    els.push(makeElement("pageNumber", { x: CANVAS_W - OBM - 60, y: CANVAS_H - 48, w: 60, h: 16, z: 40 },
      { color: OBS.gold, fontFamily: "label", fontSize: 11, align: "right" },
      { text: String(c.pageNumber ?? 1).padStart(2, "0"), locked: true }));
  };

  if (c.kind === "contents") {
    header(c.title);
    (c.contents ?? []).slice(0, 10).forEach((e, i) => {
      const y = 150 + i * 46;
      els.push(makeElement("caption", { x: OBM, y, w: 50, h: 24, z: 10 },
        { color: OBS.gold, fontFamily: "label", fontSize: 16 }, { text: String(i + 3).padStart(2, "0") }));
      els.push(makeElement("text", { x: OBM + 70, y: y - 2, w: CANVAS_W - OBM * 2 - 70, h: 26, z: 10 },
        { color: OBS.text, fontFamily: "body", fontSize: 19, opacity: 0.85 }, { text: e.title }));
    });
    footer();
    return { elements: els, background: "ink" };
  }

  if (c.kind === "team" && (c.team?.length ?? 0) > 0) {
    header(c.title);
    const team = c.team!.slice(0, 4);
    const gap = 40;
    const w = (CANVAS_W - OBM * 2 - gap * (team.length - 1)) / team.length;
    // Smaller portraits when the row is full, so the names and roles below
    // clear the footer instead of being squeezed against it.
    const photoH = w * (team.length >= 4 ? 0.95 : 1.1);
    const top = 150;
    team.forEach((p, i) => {
      const x = OBM + i * (w + gap);
      const name = p.name || "";
      // Long names drop a step so they don't clip; the box holds two lines and
      // the role is placed from the box's bottom, never a fixed offset.
      const nameSize = name.length > 20 ? 16 : 20;
      const nameH = nameSize * 1.25 * 2;
      const nameY = top + photoH + 24;
      const roleY = nameY + nameH + 8;
      els.push(makeElement("portrait", { x, y: top, w, h: photoH, z: 10 },
        { objectFit: "cover", filter: "grayscale(0.5)" }, { src: p.photo_data_url || null, text: name }));
      els.push(makeElement("rule", { x, y: top + photoH + 14, w: 32, h: 1, z: 10 }, { background: OBS.gold }));
      els.push(makeElement("text", { x, y: nameY, w, h: nameH, z: 10 },
        { color: OBS.text, fontFamily: "display", fontSize: nameSize, fontWeight: 400, lineHeight: 1.25 }, { text: name }));
      els.push(makeElement("caption", { x, y: roleY, w, h: 18, z: 10 },
        { color: OBS.gold, fontFamily: "label", fontSize: 12 }, { text: p.role }));
    });
    footer();
    return { elements: els, background: "ink" };
  }

  if (c.chart) {
    header(c.title);
    els.push(makeElement("chart", { x: OBM, y: 150, w: CANVAS_W - OBM * 2, h: 380, z: 10 }, {}, { chart: c.chart }));
    if (lead) {
      els.push(makeElement("caption", { x: OBM, y: 548, w: 760, h: 48, z: 10 },
        { color: OBS.text, fontFamily: "body", fontSize: 15, lineHeight: 1.5, opacity: 0.6 }, { text: lead.text }));
    }
    footer();
    return { elements: els, background: "ink" };
  }

  // Generic body.
  header(c.title);
  if (lead) {
    els.push(makeElement("statement", { x: OBM, y: 146, w: 840, h: 170, z: 10 },
      { color: OBS.text, fontFamily: "display", fontSize: 30, fontWeight: 400, lineHeight: 1.3 },
      { text: lead.text, source: lead.source }));
  }
  (c.paragraphs ?? []).slice(1, 4).forEach((p, i) => {
    els.push(makeElement("text", { x: OBM, y: 330 + i * 70, w: 840, h: 64, z: 10 },
      { color: OBS.text, fontFamily: "body", fontSize: 18, fontWeight: 300, lineHeight: 1.6, opacity: 0.7 },
      { text: p.text, source: p.source }));
  });
  footer();
  return { elements: els, background: "ink" };
};

/* ================================================================== */
/* 2. BRUTUS — maximum type, hard edges, zero decoration                */
/* ================================================================== */

const BRUT = { ink: "#0a0a0a", paper: "#f0f0f0", accent: "#ff3300", white: "#ffffff" };
const BRM = 100;

export const composeBrutus: Composer = (c) => {
  const els: SlideElement[] = [];
  const lead = c.paragraphs?.[0];

  if (c.kind === "cover") {
    els.push(canvas(BRUT.accent));
    els.push(makeElement("heading", { x: BRM, y: 120, w: CANVAS_W - BRM * 2, h: 300, z: 10 },
      { color: BRUT.white, fontFamily: "display", fontSize: 88, fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em" },
      { text: (c.title || "").toUpperCase() }));
    if (lead) {
      els.push(makeElement("text", { x: BRM, y: 440, w: 760, h: 100, z: 10 },
        { color: BRUT.white, fontFamily: "body", fontSize: 24, fontWeight: 500, lineHeight: 1.35, opacity: 0.85 },
        { text: lead.text }));
    }
    els.push(makeElement("caption", { x: BRM, y: CANVAS_H - 56, w: 440, h: 16, z: 40 },
      { color: BRUT.white, fontFamily: "label", fontSize: 11, letterSpacing: "0.1em", opacity: 0.6 },
      { text: (c.companyName ?? "").toUpperCase(), locked: true }));
    if (c.logo) {
      els.push(makeElement("logo", { x: CANVAS_W - BRM - 90, y: 60, w: 90, h: 28, z: 40 }, { objectFit: "contain" }, { src: c.logo, locked: true }));
    }
    return { elements: els, background: "accent" };
  }

  // Alternating emphasis without ornament: even pages invert to the ink ground.
  const dark = (c.pageNumber ?? 1) % 2 === 0;
  const ground = dark ? BRUT.ink : BRUT.paper;
  const text = dark ? BRUT.paper : BRUT.ink;
  const bgToken = dark ? "ink" : "paper";
  els.push(canvas(ground));

  const pageNum = () => els.push(makeElement("pageNumber", { x: CANVAS_W - BRM - 60, y: CANVAS_H - 56, w: 60, h: 16, z: 40 },
    { color: text, fontFamily: "label", fontSize: 12, align: "right" },
    { text: String(c.pageNumber ?? 1).padStart(2, "0"), locked: true }));

  if (c.kind === "contents") {
    els.push(makeElement("heading", { x: BRM, y: 90, w: CANVAS_W - BRM * 2, h: 90, z: 10 },
      { color: text, fontFamily: "display", fontSize: 72, fontWeight: 900, letterSpacing: "-0.02em" }, { text: "CONTENTS" }));
    (c.contents ?? []).slice(0, 9).forEach((e, i) => {
      els.push(makeElement("text", { x: BRM, y: 210 + i * 48, w: CANVAS_W - BRM * 2, h: 40, z: 10 },
        { color: i === 0 ? BRUT.accent : text, fontFamily: "body", fontSize: 22, fontWeight: 500 },
        { text: `${String(i + 1).padStart(2, "0")}  ${e.title}` }));
    });
    pageNum();
    return { elements: els, background: bgToken };
  }

  if (c.kind === "team" && (c.team?.length ?? 0) > 0) {
    els.push(makeElement("heading", { x: BRM, y: 80, w: CANVAS_W - BRM * 2, h: 84, z: 10 },
      { color: text, fontFamily: "display", fontSize: 72, fontWeight: 900, letterSpacing: "-0.02em" }, { text: "TEAM" }));
    const team = c.team!.slice(0, 4);
    const gap = 36;
    const w = (CANVAS_W - BRM * 2 - gap * (team.length - 1)) / team.length;
    // Brutus names are heavy uppercase Archivo, so they clip fastest; shrink
    // the square portrait when full and give the name room for two lines.
    const photoH = w * (team.length >= 4 ? 0.85 : 1);
    const top = 200;
    team.forEach((p, i) => {
      const x = BRM + i * (w + gap);
      const name = (p.name || "").toUpperCase();
      const nameSize = name.length > 20 ? 18 : 22;
      const nameH = nameSize * 1.1 * 2;
      const nameY = top + photoH + 14;
      const roleY = nameY + nameH + 8;
      els.push(makeElement("portrait", { x, y: top, w, h: photoH, z: 10 }, { objectFit: "cover" }, { src: p.photo_data_url || null, text: p.name }));
      els.push(makeElement("text", { x, y: nameY, w, h: nameH, z: 10 },
        { color: text, fontFamily: "display", fontSize: nameSize, fontWeight: 900, lineHeight: 1.1 }, { text: name }));
      els.push(makeElement("caption", { x, y: roleY, w, h: 18, z: 10 },
        { color: BRUT.accent, fontFamily: "label", fontSize: 12, letterSpacing: "0.1em" }, { text: (p.role || "").toUpperCase() }));
    });
    pageNum();
    return { elements: els, background: bgToken };
  }

  if (c.chart) {
    els.push(makeElement("heading", { x: BRM, y: 70, w: CANVAS_W - BRM * 2, h: 84, z: 10 },
      { color: text, fontFamily: "display", fontSize: 64, fontWeight: 900, letterSpacing: "-0.02em" }, { text: (c.title || "").toUpperCase() }));
    els.push(makeElement("chart", { x: BRM, y: 180, w: CANVAS_W - BRM * 2, h: 380, z: 10 }, {}, { chart: c.chart }));
    pageNum();
    return { elements: els, background: bgToken };
  }

  // Generic body — the title IS the top element, no header band.
  els.push(makeElement("heading", { x: BRM, y: 90, w: CANVAS_W - BRM * 2, h: 180, z: 10 },
    { color: text, fontFamily: "display", fontSize: 72, fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em" },
    { text: (c.title || "").toUpperCase() }));
  if (lead) {
    els.push(makeElement("text", { x: BRM, y: 300, w: 680, h: 120, z: 10 },
      { color: text, fontFamily: "body", fontSize: 22, fontWeight: 400, lineHeight: 1.45 }, { text: lead.text, source: lead.source }));
  }
  (c.paragraphs ?? []).slice(1, 4).forEach((p, i) => {
    els.push(makeElement("text", { x: BRM, y: 440 + i * 56, w: 680, h: 50, z: 10 },
      { color: text, fontFamily: "body", fontSize: 18, lineHeight: 1.5, opacity: 0.7 }, { text: p.text, source: p.source }));
  });
  pageNum();
  return { elements: els, background: bgToken };
};

/* ================================================================== */
/* 3. CARTIER — extreme whitespace, precise type, luxury restraint      */
/* ================================================================== */

const CART = { ink: "#1a1a1a", paper: "#ffffff" };
const CARL = 120;
const CARR = 80;

export const composeCartier: Composer = (c) => {
  const els: SlideElement[] = [canvas(CART.paper)];
  const lead = c.paragraphs?.[0];
  const contentW = CANVAS_W - CARL - CARR;

  if (c.logo) {
    els.push(makeElement("logo", { x: CANVAS_W - CARR - 90, y: 60, w: 90, h: 26, z: 40 }, { objectFit: "contain" }, { src: c.logo, locked: true }));
  }

  if (c.kind === "cover") {
    els.push(makeElement("shape", { x: CARL - 12, y: 278, w: 2, h: 48, z: 10 }, { background: CART.ink, shape: "rect" }));
    els.push(makeElement("heading", { x: CARL, y: 280, w: 760, h: 90, z: 10 },
      { color: CART.ink, fontFamily: "display", fontSize: 64, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.0 }, { text: c.title }));
    if (lead) {
      els.push(makeElement("text", { x: CARL, y: 372, w: 580, h: 90, z: 10 },
        { color: CART.ink, fontFamily: "body", fontSize: 22, fontWeight: 300, lineHeight: 1.6, opacity: 0.55 }, { text: lead.text }));
    }
    return { elements: els, background: "paper" };
  }

  // The only decorative element: a single faint hairline under the slug.
  els.push(makeElement("caption", { x: CARL, y: 38, w: 440, h: 16, z: 10 },
    { color: CART.ink, fontFamily: "label", fontSize: 11, letterSpacing: "0.08em", opacity: 0.4 },
    { text: `${String(c.pageNumber ?? 1).padStart(2, "0")} / ${kindLabel(c)}` }));
  els.push(makeElement("rule", { x: CARL, y: 64, w: contentW, h: 1, z: 10 }, { background: CART.ink, opacity: 0.08 }));

  const pageNum = () => els.push(makeElement("pageNumber", { x: CANVAS_W - CARR - 60, y: CANVAS_H - 56, w: 60, h: 16, z: 40 },
    { color: CART.ink, fontFamily: "label", fontSize: 11, align: "right", opacity: 0.4 },
    { text: String(c.pageNumber ?? 1).padStart(2, "0"), locked: true }));

  if (c.kind === "contents") {
    els.push(makeElement("heading", { x: CARL, y: 120, w: 700, h: 56, z: 10 },
      { color: CART.ink, fontFamily: "display", fontSize: 44, fontWeight: 700, letterSpacing: "-0.03em" }, { text: c.title }));
    (c.contents ?? []).slice(0, 10).forEach((e, i) => {
      const y = 210 + i * 42;
      els.push(makeElement("text", { x: CARL, y, w: contentW, h: 32, z: 10 },
        { color: CART.ink, fontFamily: "body", fontSize: 18, fontWeight: 300 }, { text: `${String(i + 3).padStart(2, "0")}    ${e.title}` }));
      els.push(makeElement("rule", { x: CARL, y: y + 34, w: contentW, h: 1, z: 9 }, { background: CART.ink, opacity: 0.06 }));
    });
    pageNum();
    return { elements: els, background: "paper" };
  }

  if (c.kind === "team" && (c.team?.length ?? 0) > 0) {
    els.push(makeElement("heading", { x: CARL, y: 120, w: 700, h: 56, z: 10 },
      { color: CART.ink, fontFamily: "display", fontSize: 44, fontWeight: 700, letterSpacing: "-0.03em" }, { text: c.title }));
    const team = c.team!.slice(0, 4);
    const gap = 48;
    const w = (contentW - gap * (team.length - 1)) / team.length;
    const photoH = w * (team.length >= 4 ? 1.0 : 1.15);
    const top = 210;
    team.forEach((p, i) => {
      const x = CARL + i * (w + gap);
      const name = p.name || "";
      const nameSize = name.length > 20 ? 16 : 20;
      const nameH = nameSize * 1.25 * 2;
      const nameY = top + photoH + 12;
      const roleY = nameY + nameH + 8;
      els.push(makeElement("portrait", { x, y: top, w, h: photoH, z: 10 },
        { objectFit: "cover", filter: "grayscale(1)" }, { src: p.photo_data_url || null, text: name }));
      els.push(makeElement("text", { x, y: nameY, w, h: nameH, z: 10 },
        { color: CART.ink, fontFamily: "display", fontSize: nameSize, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.25 }, { text: name }));
      els.push(makeElement("caption", { x, y: roleY, w, h: 18, z: 10 },
        { color: CART.ink, fontFamily: "label", fontSize: 11, letterSpacing: "0.08em", opacity: 0.5 }, { text: (p.role || "").toUpperCase() }));
    });
    pageNum();
    return { elements: els, background: "paper" };
  }

  if (c.chart) {
    els.push(makeElement("heading", { x: CARL, y: 120, w: 700, h: 52, z: 10 },
      { color: CART.ink, fontFamily: "display", fontSize: 40, fontWeight: 700, letterSpacing: "-0.03em" }, { text: c.title }));
    els.push(makeElement("chart", { x: CARL, y: 200, w: contentW, h: 360, z: 10 }, {}, { chart: c.chart }));
    pageNum();
    return { elements: els, background: "paper" };
  }

  // Generic body.
  els.push(makeElement("heading", { x: CARL, y: 120, w: contentW, h: 70, z: 10 },
    { color: CART.ink, fontFamily: "display", fontSize: 44, fontWeight: 700, letterSpacing: "-0.03em" }, { text: c.title }));
  if (lead) {
    els.push(makeElement("text", { x: CARL, y: 200, w: 640, h: 150, z: 10 },
      { color: CART.ink, fontFamily: "body", fontSize: 18, fontWeight: 300, lineHeight: 1.8 }, { text: lead.text, source: lead.source }));
  }
  (c.paragraphs ?? []).slice(1, 4).forEach((p, i) => {
    els.push(makeElement("text", { x: CARL, y: 360 + i * 84, w: 640, h: 76, z: 10 },
      { color: CART.ink, fontFamily: "body", fontSize: 18, fontWeight: 300, lineHeight: 1.8, opacity: 0.7 }, { text: p.text, source: p.source }));
  });
  pageNum();
  return { elements: els, background: "paper" };
};

/* ================================================================== */
/* 4. HERALD — magazine editorial, serif authority, data in cards       */
/* ================================================================== */

const HER = { forest: "#1a2e1a", cream: "#f5f0e4", lime: "#b5cc47" };
const HM = 88;

function heraldFooter(els: SlideElement[], c: SlideContentInput, color: string) {
  els.push(makeElement("caption", { x: HM, y: CANVAS_H - 48, w: 320, h: 16, z: 40 },
    { color, fontFamily: "label", fontSize: 11, opacity: 0.5, letterSpacing: "0.06em" },
    { text: (c.companyName ?? "").toUpperCase(), locked: true }));
  els.push(makeElement("pageNumber", { x: CANVAS_W - HM - 60, y: CANVAS_H - 48, w: 60, h: 16, z: 40 },
    { color, fontFamily: "label", fontSize: 11, align: "right", opacity: 0.6 },
    { text: String(c.pageNumber ?? 1).padStart(2, "0"), locked: true }));
}

/** A short, bodyless content slide reads as a section divider. */
function isAuthorityDivider(c: SlideContentInput): boolean {
  return (c.paragraphs?.length ?? 0) === 0
    && (c.title?.length ?? 0) > 0
    && c.kind !== "contents" && c.kind !== "team" && !c.chart;
}

export const composeHerald: Composer = (c) => {
  const els: SlideElement[] = [];
  const lead = c.paragraphs?.[0];

  if (c.kind === "cover") {
    els.push(canvas(HER.forest));
    els.push(makeElement("caption", { x: HM, y: 80, w: 500, h: 18, z: 10 },
      { color: HER.lime, fontFamily: "label", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em" },
      { text: (c.companyName || "PITCH").toUpperCase() }));
    els.push(makeElement("rule", { x: HM, y: 160, w: 56, h: 3, z: 10 }, { background: HER.lime }));
    els.push(makeElement("heading", { x: HM, y: 200, w: 920, h: 160, z: 10 },
      { color: HER.cream, fontFamily: "display", fontSize: 72, fontWeight: 600, lineHeight: 1.02, letterSpacing: "-0.02em" },
      { text: c.title }));
    if (lead) {
      els.push(makeElement("text", { x: HM, y: 380, w: 600, h: 90, z: 10 },
        { color: HER.cream, fontFamily: "body", fontSize: 22, lineHeight: 1.5, opacity: 0.65 }, { text: lead.text }));
    }
    if (c.logo) {
      els.push(makeElement("logo", { x: CANVAS_W - HM - 100, y: 70, w: 100, h: 30, z: 40 }, { objectFit: "contain", opacity: 0.9 }, { src: c.logo, locked: true }));
    }
    els.push(makeElement("caption", { x: CANVAS_W - HM - 320, y: CANVAS_H - 58, w: 320, h: 16, z: 40 },
      { color: HER.cream, fontFamily: "label", fontSize: 11, align: "right", opacity: 0.5 },
      { text: new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" }).toUpperCase(), locked: true }));
    return { elements: els, background: "ink" };
  }

  if (c.kind === "ask") {
    els.push(canvas(HER.forest));
    els.push(makeElement("caption", { x: HM, y: 80, w: 400, h: 18, z: 10 },
      { color: HER.lime, fontFamily: "label", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em" }, { text: "THE ASK" }));
    els.push(makeElement("heading", { x: HM, y: 150, w: 980, h: 120, z: 10 },
      { color: HER.lime, fontFamily: "display", fontSize: 80, fontWeight: 700, lineHeight: 1.0 }, { text: lead?.text || c.title }));
    (c.paragraphs ?? []).slice(1, 4).forEach((p, i) => {
      els.push(makeElement("text", { x: HM, y: 320 + i * 64, w: 820, h: 56, z: 10 },
        { color: HER.cream, fontFamily: "body", fontSize: 18, lineHeight: 1.5, opacity: 0.8 }, { text: p.text, source: p.source }));
    });
    heraldFooter(els, c, HER.cream);
    return { elements: els, background: "ink" };
  }

  if (isAuthorityDivider(c)) {
    els.push(canvas(HER.forest));
    els.push(makeElement("rule", { x: HM, y: CANVAS_H / 2 - 64, w: 56, h: 3, z: 10 }, { background: HER.lime }));
    els.push(makeElement("heading", { x: HM, y: CANVAS_H / 2 - 44, w: CANVAS_W - HM * 2, h: 120, z: 10 },
      { color: HER.cream, fontFamily: "display", fontSize: 56, fontWeight: 600, lineHeight: 1.05 }, { text: c.title }));
    heraldFooter(els, c, HER.cream);
    return { elements: els, background: "ink" };
  }

  // Content slides live on cream.
  els.push(canvas(HER.cream));
  const header = () => {
    els.push(makeElement("caption", { x: HM, y: 58, w: 400, h: 16, z: 10 },
      { color: HER.forest, fontFamily: "label", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", opacity: 0.5 },
      { text: kindLabel(c) }));
    els.push(makeElement("heading", { x: HM, y: 90, w: CANVAS_W - HM * 2, h: 70, z: 10 },
      { color: HER.forest, fontFamily: "display", fontSize: 48, fontWeight: 600, lineHeight: 1.05 }, { text: c.title }));
    els.push(makeElement("rule", { x: HM, y: 170, w: CANVAS_W - HM * 2, h: 1, z: 10 }, { background: HER.forest, opacity: 0.08 }));
  };

  if (c.kind === "contents") {
    header();
    (c.contents ?? []).slice(0, 10).forEach((e, i) => {
      const y = 196 + i * 44;
      els.push(makeElement("caption", { x: HM, y: y + 4, w: 44, h: 20, z: 10 },
        { color: HER.forest, fontFamily: "label", fontSize: 13, fontWeight: 600 }, { text: String(i + 3).padStart(2, "0") }));
      els.push(makeElement("text", { x: HM + 64, y, w: CANVAS_W - HM * 2 - 64, h: 28, z: 10 },
        { color: HER.forest, fontFamily: "body", fontSize: 18 }, { text: e.title }));
    });
    heraldFooter(els, c, HER.forest);
    return { elements: els, background: "paper" };
  }

  if (c.kind === "team" && (c.team?.length ?? 0) > 0) {
    header();
    const team = c.team!.slice(0, 4);
    const gap = 28;
    const w = (CANVAS_W - HM * 2 - gap * (team.length - 1)) / team.length;
    const photoH = w * (team.length >= 4 ? 0.92 : 1.1);
    const top = 210;
    team.forEach((p, i) => {
      const x = HM + i * (w + gap);
      const name = p.name || "";
      const nameSize = name.length > 20 ? 16 : 20;
      const nameH = nameSize * 1.25 * 2;
      const nameY = top + photoH + 12;
      const roleY = nameY + nameH + 8;
      els.push(makeElement("portrait", { x, y: top, w, h: photoH, z: 10 }, { objectFit: "cover" }, { src: p.photo_data_url || null, text: name }));
      els.push(makeElement("text", { x, y: nameY, w, h: nameH, z: 10 },
        { color: HER.forest, fontFamily: "display", fontSize: nameSize, fontWeight: 600, lineHeight: 1.25 }, { text: name }));
      els.push(makeElement("caption", { x, y: roleY, w, h: 18, z: 10 },
        { color: HER.forest, fontFamily: "label", fontSize: 12, opacity: 0.6 }, { text: p.role }));
    });
    heraldFooter(els, c, HER.forest);
    return { elements: els, background: "paper" };
  }

  if (c.chart) {
    header();
    els.push(makeElement("chart", { x: HM, y: 200, w: CANVAS_W - HM * 2, h: 360, z: 10 }, {}, { chart: c.chart }));
    heraldFooter(els, c, HER.forest);
    return { elements: els, background: "paper" };
  }

  // Generic body.
  header();
  if (lead) {
    els.push(makeElement("text", { x: HM, y: 200, w: 780, h: 120, z: 10 },
      { color: HER.forest, fontFamily: "body", fontSize: 17, lineHeight: 1.65 }, { text: lead.text, source: lead.source }));
  }
  (c.paragraphs ?? []).slice(1, 4).forEach((p, i) => {
    els.push(makeElement("text", { x: HM, y: 340 + i * 60, w: 780, h: 54, z: 10 },
      { color: HER.forest, fontFamily: "body", fontSize: 16, lineHeight: 1.6, opacity: 0.75 }, { text: p.text, source: p.source }));
  });
  heraldFooter(els, c, HER.forest);
  return { elements: els, background: "paper" };
};
