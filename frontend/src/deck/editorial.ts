/**
 * The Editorial template, rebuilt on measured layout.
 *
 * This is the reference implementation for the others. Three things changed
 * from the guessed-height version:
 *
 *   - Every frame is sized to text that was actually measured, so spacing is
 *     even and nothing overlaps or leaves an arbitrary gap.
 *   - Body slides pick a composition from the content's shape, so a deck has
 *     rhythm instead of eight identical pages.
 *   - Headlines scale to their column, so a two-word title and a nine-word
 *     one carry the same visual weight.
 */
import {
  CANVAS_W, CANVAS_H, makeElement,
  type SlideElement,
} from "./elements";
import {
  headlineElement, textElement, stack, centreVertically, balanceColumns,
  DEFAULT_FAMILIES, type LayoutContext, type TypeRole,
} from "./layout";
import { analyseContent, type LayoutVariant } from "./variants";
import type { SlideContentInput } from "./composers";

const M = 88;                       // page margin
const COL = 12;
const GUTTER = 24;
const UNIT = (CANVAS_W - M * 2 - GUTTER * (COL - 1)) / COL;
const gx = (c: number) => Math.round(M + (UNIT + GUTTER) * c);
const gw = (span: number) => Math.round(UNIT * span + GUTTER * (span - 1));

const TYPE: Record<string, TypeRole> = {
  display:  { family: "display", size: 66, weight: 600, lineHeight: 1.02, letterSpacing: "-0.025em" },
  headline: { family: "display", size: 42, weight: 600, lineHeight: 1.1,  letterSpacing: "-0.015em" },
  statement:{ family: "display", size: 58, weight: 600, lineHeight: 1.12, letterSpacing: "-0.02em" },
  metric:   { family: "display", size: 128, weight: 700, lineHeight: 0.92, letterSpacing: "-0.04em" },
  lead:     { family: "body",    size: 24, weight: 400, lineHeight: 1.45 },
  body:     { family: "body",    size: 19, weight: 400, lineHeight: 1.6 },
  caption:  { family: "label",   size: 14, weight: 400, lineHeight: 1.45 },
  micro:    { family: "label",   size: 11, weight: 400, lineHeight: 1.4 },
};

/** Chrome every slide carries, defined once so no layout can omit it. */
function chrome(c: SlideContentInput, inverse = false): SlideElement[] {
  const out: SlideElement[] = [];
  const dim = inverse ? "inverse" : "muted";

  if (c.logo) {
    out.push(makeElement("logo",
      { x: CANVAS_W - M - 66, y: M - 6, w: 66, h: 22, z: 40 },
      { objectFit: "contain", opacity: inverse ? 0.85 : 0.7 },
      { src: c.logo, locked: true }));
  }
  if (c.companyName) {
    out.push(makeElement("caption",
      { x: M, y: CANVAS_H - 56, w: 300, h: 16, z: 40 },
      { color: dim, fontFamily: "label", fontSize: 11, opacity: 0.8 },
      { text: c.companyName, locked: true }));
  }
  if (c.pageNumber) {
    out.push(makeElement("pageNumber",
      { x: CANVAS_W - M - 80, y: CANVAS_H - 56, w: 80, h: 16, z: 40 },
      { color: dim, fontFamily: "label", fontSize: 11, align: "right", opacity: 0.8 },
      { text: `${c.pageNumber}${c.totalPages ? ` / ${c.totalPages}` : ""}`, locked: true }));
  }
  return out;
}

function sources(c: SlideContentInput, y: number): SlideElement[] {
  const unique = [...new Set(c.paragraphs.map((p) => p.source).filter(Boolean))];
  if (!unique.length) return [];
  return [makeElement("caption",
    { x: M, y, w: gw(9), h: 15, z: 30 },
    { color: "muted", fontFamily: "label", fontSize: 10.5, opacity: 0.7 },
    { text: unique.join("  ·  ") })];
}

const CTX: LayoutContext = { families: DEFAULT_FAMILIES };

/* ------------------------------------------------------------------ */

export function composeEditorialMeasured(
  c: SlideContentInput,
  variant: LayoutVariant,
): { elements: SlideElement[]; background?: "paper" | "ink" | "accent" } {

  if (c.kind === "cover") return cover(c);
  if (c.kind === "contents") return contents(c);
  if (c.kind === "team" && c.team?.length) return team(c);

  switch (variant) {
    case "statement":    return statement(c);
    case "metric-hero":  return metricHero(c);
    case "numbered-rows":return numberedRows(c);
    case "grid":         return grid(c);
    case "split-image":  return splitImage(c);
    case "image-led":    return imageLed(c);
    case "two-column":   return twoColumn(c);
    case "data":         return data(c);
    default:             return leadAndPoints(c);
  }
}

/* --- cover --------------------------------------------------------- */

function cover(c: SlideContentInput) {
  const els: SlideElement[] = [
    makeElement("shape", { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, z: 0 },
      { background: "ink", shape: "rect" }),
  ];
  if (c.logo) {
    els.push(makeElement("logo", { x: M, y: M, w: 92, h: 30, z: 40 },
      { objectFit: "contain" }, { src: c.logo, locked: true }));
  }

  const title = headlineElement(c.title, { x: M, y: 0, w: gw(9) },
    TYPE.display, CTX, { maxLines: 2, color: "inverse" });

  const group: SlideElement[] = [
    makeElement("rule", { x: M, y: -26, w: 56, h: 3, z: 10 }, { background: "accent" }),
    title.element,
  ];
  if (c.paragraphs[0]) {
    const lede = textElement(c.paragraphs[0].text,
      { x: M, y: title.height + 24, w: gw(6) }, TYPE.lead, CTX, { color: "inverse" });
    lede.element.style.opacity = 0.72;
    group.push(lede.element);
  }

  // Sits low on the page, the way a title page reads best.
  els.push(...centreVertically(group, { top: 300, bottom: CANVAS_H - 110 }));
  els.push(makeElement("caption", { x: M, y: CANVAS_H - 70, w: 320, h: 16, z: 40 },
    { color: "inverse", fontFamily: "label", fontSize: 11, opacity: 0.45 },
    { text: new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" }), locked: true }));

  return { elements: els, background: "ink" as const };
}

/* --- body variants -------------------------------------------------- */

/** One idea, set large, with most of the page left empty. */
function statement(c: SlideContentInput) {
  const els = chrome(c);
  const text = c.paragraphs[0]?.text ?? c.title;

  els.push(makeElement("eyebrow", { x: M, y: 140, w: gw(6), h: 20, z: 10 },
    { color: "accent", fontFamily: "label", fontSize: 13, letterSpacing: "0.06em" },
    { text: c.title.toUpperCase() }));

  const body = headlineElement(text, { x: M, y: 0, w: gw(9) },
    TYPE.statement, CTX, { maxLines: 4 });

  const rest = c.paragraphs.slice(1, 2).map((p) => ({
    text: p.text, role: TYPE.body, color: "muted", source: p.source,
  }));
  const tail = stack(rest, { x: M, y: body.height + 34, w: gw(7) }, 16, CTX);

  els.push(...centreVertically([body.element, ...tail.elements], { top: 190, bottom: CANVAS_H - 120 }));
  els.push(...sources(c, CANVAS_H - 84));
  return { elements: els };
}

/** A single figure carrying the page. */
function metricHero(c: SlideContentInput) {
  const els = chrome(c);
  const shape = analyseContent(c);
  const metric = shape.heroMetric ?? "";
  const lead = c.paragraphs[0]?.text ?? "";
  // The sentence reads better without the figure repeated inside it.
  const supporting = metric ? lead.replace(metric, "").replace(/^\s*[,.]?\s*/, "") : lead;

  els.push(makeElement("eyebrow", { x: M, y: 150, w: gw(6), h: 20, z: 10 },
    { color: "accent", fontFamily: "label", fontSize: 13, letterSpacing: "0.06em" },
    { text: c.title.toUpperCase() }));

  const big = headlineElement(metric, { x: M, y: 192, w: gw(8) },
    TYPE.metric, CTX, { maxLines: 1 });
  els.push(big.element);

  let y = 192 + big.height + 26;
  if (supporting.trim()) {
    const s = textElement(supporting.charAt(0).toUpperCase() + supporting.slice(1),
      { x: M, y, w: gw(7) }, TYPE.lead, CTX);
    els.push(s.element);
    y += s.height + 18;
  }
  const more = stack(
    c.paragraphs.slice(1, 3).map((p) => ({ text: p.text, role: TYPE.body, color: "muted", source: p.source })),
    { x: M, y, w: gw(7) }, 14, CTX,
  );
  els.push(...more.elements);
  els.push(...sources(c, CANVAS_H - 84));
  return { elements: els };
}

/** The signature Editorial page: narrow title column, wide body column. */
function leadAndPoints(c: SlideContentInput) {
  const els = chrome(c);
  const titleW = gw(3);
  const bodyX = gx(5);
  const bodyW = CANVAS_W - M - bodyX;

  els.push(makeElement("rule", { x: M, y: 112, w: 44, h: 3, z: 10 }, { background: "accent" }));
  const title = headlineElement(c.title, { x: M, y: 134, w: titleW },
    TYPE.headline, CTX, { maxLines: 4 });
  els.push(title.element);

  const blocks = c.paragraphs.slice(0, 4).map((p, i) => ({
    text: p.text,
    role: i === 0 ? TYPE.lead : TYPE.body,
    color: i === 0 ? "ink" : "muted",
    source: p.source,
  }));
  const body = stack(blocks, { x: bodyX, y: 112, w: bodyW }, 20, CTX);
  els.push(...body.elements);
  els.push(...sources(c, CANVAS_H - 84));
  return { elements: els };
}

/** Points as numbered rows separated by hairlines. */
function numberedRows(c: SlideContentInput) {
  const els = chrome(c);
  const title = headlineElement(c.title, { x: M, y: 96, w: gw(7) },
    TYPE.headline, CTX, { maxLines: 2 });
  els.push(title.element);

  let y = 96 + title.height + 44;
  const rowW = gw(10) - 60;

  c.paragraphs.slice(0, 5).forEach((p, i) => {
    els.push(makeElement("rule", { x: M, y, w: gw(11), h: 1, z: 10 }, { background: "rule" }));
    els.push(makeElement("caption", { x: M, y: y + 18, w: 44, h: 18, z: 10 },
      { color: "accent", fontFamily: "label", fontSize: 13, fontWeight: 500 },
      { text: String(i + 1).padStart(2, "0") }));
    const row = textElement(p.text, { x: M + 60, y: y + 16, w: rowW }, TYPE.body, CTX, { source: p.source });
    els.push(row.element);
    y += Math.max(row.height + 34, 62);
  });

  els.push(...sources(c, CANVAS_H - 84));
  return { elements: els };
}

/** Points as modular blocks in a balanced grid. */
function grid(c: SlideContentInput) {
  const els = chrome(c);
  const title = headlineElement(c.title, { x: M, y: 96, w: gw(7) },
    TYPE.headline, CTX, { maxLines: 2 });
  els.push(title.element);

  const items = c.paragraphs.slice(0, 4);
  const cols = items.length <= 2 ? items.length : 2;
  const cellW = (gw(11) - GUTTER * 2 * (cols - 1)) / cols;
  const top = 96 + title.height + 46;

  // Row heights come from the tallest cell in each row, so blocks in a row
  // share a baseline instead of each sitting at its own height.
  const measured = items.map((p) =>
    textElement(p.text, { x: 0, y: 0, w: cellW - 48 }, TYPE.body, CTX, { source: p.source }));

  let y = top;
  for (let r = 0; r * cols < items.length; r++) {
    const row = measured.slice(r * cols, r * cols + cols);
    const rowH = Math.max(...row.map((m) => m.height)) + 56;
    row.forEach((m, i) => {
      const x = M + i * (cellW + GUTTER * 2);
      els.push(makeElement("shape", { x, y, w: cellW, h: rowH - 18, z: 5 },
        { background: "accentSoft", shape: "rect" }));
      els.push(makeElement("shape", { x, y, w: 3, h: rowH - 18, z: 6 },
        { background: "accent", shape: "rect" }));
      els.push({ ...m.element, frame: { ...m.element.frame, x: x + 26, y: y + 26, w: cellW - 48 } });
    });
    y += rowH;
  }

  els.push(...sources(c, CANVAS_H - 84));
  return { elements: els };
}

/** Text one side, image the other, both full-height. */
function splitImage(c: SlideContentInput) {
  const els = chrome(c);
  const imgW = Math.round(CANVAS_W * 0.44);

  els.push(makeElement("image", { x: CANVAS_W - imgW, y: 0, w: imgW, h: CANVAS_H, z: 5 },
    { objectFit: "cover", focusX: 0.5, focusY: 0.45 }, { src: c.image ?? null }));

  const textW = CANVAS_W - imgW - M - 56;
  const title = headlineElement(c.title, { x: M, y: 0, w: textW },
    TYPE.headline, CTX, { maxLines: 3 });

  const group: SlideElement[] = [
    makeElement("rule", { x: M, y: -22, w: 44, h: 3, z: 10 }, { background: "accent" }),
    title.element,
  ];
  const body = stack(
    c.paragraphs.slice(0, 3).map((p, i) => ({
      text: p.text, role: i === 0 ? TYPE.lead : TYPE.body,
      color: i === 0 ? "ink" : "muted", source: p.source,
    })),
    { x: M, y: title.height + 24, w: textW }, 16, CTX,
  );
  group.push(...body.elements);

  els.push(...centreVertically(group, { top: 90, bottom: CANVAS_H - 90 }));
  return { elements: els };
}

/** Image dominant, text as a caption over a scrim. */
function imageLed(c: SlideContentInput) {
  const els: SlideElement[] = [
    makeElement("image", { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, z: 0 },
      { objectFit: "cover", focusX: 0.5, focusY: 0.4 }, { src: c.image ?? null }),
    makeElement("shape", { x: 0, y: CANVAS_H - 300, w: CANVAS_W, h: 300, z: 1 },
      { background: "ink", opacity: 0.72, shape: "rect" }),
  ];

  const title = headlineElement(c.title, { x: M, y: 0, w: gw(7) },
    TYPE.headline, CTX, { maxLines: 2, color: "inverse" });
  const lead = c.paragraphs[0]
    ? textElement(c.paragraphs[0].text, { x: M, y: title.height + 18, w: gw(6) },
        TYPE.lead, CTX, { color: "inverse" })
    : null;
  if (lead) lead.element.style.opacity = 0.85;

  const group = [title.element, ...(lead ? [lead.element] : [])];
  els.push(...centreVertically(group, { top: CANVAS_H - 270, bottom: CANVAS_H - 70 }));
  els.push(...chrome(c, true));
  return { elements: els };
}

/** Continuous prose in two balanced columns. */
function twoColumn(c: SlideContentInput) {
  const els = chrome(c);
  const title = headlineElement(c.title, { x: M, y: 96, w: gw(8) },
    TYPE.headline, CTX, { maxLines: 2 });
  els.push(title.element);
  els.push(makeElement("rule", { x: M, y: 96 + title.height + 26, w: gw(11), h: 1, z: 10 },
    { background: "rule" }));

  const colW = (gw(11) - GUTTER * 3) / 2;
  const columns = balanceColumns(
    c.paragraphs.slice(0, 6).map((p) => ({ text: p.text, role: TYPE.body })),
    colW, CTX, 2,
  );

  const top = 96 + title.height + 52;
  columns.forEach((col, ci) => {
    const s = stack(
      col.map((item, i) => ({
        text: item.text,
        role: ci === 0 && i === 0 ? TYPE.lead : TYPE.body,
        color: ci === 0 && i === 0 ? "ink" : "muted",
      })),
      { x: M + ci * (colW + GUTTER * 3), y: top, w: colW }, 16, CTX,
    );
    els.push(...s.elements);
  });

  els.push(...sources(c, CANVAS_H - 84));
  return { elements: els };
}

/** A chart with the note that explains it. */
function data(c: SlideContentInput) {
  const els = chrome(c);
  const title = headlineElement(c.title, { x: M, y: 70, w: gw(9) },
    { ...TYPE.headline, size: 34 }, CTX, { maxLines: 2 });
  els.push(title.element);

  const note = c.paragraphs[0];
  const chartTop = 70 + title.height + 34;
  const noteH = note ? 78 : 0;

  els.push(makeElement("chart",
    { x: M, y: chartTop, w: gw(11), h: CANVAS_H - chartTop - noteH - 96, z: 10 },
    {}, { chart: c.chart ?? undefined }));

  if (note) {
    const n = textElement(note.text, { x: M + 16, y: CANVAS_H - noteH - 66, w: gw(8) },
      TYPE.caption, CTX, { color: "muted", source: note.source });
    n.element.style.borderLeft = 2;
    n.element.style.borderColor = "accent";
    els.push(n.element);
  }
  return { elements: els };
}

/* --- contents and team ---------------------------------------------- */

function contents(c: SlideContentInput) {
  const els = chrome(c);
  const title = headlineElement(c.title, { x: M, y: 100, w: gw(5) },
    TYPE.headline, CTX, { maxLines: 2 });
  els.push(title.element);

  const entries = c.contents ?? [];
  const cols = entries.length > 7 ? 2 : 1;
  const colW = cols === 2 ? (gw(11) - GUTTER * 3) / 2 : gw(8);
  const per = Math.ceil(entries.length / cols);
  const top = 100 + title.height + 46;

  entries.forEach((e, i) => {
    const col = Math.floor(i / per);
    const row = i % per;
    const x = M + col * (colW + GUTTER * 3);
    const y = top + row * 44;
    els.push(makeElement("rule", { x, y, w: colW, h: 1, z: 10 }, { background: "rule" }));
    els.push(makeElement("caption", { x, y: y + 14, w: 30, h: 18, z: 10 },
      { color: "accent", fontFamily: "label", fontSize: 11 },
      { text: String(i + 3).padStart(2, "0") }));
    els.push(makeElement("list", { x: x + 40, y: y + 12, w: colW - 40, h: 24, z: 10 },
      { color: "ink", fontFamily: "body", fontSize: 18 }, { text: e.title }));
  });
  return { elements: els };
}

function team(c: SlideContentInput) {
  const els = chrome(c);
  const members = c.team ?? [];
  const title = headlineElement(c.title, { x: M, y: 92, w: gw(6) },
    TYPE.headline, CTX, { maxLines: 1 });
  els.push(title.element);

  const perRow = members.length <= 4 ? Math.max(members.length, 1) : members.length <= 6 ? 3 : 4;
  const cellW = (gw(11) - GUTTER * (perRow - 1)) / perRow;
  const portrait = Math.min(cellW, members.length > 4 ? 150 : 200);
  const top = 92 + title.height + 40;

  members.forEach((p, i) => {
    const col = i % perRow, row = Math.floor(i / perRow);
    const x = M + col * (cellW + GUTTER);
    const y = top + row * (portrait + 168);

    els.push(makeElement("portrait", { x, y, w: portrait, h: portrait, z: 10 },
      { objectFit: "cover", filter: "grayscale(0.25)", focusY: 0.35 },
      { src: p.photo_data_url || null, text: p.name }));
    els.push(makeElement("rule", { x, y: y + portrait + 14, w: 24, h: 2, z: 10 },
      { background: "accent" }));
    els.push(makeElement("text", { x, y: y + portrait + 26, w: cellW, h: 24, z: 10 },
      { color: "ink", fontFamily: "display", fontSize: 19, fontWeight: 600 }, { text: p.name }));
    els.push(makeElement("caption", { x, y: y + portrait + 50, w: cellW, h: 18, z: 10 },
      { color: "accent", fontFamily: "label", fontSize: 13 }, { text: p.role }));
    // The bio is fitted rather than measured, so an unusually long one
    // shrinks instead of colliding with the row beneath.
    els.push(makeElement("text", { x, y: y + portrait + 72, w: cellW, h: 76, z: 10 },
      { color: "muted", fontFamily: "body", fontSize: 13.5, lineHeight: 1.45 }, { text: p.bio }));
  });
  return { elements: els };
}
