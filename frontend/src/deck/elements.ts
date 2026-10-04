/**
 * The slide element model.
 *
 * Previously a slide was {title, blocks[], image, chart}: a document with
 * named fields. That model made three things impossible at once. Nothing
 * could be dragged, because there were no positioned objects. Templates
 * could only vary by tweaking parameters of one fixed arrangement, which is
 * why six "different" templates read as one template with settings. And
 * dropped data had nowhere to land except a new slide at the end.
 *
 * Here a slide is a list of elements, each with a frame (position and size
 * on the 1280x720 canvas), a type, content, and style. Everything follows:
 *
 *   - Freeform editing is moving and resizing frames.
 *   - A template is a function that arranges elements differently.
 *   - The element library inserts prebuilt elements.
 *   - Dropped data becomes a chart element plus a linked caption element.
 *
 * Slides keep their semantic role (`kind`) so generation and the table of
 * contents still know what a slide is *for*, independent of how it looks.
 */

export const CANVAS_W = 1280;
export const CANVAS_H = 720;

export type ElementType =
  | "text"
  | "heading"
  | "eyebrow"
  | "statement"
  | "image"
  | "chart"
  | "table"
  | "shape"
  | "rule"
  | "caption"
  | "metric"
  | "portrait"
  | "list"
  | "quote"
  | "logo"
  | "asset"
  | "blocks"
  | "pageNumber";

/* ------------------------------------------------------------------ */
/* Typed content blocks                                                */
/*                                                                     */
/* Beyond title/lead/points/sources a generated slide may carry an     */
/* ordered list of typed content blocks the builder and templates can  */
/* render as designed elements (stat callouts, comparison tables, etc) */
/* rather than prose. Every block type is optional; a slide with none  */
/* renders exactly as a text-only slide does.                          */
/* ------------------------------------------------------------------ */

export interface StatBlock {
  type: "stat";
  value: string;
  label: string;
  sublabel?: string;
  sources?: string[];
}
export interface ComparisonBlock {
  type: "comparison";
  columns: string[];
  rows: { cells: string[] }[];
  sources?: string[];
}
export interface TimelineBlock {
  type: "timeline";
  items: { period: string; points: string[] }[];
  sources?: string[];
}
export interface LogosBlock {
  type: "logos";
  items: { name: string; note?: string }[];
  sources?: string[];
}
export interface ChipsBlock {
  type: "chips";
  items: { name: string; role?: string; note?: string }[];
  sources?: string[];
}
export interface QuoteBlock {
  type: "quote";
  text: string;
  author: string;
  role?: string;
  sources?: string[];
}
export interface BarsBlock {
  type: "bars";
  items: { label: string; value: number; max?: number }[];
  sources?: string[];
}

export type ContentBlock =
  | StatBlock
  | ComparisonBlock
  | TimelineBlock
  | LogosBlock
  | ChipsBlock
  | QuoteBlock
  | BarsBlock;

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation in degrees. Rarely used, but free once frames exist. */
  rotation?: number;
  /** Stacking order; higher draws on top. */
  z?: number;
}

export interface ElementStyle {
  /** Named roles resolve against the active theme, so a theme change
   *  repaints every element without rewriting any element. */
  color?: "ink" | "accent" | "muted" | "inverse" | "paper" | string;
  background?: "none" | "paper" | "ink" | "accent" | "accentSoft" | string;
  fontFamily?: "display" | "body" | "label";
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: string;
  align?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  padding?: number;
  borderRadius?: number;
  borderLeft?: number;
  borderTop?: number;
  borderColor?: "accent" | "rule" | "ink";
  opacity?: number;
  /** Image-specific */
  objectFit?: "cover" | "contain";
  filter?: string;
  /** Focal point and zoom, so cropping keeps the subject in frame rather
   *  than defaulting to the centre. */
  focusX?: number;
  focusY?: number;
  zoom?: number;
  treatment?: string;
  /** Shape-specific */
  shape?: "rect" | "circle" | "line";
  /** Asset-specific: which library asset, and whether it draws solid or outline. */
  assetId?: string;
  assetStyle?: "solid" | "outline";
}

export interface SlideElement {
  id: string;
  type: ElementType;
  frame: Frame;
  style: ElementStyle;
  /** Text content, for text-bearing elements. */
  text?: string;
  /** Provenance, shown in the sources line and the evidence view. */
  source?: string;
  /** Image data URL. */
  src?: string | null;
  /** Chart payload. */
  chart?: {
    chart_type: string;
    columns: string[];
    rows: string[][];
    encoding?: Record<string, unknown>;
  };
  /** Typed content blocks, for a "blocks" element. */
  blocks?: ContentBlock[];
  /** A caption element attached to another element, so moving the parent
   *  can move the caption with it. */
  attachedTo?: string | null;
  /** Locked elements resist accidental dragging (page numbers, logos). */
  locked?: boolean;
  /** Group membership. Elements sharing a groupId select and move as one
   *  unit; a double-click isolates a single member for editing. */
  groupId?: string | null;
  /** Presentation opacity, independent of the style token values. */
  opacity?: number;
  /** Hidden elements remain in the layer stack but are not rendered. */
  hidden?: boolean;
}

/** The semantic purpose of a slide, independent of its visual arrangement. */
export type SlideKind =
  | "cover"
  | "contents"
  | "problem"
  | "solution"
  | "market"
  | "product"
  | "traction"
  | "business_model"
  | "competition"
  | "technology"
  | "team"
  | "ask"
  | "data"
  | "custom";

export interface ElementSlide {
  id: string;
  kind: SlideKind;
  /** Kept for the contents page and for regeneration. */
  title: string;
  elements: SlideElement[];
  /** Overrides the deck background for this slide (a dark statement page
   *  inside a light deck, say). The keywords resolve against the theme;
   *  any other value is used as a literal CSS colour (e.g. a hex the user
   *  picked in the background control). */
  background?: "paper" | "ink" | "accent" | (string & {}) | null;
  /** Set when the user has hand-positioned elements, so a template change
   *  can offer to preserve their work instead of silently discarding it. */
  customized?: boolean;
  /** Typed content blocks for this slide, carried through save/load and
   *  rendered via a composed "blocks" element. Independent of the rendering,
   *  so a template switch cannot consume it. */
  content_blocks?: ContentBlock[] | null;
}

/* ------------------------------------------------------------------ */
/* Construction helpers                                                */
/* ------------------------------------------------------------------ */

let idCounter = 0;
export function elementId(prefix = "el"): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function makeElement(
  type: ElementType,
  frame: Frame,
  style: ElementStyle = {},
  extra: Partial<SlideElement> = {},
): SlideElement {
  return { id: elementId(type), type, frame, style, ...extra };
}

/** Clamps a frame inside the canvas, used while dragging and resizing. */
export function clampFrame(frame: Frame): Frame {
  const w = Math.max(24, Math.min(frame.w, CANVAS_W));
  const h = Math.max(20, Math.min(frame.h, CANVAS_H));
  return {
    ...frame,
    w,
    h,
    x: Math.max(-w * 0.25, Math.min(frame.x, CANVAS_W - w * 0.75)),
    y: Math.max(-h * 0.25, Math.min(frame.y, CANVAS_H - h * 0.75)),
  };
}

/**
 * Alignment guides: returns the canvas and sibling edges a dragged frame is
 * close to, so the editor can snap and show guides. Hand-positioning
 * without snapping produces slides that are subtly misaligned everywhere,
 * which is exactly the amateur look this product exists to avoid.
 */
export interface SnapResult {
  frame: Frame;
  guides: { axis: "x" | "y"; at: number }[];
}

export function snapFrame(
  frame: Frame,
  siblings: SlideElement[],
  margin: number,
  threshold = 7,
): SnapResult {
  const guides: { axis: "x" | "y"; at: number }[] = [];
  let { x, y } = frame;

  const xTargets = [
    margin,
    CANVAS_W / 2 - frame.w / 2,
    CANVAS_W - margin - frame.w,
    ...siblings.flatMap((s) => [s.frame.x, s.frame.x + s.frame.w - frame.w, s.frame.x + s.frame.w]),
  ];
  const yTargets = [
    margin,
    CANVAS_H / 2 - frame.h / 2,
    CANVAS_H - margin - frame.h,
    ...siblings.flatMap((s) => [s.frame.y, s.frame.y + s.frame.h - frame.h, s.frame.y + s.frame.h]),
  ];

  for (const t of xTargets) {
    if (Math.abs(x - t) < threshold) {
      x = t;
      guides.push({ axis: "x", at: t });
      break;
    }
  }
  for (const t of yTargets) {
    if (Math.abs(y - t) < threshold) {
      y = t;
      guides.push({ axis: "y", at: t });
      break;
    }
  }

  return { frame: { ...frame, x, y }, guides };
}

/** Snap a moving selection as a group. The returned delta is shared by every
 * selected frame, so a multi-selection stays rigid while it aligns. */
export function snapDelta(
  moving: { id: string; frame: Frame }[],
  siblings: SlideElement[],
  threshold = 4,
): { dx: number; dy: number; guides: { axis: "x" | "y"; at: number }[] } {
  const guides: { axis: "x" | "y"; at: number }[] = [];
  const xTargets = [0, CANVAS_W / 2, CANVAS_W, ...siblings.flatMap((s) => [s.frame.x, s.frame.x + s.frame.w / 2, s.frame.x + s.frame.w])];
  const yTargets = [0, CANVAS_H / 2, CANVAS_H, ...siblings.flatMap((s) => [s.frame.y, s.frame.y + s.frame.h / 2, s.frame.y + s.frame.h])];
  let dx = 0;
  let dy = 0;
  let bestX = threshold + 1;
  let bestY = threshold + 1;

  for (const { frame } of moving) {
    const xEdges = [frame.x, frame.x + frame.w / 2, frame.x + frame.w];
    for (const edge of xEdges) for (const target of xTargets) {
      const distance = Math.abs(edge - target);
      if (distance <= threshold && distance < bestX) {
        bestX = distance;
        dx = target - edge;
        guides.splice(0, guides.length, ...guides.filter((g) => g.axis !== "x"));
        guides.push({ axis: "x", at: target });
      }
    }
    const yEdges = [frame.y, frame.y + frame.h / 2, frame.y + frame.h];
    for (const edge of yEdges) for (const target of yTargets) {
      const distance = Math.abs(edge - target);
      if (distance <= threshold && distance < bestY) {
        bestY = distance;
        dy = target - edge;
        guides.splice(0, guides.length, ...guides.filter((g) => g.axis !== "y"));
        guides.push({ axis: "y", at: target });
      }
    }
  }
  return { dx, dy, guides };
}

/* ------------------------------------------------------------------ */
/* Migration from the old document-shaped slide                        */
/* ------------------------------------------------------------------ */

export interface LegacySlide {
  id: string;
  type: string;
  title: string;
  blocks: { text: string; source: string }[];
  image_data_url: string | null;
  team_members: { name: string; role: string; bio: string; photo_data_url: string; linkedin_url: string }[] | null;
  toc_entries: { title: string }[] | null;
  chart?: { chart_type: string; columns: string[]; rows: string[][] };
  /** Typed content blocks produced by generation; optional and additive. */
  content_blocks?: ContentBlock[] | null;
}

const KIND_BY_TITLE: [RegExp, SlideKind][] = [
  [/problem|pain|broken/i, "problem"],
  [/solution|how it works|approach/i, "solution"],
  [/market|opportunity|tam/i, "market"],
  [/traction|growth|metrics|momentum/i, "traction"],
  [/business model|pricing|revenue|unit econ/i, "business_model"],
  [/competit|landscape|alternatives|defensib/i, "competition"],
  [/tech|architecture|engineering|platform/i, "technology"],
  [/team|founders|who we are/i, "team"],
  [/ask|raise|funding|use of funds/i, "ask"],
  [/product|demo|features/i, "product"],
];

export function inferKind(legacy: LegacySlide): SlideKind {
  if (legacy.type === "cover") return "cover";
  // Older/imported decks can carry TOC data while still labelling the slide
  // as a generic text slide. Treat the structured field as authoritative so
  // the contents page is not mistaken for an ordinary body slide.
  if (legacy.type === "toc" || legacy.toc_entries?.length) return "contents";
  if (legacy.type === "team") return "team";
  if (legacy.type === "chart") return "data";
  for (const [pattern, kind] of KIND_BY_TITLE) {
    if (pattern.test(legacy.title)) return kind;
  }
  return "custom";
}
