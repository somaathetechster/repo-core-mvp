/**
 * Deck design system.
 *
 * A deck is not a document with page breaks. Each slide type does a
 * different job and should be composed differently: a Problem slide is a
 * held argument, a Traction slide is a number that should land, a Team
 * slide is faces and credibility. The previous implementation rendered all
 * of them as a title plus a stack of paragraphs, which is why it read as
 * generic no matter what content went in.
 *
 * Everything below is built on a 16:9 canvas at a fixed internal size, then
 * scaled to fit its container. Designing at a fixed size means the
 * proportions hold exactly whether the slide is shown in a small preview,
 * full screen, or exported.
 */

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

/** A 12-column grid with generous margins. Investor decks are read at a
 *  distance; cramped margins are the fastest way to look amateur. */
export const GRID = {
  columns: 12,
  margin: 88,
  gutter: 24,
  get contentWidth() {
    return SLIDE_W - this.margin * 2;
  },
  column(span: number): number {
    const unit = (this.contentWidth - this.gutter * (this.columns - 1)) / this.columns;
    return unit * span + this.gutter * (span - 1);
  },
  x(col: number): number {
    const unit = (this.contentWidth - this.gutter * (this.columns - 1)) / this.columns;
    return this.margin + (unit + this.gutter) * col;
  },
};

/**
 * Type scale on a major-third progression. The jumps are deliberately
 * large: a deck needs a display size that dominates and a body size that
 * recedes, with little in between. Timid type scales read as corporate.
 */
export const DECK_TYPE = {
  statement: 104,   // the one number or phrase a slide is built around
  display: 64,      // cover title
  headline: 40,     // slide titles
  subhead: 26,      // lead paragraph
  body: 20,         // supporting text
  caption: 15,      // labels, names
  micro: 12,        // citations, page numbers
};

export const DECK_LEADING = {
  statement: 0.92,
  display: 1.02,
  headline: 1.12,
  subhead: 1.35,
  body: 1.55,
  caption: 1.4,
};

/**
 * Slide layout variants. The renderer picks one based on slide type and
 * content shape, so a slide with a single powerful sentence is composed
 * differently from one carrying three supporting points.
 */
export type SlideLayout =
  | "cover"
  | "statement"      // one dominant line, everything else quiet
  | "argument"       // headline plus flowing body, editorial column
  | "split"          // headline left, content right
  | "points"         // headline plus enumerated supporting points
  | "metrics"        // big figures in a row
  | "team"           // portrait grid
  | "chart"          // full-bleed visual with a tight caption
  | "image"          // full-bleed image
  | "contents";      // table of contents

export interface DeckPalette {
  ink: string;
  paper: string;
  accent: string;
  muted: string;
  rule: string;
  inverse: string;      // text on an ink background
  accentSoft: string;
}

/** Derives a full working palette from the founder's two brand colours,
 *  so their brand drives the deck rather than sitting beside it. */
export function buildPalette(primary?: string | null, secondary?: string | null): DeckPalette {
  const accent = normaliseHex(primary) ?? "#b8860b";
  const ink = normaliseHex(secondary) ?? "#161412";
  return {
    ink,
    paper: "#faf8f3",
    accent,
    muted: mix(ink, "#faf8f3", 0.45),
    rule: mix(ink, "#faf8f3", 0.86),
    inverse: "#faf8f3",
    accentSoft: mix(accent, "#faf8f3", 0.85),
  };
}

function normaliseHex(value?: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return "#" + v.slice(1).split("").map((c) => c + c).join("");
  }
  return null;
}

/** Blends two hex colours. amount=0 returns a, amount=1 returns b. */
export function mix(a: string, b: string, amount: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  if (!pa || !pb) return a;
  const out = pa.map((c, i) => Math.round(c + (pb[i] - c) * amount));
  return `#${out.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance, used to pick legible text over an arbitrary brand colour. */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function readableOn(background: string, palette: DeckPalette): string {
  return luminance(background) > 0.5 ? palette.ink : palette.inverse;
}

/** Font pairings the founder can choose between. Each is a real pairing
 *  with a distinct voice, not a list of fonts. */
export const FONT_SETS: Record<string, { display: string; body: string; label: string; note: string }> = {
  serif: {
    display: '"Fraunces", Georgia, serif',
    body: '"Inter", -apple-system, sans-serif',
    label: '"Inter", -apple-system, sans-serif',
    note: "Editorial and warm. Reads as considered rather than corporate.",
  },
  sans: {
    display: '"Inter", -apple-system, sans-serif',
    body: '"Inter", -apple-system, sans-serif',
    label: '"Inter", -apple-system, sans-serif',
    note: "Modern and neutral. Gets out of the way of the content.",
  },
  classic: {
    display: 'Georgia, "Times New Roman", serif',
    body: 'Georgia, "Times New Roman", serif',
    label: '"Inter", -apple-system, sans-serif',
    note: "Formal and institutional. Suits funds and grant committees.",
  },
};

/**
 * Chooses a layout for a slide based on what it actually contains, rather
 * than rendering every text slide the same way. Content shape, not slide
 * name, is what should drive composition.
 */
export function chooseLayout(slide: {
  type: string;
  blocks?: { text: string }[];
  image_data_url?: string | null;
  chart?: unknown;
  team_members?: unknown[] | null;
}): SlideLayout {
  if (slide.type === "cover") return "cover";
  if (slide.type === "toc") return "contents";
  if (slide.type === "team") return "team";
  if (slide.type === "chart") return "chart";
  if (slide.type === "image") return "image";

  const blocks = slide.blocks ?? [];
  const totalLength = blocks.reduce((n, b) => n + b.text.length, 0);

  // A single short, declarative line deserves to dominate the slide.
  if (blocks.length === 1 && totalLength < 130) return "statement";
  // Several short blocks are points to be enumerated.
  if (blocks.length >= 3 && totalLength / blocks.length < 200) return "points";
  // An image alongside text wants a split composition.
  if (slide.image_data_url) return "split";
  // Otherwise it's an argument: one continuous editorial column.
  return "argument";
}

/** Pulls a leading statistic out of a text block, so a Traction slide can
 *  lead with the number rather than burying it mid-sentence. */
export function extractLeadStat(text: string): { value: string; rest: string } | null {
  const match = text.match(
    /^([^.!?]*?)(\b[$€£₦¥]?\s?\d[\d,.]*\s?(?:%|x|k|m|bn?|million|billion|users|customers|countries|markets)?\b)([^.!?]*[.!?])?/i
  );
  if (!match) return null;
  const value = match[2]?.trim();
  if (!value || value.length > 18) return null;
  // Only treat it as a lead stat if it appears early in the sentence.
  if ((match[1]?.length ?? 0) > 42) return null;
  return { value, rest: text };
}
