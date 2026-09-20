/**
 * Text measurement.
 *
 * Every layout decision in this product depends on knowing how much space a
 * piece of text actually occupies. The composers previously guessed, by
 * dividing character count by a fixed number, which was wrong by up to 60%
 * and wrong differently at every font size. That error is why slides had
 * whitespace in arbitrary places: frames reserved space the text never used,
 * so everything below sat too low and pages looked under-filled.
 *
 * The browser can answer this exactly and for free through Canvas
 * TextMetrics, so this module does that and caches the results. A single
 * shared canvas is reused, because creating one per measurement is the
 * expensive part.
 */

let ctx: CanvasRenderingContext2D | null = null;

function context(): CanvasRenderingContext2D | null {
  if (ctx) return ctx;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  ctx = canvas.getContext("2d");
  return ctx;
}

export interface FontSpec {
  family: string;
  size: number;
  weight?: number;
  letterSpacing?: number;
}

function fontString(f: FontSpec): string {
  return `${f.weight ?? 400} ${f.size}px ${f.family}`;
}

const widthCache = new Map<string, number>();

/** Width of a single run of text, in pixels. */
export function measureWidth(text: string, font: FontSpec): number {
  const c = context();
  if (!c) {
    // Server or test environment: fall back to a per-character estimate.
    // Deliberately only used where real metrics are unavailable.
    return text.length * font.size * 0.5;
  }
  const key = `${fontString(font)}|${font.letterSpacing ?? 0}|${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;

  c.font = fontString(font);
  let w = c.measureText(text).width;
  if (font.letterSpacing) w += text.length * font.letterSpacing;

  // The cache is unbounded in principle but text repeats heavily during
  // editing, and clearing it wholesale is cheaper than tracking ages.
  if (widthCache.size > 6000) widthCache.clear();
  widthCache.set(key, w);
  return w;
}

export interface WrapResult {
  lines: string[];
  width: number;   // widest line
  height: number;  // total, including leading
}

/**
 * Wraps text to a width the way a browser would, honouring explicit
 * newlines and breaking over-long words rather than letting them overflow.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  font: FontSpec,
  lineHeight = 1.5,
): WrapResult {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    const words = paragraph.split(/\s+/);
    let line = "";

    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (measureWidth(trial, font) <= maxWidth) {
        line = trial;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      // A single word wider than the column: break it, because overflowing
      // the frame damages neighbouring elements.
      if (measureWidth(word, font) > maxWidth) {
        let chunk = "";
        for (const ch of word) {
          if (measureWidth(chunk + ch, font) > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        line = chunk;
      } else {
        line = word;
      }
    }
    if (line) lines.push(line);
  }

  const width = lines.reduce((m, l) => Math.max(m, measureWidth(l, font)), 0);
  return { lines, width, height: lines.length * font.size * lineHeight };
}

/** Height of text at a given width. The measurement composers actually need. */
export function measureHeight(
  text: string,
  maxWidth: number,
  font: FontSpec,
  lineHeight = 1.5,
): number {
  return wrapText(text, maxWidth, font, lineHeight).height;
}

export interface FitResult {
  fontSize: number;
  lines: string[];
  height: number;
  /** True when the text had to shrink below the requested size. */
  shrunk: boolean;
  /** True when it still doesn't fit even at the minimum size. */
  overflows: boolean;
}

/**
 * Finds the largest font size at which text fits a fixed box.
 *
 * This is what stops a founder who writes a long problem statement from
 * getting text that spills over the element below. Binary search over sizes
 * rather than stepping down one pixel at a time, since each measurement
 * involves a wrap pass.
 */
export function fitText(
  text: string,
  box: { width: number; height: number },
  font: FontSpec,
  opts: { min?: number; lineHeight?: number } = {},
): FitResult {
  const lineHeight = opts.lineHeight ?? 1.5;
  const min = opts.min ?? Math.max(9, font.size * 0.55);
  const max = font.size;

  const fitsAt = (size: number) =>
    wrapText(text, box.width, { ...font, size }, lineHeight).height <= box.height;

  if (fitsAt(max)) {
    const w = wrapText(text, box.width, font, lineHeight);
    return { fontSize: max, lines: w.lines, height: w.height, shrunk: false, overflows: false };
  }

  let lo = min, hi = max, best = min;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (fitsAt(mid)) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const rounded = Math.floor(best * 2) / 2;
  const wrapped = wrapText(text, box.width, { ...font, size: rounded }, lineHeight);
  return {
    fontSize: rounded,
    lines: wrapped.lines,
    height: wrapped.height,
    shrunk: true,
    overflows: wrapped.height > box.height + 1,
  };
}

/**
 * Picks a display size so a headline fills its column on a target number of
 * lines.
 *
 * Big type that breaks into an ugly number of lines is one of the clearest
 * signs of an amateur deck: a two-word title set at the same size as a
 * nine-word one either looks timid or wraps badly. This scales the size so
 * headlines of different lengths land on a similar visual weight.
 */
export function fitHeadline(
  text: string,
  width: number,
  font: FontSpec,
  opts: { maxLines?: number; min?: number; max?: number; lineHeight?: number } = {},
): { fontSize: number; lines: string[]; height: number; metTarget: boolean } {
  const maxLines = opts.maxLines ?? 3;
  const lineHeight = opts.lineHeight ?? 1.05;
  const min = opts.min ?? font.size * 0.5;
  const max = opts.max ?? font.size;

  let lo = min, hi = max, best = min;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    const w = wrapText(text, width, { ...font, size: mid }, lineHeight);
    if (w.lines.length <= maxLines) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const size = Math.floor(best);
  const wrapped = wrapText(text, width, { ...font, size }, lineHeight);
  // A very long headline in a narrow column can't reach the target line
  // count even at the minimum size. Report that rather than silently
  // returning more lines than asked for, so the caller can pick a layout
  // with a wider column instead.
  return {
    fontSize: size,
    lines: wrapped.lines,
    height: wrapped.height,
    metTarget: wrapped.lines.length <= maxLines,
  };
}

/**
 * Detects a widow: a last line carrying only one short word.
 *
 * Typographers care about this because it leaves a visually broken block,
 * and it is the single most common flaw in founder-made slides.
 */
export function hasWidow(lines: string[]): boolean {
  if (lines.length < 2) return false;
  const last = lines[lines.length - 1].trim();
  return last.length > 0 && !last.includes(" ") && last.length <= 12;
}

/**
 * Inserts a non-breaking space before the final word so it pulls a companion
 * down with it, which is how a typesetter fixes a widow.
 */
export function fixWidow(text: string): string {
  const words = text.trim().split(/\s+/);
  if (words.length < 3) return text;
  return words.slice(0, -1).join(" ") + "\u00A0" + words[words.length - 1];
}

/** Rough reading-time and density signals, used by the deck review. */
export function textStats(text: string): { words: number; chars: number } {
  const trimmed = text.trim();
  return {
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    chars: trimmed.length,
  };
}
