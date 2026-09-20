/**
 * Layout primitives built on real text measurement.
 *
 * Composers previously placed text by guessing its height from character
 * count, so frames reserved the wrong amount of space and everything below
 * sat in the wrong place. These helpers measure first and position second,
 * which is the only way alignment actually holds.
 *
 * They also handle the things a typesetter does without thinking: fitting a
 * headline to its column, pulling widows down, and stacking blocks with
 * consistent spacing rather than fixed offsets that only work for one length
 * of text.
 */
import { makeElement, type SlideElement, type ElementStyle } from "./elements";
import { fitHeadline, wrapText, fitText, hasWidow, fixWidow, type FontSpec } from "./measure";

export interface TypeRole {
  family: "display" | "body" | "label";
  size: number;
  weight?: number;
  lineHeight?: number;
  letterSpacing?: string;
}

/** Maps a theme font role onto a measurable font, for layout maths. */
function specFor(role: TypeRole, families: { display: string; body: string; label: string }): FontSpec {
  return {
    family: families[role.family],
    size: role.size,
    weight: role.weight ?? 400,
  };
}

export interface LayoutContext {
  families: { display: string; body: string; label: string };
}

/** A sensible default for measuring before a theme is known. */
export const DEFAULT_FAMILIES = {
  display: '"Fraunces", Georgia, serif',
  body: '"Inter", -apple-system, sans-serif',
  label: '"Inter", -apple-system, sans-serif',
};

/**
 * Places a headline, scaling it so it lands on the intended number of lines.
 *
 * Fixed display sizes are why generated decks look uneven: a two-word title
 * and a nine-word one set at the same size have completely different visual
 * weight, and the long one wraps badly. Scaling to a line target keeps them
 * feeling like the same element.
 */
export function headlineElement(
  text: string,
  frame: { x: number; y: number; w: number },
  role: TypeRole,
  ctx: LayoutContext,
  opts: { maxLines?: number; color?: string; minSize?: number } = {},
): { element: SlideElement; height: number } {
  const spec = specFor(role, ctx.families);
  const lineHeight = role.lineHeight ?? 1.05;
  const fit = fitHeadline(text, frame.w, spec, {
    maxLines: opts.maxLines ?? 3,
    min: opts.minSize ?? role.size * 0.45,
    max: role.size,
    lineHeight,
  });

  const style: ElementStyle = {
    color: opts.color ?? "ink",
    fontFamily: role.family,
    fontSize: fit.fontSize,
    fontWeight: role.weight ?? 600,
    lineHeight,
    letterSpacing: role.letterSpacing,
  };

  return {
    element: makeElement(
      "heading",
      { x: frame.x, y: frame.y, w: frame.w, h: Math.ceil(fit.height), z: 10 },
      style,
      { text: fit.lines.length > 1 ? fixWidow(text) : text },
    ),
    height: Math.ceil(fit.height),
  };
}

/**
 * Places a text block at its measured height, fixing a widow if one occurs.
 */
export function textElement(
  text: string,
  frame: { x: number; y: number; w: number },
  role: TypeRole,
  ctx: LayoutContext,
  opts: { color?: string; source?: string; type?: "text" | "caption" | "list" } = {},
): { element: SlideElement; height: number } {
  const spec = specFor(role, ctx.families);
  const lineHeight = role.lineHeight ?? 1.55;
  const wrapped = wrapText(text, frame.w, spec, lineHeight);
  const content = hasWidow(wrapped.lines) ? fixWidow(text) : text;
  const height = Math.ceil(wrapped.height);

  return {
    element: makeElement(
      opts.type ?? "text",
      { x: frame.x, y: frame.y, w: frame.w, h: height, z: 10 },
      {
        color: opts.color ?? "ink",
        fontFamily: role.family,
        fontSize: role.size,
        fontWeight: role.weight ?? 400,
        lineHeight,
        letterSpacing: role.letterSpacing,
      },
      { text: content, source: opts.source },
    ),
    height,
  };
}

/**
 * Places text inside a fixed box, shrinking it to fit.
 *
 * Used where the frame is structural (a column beside an image, a card in a
 * grid) and cannot grow. Without this, a founder who writes more than
 * expected gets text overlapping the element below.
 */
export function fittedTextElement(
  text: string,
  frame: { x: number; y: number; w: number; h: number },
  role: TypeRole,
  ctx: LayoutContext,
  opts: { color?: string; source?: string; minSize?: number } = {},
): SlideElement {
  const spec = specFor(role, ctx.families);
  const lineHeight = role.lineHeight ?? 1.5;
  const fit = fitText(text, { width: frame.w, height: frame.h }, spec, {
    lineHeight,
    min: opts.minSize ?? Math.max(11, role.size * 0.6),
  });

  return makeElement(
    "text",
    { x: frame.x, y: frame.y, w: frame.w, h: frame.h, z: 10 },
    {
      color: opts.color ?? "ink",
      fontFamily: role.family,
      fontSize: fit.fontSize,
      fontWeight: role.weight ?? 400,
      lineHeight,
    },
    { text, source: opts.source },
  );
}

/**
 * Stacks blocks vertically with consistent gaps, measuring each.
 *
 * Returns the elements and the total height used, so the caller can centre
 * the whole group or position what follows it. Fixed y-offsets per block,
 * which is what the composers did before, only produce even spacing when
 * every block happens to be the same length.
 */
export function stack(
  items: { text: string; role: TypeRole; color?: string; source?: string }[],
  start: { x: number; y: number; w: number },
  gap: number,
  ctx: LayoutContext,
): { elements: SlideElement[]; height: number } {
  const elements: SlideElement[] = [];
  let y = start.y;

  for (const item of items) {
    if (!item.text?.trim()) continue;
    const { element, height } = textElement(
      item.text,
      { x: start.x, y, w: start.w },
      item.role,
      ctx,
      { color: item.color, source: item.source },
    );
    elements.push(element);
    y += height + gap;
  }

  return { elements, height: Math.max(0, y - start.y - gap) };
}

/**
 * Vertically centres a group of already-positioned elements inside a band.
 *
 * Optical centring, not mathematical: text sits slightly high of true centre
 * because its visual mass is above the baseline, and a mathematically
 * centred block reads as low.
 */
export function centreVertically(
  elements: SlideElement[],
  band: { top: number; bottom: number },
  opticalLift = 0.04,
): SlideElement[] {
  if (elements.length === 0) return elements;
  const top = Math.min(...elements.map((e) => e.frame.y));
  const bottom = Math.max(...elements.map((e) => e.frame.y + e.frame.h));
  const height = bottom - top;
  const available = band.bottom - band.top;
  const offset = band.top + (available - height) / 2 - available * opticalLift - top;

  return elements.map((e) => ({ ...e, frame: { ...e.frame, y: Math.round(e.frame.y + offset) } }));
}

/**
 * Splits items into columns balanced by measured height rather than count.
 *
 * Splitting six items three and three looks wrong when the first three are
 * twice as long. Balancing by height is what makes two columns end near the
 * same baseline.
 */
export function balanceColumns(
  items: { text: string; role: TypeRole }[],
  columnWidth: number,
  ctx: LayoutContext,
  columns = 2,
): { text: string; role: TypeRole }[][] {
  const heights = items.map((i) => {
    const spec = specFor(i.role, ctx.families);
    return wrapText(i.text, columnWidth, spec, i.role.lineHeight ?? 1.55).height;
  });
  const total = heights.reduce((a, b) => a + b, 0);
  const target = total / columns;

  const out: { text: string; role: TypeRole }[][] = Array.from({ length: columns }, () => []);
  let col = 0;
  let acc = 0;

  items.forEach((item, i) => {
    // Move to the next column once this one has passed its share, unless
    // we're on the last column, which takes whatever remains.
    if (acc > target && col < columns - 1) {
      col += 1;
      acc = 0;
    }
    out[col].push(item);
    acc += heights[i];
  });

  return out;
}
