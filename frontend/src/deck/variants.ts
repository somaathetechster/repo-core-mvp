/**
 * Layout variant selection.
 *
 * The previous composers mapped one slide kind to one composition, so every
 * argument slide in a deck looked identical. A ten-slide deck had about four
 * distinct page structures, which reads as monotonous no matter how good any
 * individual page is. Decks that feel designed have rhythm: a spare
 * statement page, then a dense one, then something image-led.
 *
 * Rhythm can't come from randomness, because a layout picked at random will
 * regularly be wrong for its content. It comes from reading the shape of
 * what's on the slide — how much text, whether there's a number worth
 * enlarging, whether there's an image — and choosing the composition that
 * suits it. Slides then differ because their content differs, which is what
 * a designer would do.
 */
import { textStats } from "./measure";

export type LayoutVariant =
  | "statement"       // one short, strong sentence at display size
  | "lead-and-points" // a lead paragraph with supporting points beside it
  | "numbered-rows"   // several points as a numbered list
  | "grid"            // points as equal modular blocks
  | "split-image"     // text one side, image the other
  | "image-led"       // image dominant, text as a caption
  | "metric-hero"     // one large figure carrying the page
  | "two-column"      // continuous prose in two columns
  | "quote"           // a single attributed quote
  | "data";           // a chart with its explanation

export interface ContentShape {
  /** Total words across all text on the slide. */
  words: number;
  /** How many separate paragraphs or points there are. */
  blocks: number;
  /** The longest single block, in words. */
  longestBlock: number;
  hasImage: boolean;
  hasChart: boolean;
  /** A standalone figure worth setting large, if the slide has one. */
  heroMetric: string | null;
  /** True when the lead is short enough to work at display size. */
  leadIsPunchy: boolean;
}

/**
 * Finds a figure worth enlarging.
 *
 * Only matches a number that is the subject of its sentence rather than one
 * mentioned in passing, because setting an incidental figure at 96px is
 * worse than not doing it at all.
 */
function findHeroMetric(texts: string[]): string | null {
  const pattern = /(?:^|[\s(])((?:[$₦€£]\s?)?\d[\d,]*(?:\.\d+)?\s?(?:%|k|m|bn?|million|billion|x)?)(?=[\s.,)]|$)/gi;
  let best: string | null = null;
  let bestScore = 0;

  for (const text of texts) {
    // A block that is mostly one number is the strongest candidate.
    const words = text.trim().split(/\s+/).length;
    for (const m of text.matchAll(pattern)) {
      const raw = m[1].trim();
      const digits = raw.replace(/[^\d]/g, "");
      if (digits.length < 2) continue;

      let score = digits.length;
      if (/[%$₦€£]|million|billion|k$|m$|x$/i.test(raw)) score += 3;
      // Prefer figures in short blocks: a number inside a long paragraph is
      // supporting detail, not a headline.
      if (words <= 14) score += 4;
      if (words <= 6) score += 3;
      if (score > bestScore) {
        bestScore = score;
        best = raw;
      }
    }
  }
  return bestScore >= 7 ? best : null;
}

export function analyseContent(input: {
  paragraphs: { text: string }[];
  image?: string | null;
  chart?: unknown;
}): ContentShape {
  // Defensive: a slide kind that carries no prose (team, contents) may
  // arrive without paragraphs at all, and crashing the editor over it is a
  // far worse outcome than treating it as empty.
  const texts = (input.paragraphs ?? []).map((p) => p?.text).filter(Boolean) as string[];
  const perBlock = texts.map((t) => textStats(t).words);
  const words = perBlock.reduce((a, b) => a + b, 0);
  const lead = texts[0] ?? "";
  const leadWords = perBlock[0] ?? 0;

  return {
    words,
    blocks: texts.length,
    longestBlock: perBlock.length ? Math.max(...perBlock) : 0,
    hasImage: !!input.image,
    hasChart: !!input.chart,
    heroMetric: findHeroMetric(texts),
    // Short enough to set large, and a complete thought rather than a fragment.
    leadIsPunchy: leadWords > 0 && leadWords <= 18 && /[.!?]$/.test(lead.trim()),
  };
}

/**
 * Chooses a layout for a slide, avoiding repetition of what came before.
 *
 * `recent` is the variants used on the preceding slides. Content fit decides
 * the shortlist; recency breaks ties. That ordering matters: a slide should
 * never get a layout that suits it badly just to avoid a repeat.
 */
export function chooseVariant(
  shape: ContentShape,
  recent: LayoutVariant[] = [],
): LayoutVariant {
  if (shape.hasChart) return "data";

  const candidates: { variant: LayoutVariant; fit: number }[] = [];

  // A statement page is one idea set large. The test is not just brevity
  // but singularity: a slide carrying four separate points is a list, and
  // setting it as a statement would misrepresent its structure.
  if (shape.leadIsPunchy && shape.blocks <= 2 && shape.words <= 34) {
    candidates.push({ variant: "statement", fit: 10 });
  }

  // A figure worth enlarging outranks a plain statement, because the number
  // is the more concrete version of the same claim.
  if (shape.heroMetric && shape.words <= 60) {
    candidates.push({ variant: "metric-hero", fit: 11 });
  }

  // An image on the slide is a strong signal: the founder chose to include
  // it, so a layout that ignores it is wrong regardless of word count.
  if (shape.hasImage) {
    candidates.push({ variant: "split-image", fit: shape.words <= 90 ? 12 : 9 });
    if (shape.words <= 30) candidates.push({ variant: "image-led", fit: 11 });
  }

  if (shape.blocks >= 3 && shape.longestBlock <= 40) {
    candidates.push({ variant: "numbered-rows", fit: 10 });
    candidates.push({ variant: "grid", fit: shape.blocks <= 4 ? 10 : 8 });
  }

  if (shape.blocks === 2 && shape.words > 60) {
    candidates.push({ variant: "two-column", fit: 7 });
  }

  // Always available, and the right answer for a lead plus a couple of
  // supporting points, which is the most common shape.
  candidates.push({ variant: "lead-and-points", fit: 6 });

  // Penalise anything used in the last two slides, so the deck doesn't run
  // three identical pages in a row when several slides share a shape.
  const scored = candidates.map((c) => {
    const lastUsed = recent.lastIndexOf(c.variant);
    const distance = lastUsed === -1 ? 99 : recent.length - lastUsed;
    const penalty = distance <= 1 ? 3 : distance === 2 ? 1.5 : 0;
    return { ...c, score: c.fit - penalty };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].variant;
}

/**
 * Plans the whole deck at once, so rhythm is decided across slides rather
 * than one slide at a time with no memory.
 */
export function planVariants(
  slides: { paragraphs: { text: string }[]; image?: string | null; chart?: unknown; kind: string }[],
): LayoutVariant[] {
  const out: LayoutVariant[] = [];
  for (const slide of slides) {
    // Cover, contents and team have their own dedicated compositions and
    // are not part of the variant system.
    if (["cover", "contents", "team"].includes(slide.kind)) {
      out.push("lead-and-points");
      continue;
    }
    const shape = analyseContent(slide);
    out.push(chooseVariant(shape, out.slice(-3)));
  }
  return out;
}
