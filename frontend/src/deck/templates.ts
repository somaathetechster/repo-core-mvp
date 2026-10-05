/**
 * Deck templates.
 *
 * A template here is a compositional system, not a colour scheme. Switching
 * from Editorial to Modernist changes the grid, where titles sit, how the
 * cover is built, the type scale, the rule treatment, and the spatial
 * rhythm. If two templates differ only by accent colour, they are one
 * template with a setting, and this system would be pointless.
 *
 * Each template declares tokens plus a set of structural traits. The slide
 * renderers read those traits, so a single well-built renderer produces
 * genuinely different compositions rather than six near-copies.
 */

export interface TemplateFonts {
  display: string;
  body: string;
  label: string;
  /** Google Fonts families this template needs loaded, if any. */
  webfonts?: string[];
}

export interface TypeScale {
  statement: number;
  display: number;
  headline: number;
  subhead: number;
  body: number;
  caption: number;
  micro: number;
}

export interface TemplateTraits {
  /** How the cover slide is architected. */
  cover: "ink-field" | "split-vertical" | "paper-minimal" | "image-overlay" | "banded" | "centered-formal";
  /** Where a slide's title sits, which drives the whole reading order. */
  titlePlacement: "left-column" | "top-full" | "centered" | "side-rail" | "top-rule";
  /** The structural device that separates and organises content. */
  rule: "accent-bar" | "hairline-full" | "block-fill" | "none" | "column-divider";
  /** Body alignment. Centred text is a real choice for formal decks and a
   *  mistake for dense ones, so it belongs to the template. */
  align: "left" | "centered";
  /** Whether slides carry visible numbering, and in what form. */
  numbering: "none" | "numeric" | "sectioned";
  /** How supporting points are laid out. */
  points: "columns" | "stacked-rules" | "numbered-rows" | "grid-cards";
  /** Density affects margins and leading globally. */
  density: "generous" | "balanced" | "dense";
  /** Whether the template inverts (light text on dark) for emphasis slides. */
  invertsStatements: boolean;
  /** Team portrait treatment. */
  portraits: "square" | "circle" | "tall" | "duotone";
}

export interface DeckTemplate {
  id: string;
  name: string;
  description: string;
  bestFor: string;
  fonts: TemplateFonts;
  type: TypeScale;
  leading: { tight: number; normal: number; relaxed: number };
  grid: { margin: number; columns: number; gutter: number };
  /** Palette defaults. The founder's brand colours override accent and ink. */
  defaults: { ink: string; paper: string; accent: string };
  traits: TemplateTraits;
}

/* ------------------------------------------------------------------ */

const INTER = '"Inter", -apple-system, BlinkMacSystemFont, sans-serif';
const FRAUNCES = '"Fraunces", Georgia, serif';
const SOURCE_SERIF = '"Source Serif 4", Georgia, serif';
const JETBRAINS = '"JetBrains Mono", ui-monospace, Menlo, monospace';
const ARCHIVO = '"Archivo", "Helvetica Neue", Arial, sans-serif';
const PLAYFAIR = '"Playfair Display", Georgia, serif';
const SPACE_GROTESK = '"Space Grotesk", "Inter", sans-serif';

export const TEMPLATES: DeckTemplate[] = [
  {
    id: "editorial",
    name: "Editorial",
    description:
      "Asymmetric magazine composition. Headlines anchored left against a wide text column, generous air, a thin accent rule as the only ornament.",
    bestFor: "Consumer and brand-led companies where the story carries the pitch.",
    fonts: {
      display: FRAUNCES,
      body: INTER,
      label: INTER,
      webfonts: ["Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600", "Inter:wght@400;500;600"],
    },
    type: { statement: 104, display: 64, headline: 40, subhead: 26, body: 20, caption: 15, micro: 12 },
    leading: { tight: 1.02, normal: 1.35, relaxed: 1.55 },
    grid: { margin: 88, columns: 12, gutter: 24 },
    defaults: { ink: "#161412", paper: "#faf8f3", accent: "#b8860b" },
    traits: {
      cover: "ink-field",
      titlePlacement: "left-column",
      rule: "accent-bar",
      align: "left",
      numbering: "numeric",
      points: "columns",
      density: "generous",
      invertsStatements: false,
      portraits: "square",
    },
  },

  {
    id: "technical",
    name: "Technical Brief",
    description:
      "Visible grid, monospaced labels, dense information hierarchy. Built to make engineering substance legible rather than decorated.",
    bestFor: "Deep tech and infrastructure companies pitching technical partners.",
    fonts: {
      display: ARCHIVO,
      body: INTER,
      label: JETBRAINS,
      webfonts: ["Archivo:wght@500;600;700", "Inter:wght@400;500", "JetBrains+Mono:wght@400;500"],
    },
    type: { statement: 84, display: 52, headline: 32, subhead: 21, body: 17, caption: 13, micro: 11 },
    leading: { tight: 1.05, normal: 1.4, relaxed: 1.6 },
    grid: { margin: 64, columns: 12, gutter: 20 },
    defaults: { ink: "#12140f", paper: "#f4f4ef", accent: "#2d5f56" },
    traits: {
      cover: "banded",
      titlePlacement: "top-rule",
      rule: "hairline-full",
      align: "left",
      numbering: "sectioned",
      points: "numbered-rows",
      density: "dense",
      invertsStatements: false,
      portraits: "square",
    },
  },

  {
    id: "statement",
    name: "Statement",
    description:
      "One idea per slide at maximum scale. Full-bleed colour fields, almost no supporting text, nothing competing for attention.",
    bestFor: "Bold consumer plays and any pitch delivered live rather than read.",
    fonts: {
      display: ARCHIVO,
      body: ARCHIVO,
      label: ARCHIVO,
      webfonts: ["Archivo:wght@400;600;700;800"],
    },
    type: { statement: 148, display: 92, headline: 56, subhead: 30, body: 22, caption: 16, micro: 12 },
    leading: { tight: 0.92, normal: 1.2, relaxed: 1.45 },
    grid: { margin: 96, columns: 8, gutter: 32 },
    defaults: { ink: "#0d0d0d", paper: "#fafafa", accent: "#d64933" },
    traits: {
      cover: "paper-minimal",
      titlePlacement: "side-rail",
      rule: "block-fill",
      align: "left",
      numbering: "none",
      points: "stacked-rules",
      density: "generous",
      invertsStatements: true,
      portraits: "duotone",
    },
  },

  {
    id: "institutional",
    name: "Institutional",
    description:
      "Formal centred composition with hairline rules and classical serif throughout. Reads as a considered document rather than a startup pitch.",
    bestFor: "Grant committees, development funds, healthcare, and regulated sectors.",
    fonts: {
      display: SOURCE_SERIF,
      body: SOURCE_SERIF,
      label: INTER,
      webfonts: ["Source+Serif+4:opsz,wght@8..60,400;8..60,600", "Inter:wght@400;500"],
    },
    type: { statement: 76, display: 48, headline: 34, subhead: 22, body: 18, caption: 14, micro: 11 },
    leading: { tight: 1.15, normal: 1.45, relaxed: 1.7 },
    grid: { margin: 104, columns: 12, gutter: 28 },
    defaults: { ink: "#1a1a1a", paper: "#fbfaf7", accent: "#3d5a80" },
    traits: {
      cover: "centered-formal",
      titlePlacement: "centered",
      rule: "hairline-full",
      align: "centered",
      numbering: "numeric",
      points: "numbered-rows",
      density: "balanced",
      invertsStatements: false,
      portraits: "circle",
    },
  },

  {
    id: "modernist",
    name: "Modernist",
    description:
      "Swiss grid discipline. Flush-left sans throughout, strong colour blocks, no ornament, everything aligned to a strict module.",
    bestFor: "Design-conscious teams and anyone who wants confidence without warmth.",
    fonts: {
      display: INTER,
      body: INTER,
      label: INTER,
      webfonts: ["Inter:wght@400;500;600;700"],
    },
    type: { statement: 112, display: 68, headline: 38, subhead: 24, body: 18, caption: 14, micro: 11 },
    leading: { tight: 0.98, normal: 1.3, relaxed: 1.5 },
    grid: { margin: 72, columns: 12, gutter: 24 },
    defaults: { ink: "#111111", paper: "#ffffff", accent: "#e63946" },
    traits: {
      cover: "split-vertical",
      titlePlacement: "top-full",
      rule: "block-fill",
      align: "left",
      numbering: "numeric",
      points: "grid-cards",
      density: "balanced",
      invertsStatements: true,
      portraits: "square",
    },
  },

  {
    id: "narrative",
    name: "Narrative",
    description:
      "Image-forward and cinematic. Full-bleed photography with text set over scrims, built around showing the product rather than describing it.",
    bestFor: "Consumer products, marketplaces, and hardware with strong visuals.",
    fonts: {
      display: FRAUNCES,
      body: INTER,
      label: INTER,
      webfonts: ["Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700", "Inter:wght@400;500"],
    },
    type: { statement: 96, display: 72, headline: 42, subhead: 25, body: 19, caption: 14, micro: 11 },
    leading: { tight: 1.0, normal: 1.32, relaxed: 1.55 },
    grid: { margin: 80, columns: 12, gutter: 24 },
    defaults: { ink: "#14110f", paper: "#f8f5f0", accent: "#c9713d" },
    traits: {
      cover: "image-overlay",
      titlePlacement: "left-column",
      rule: "none",
      align: "left",
      numbering: "none",
      points: "grid-cards",
      density: "generous",
      invertsStatements: true,
      portraits: "tall",
    },
  },

  // ── Previously composer-only templates, now with full declared records so
  // they no longer inherit whatever colour scheme happened to be active. ──
  {
    id: "gallery",
    name: "Gallery",
    description: "A modular image grid where text blocks are cells. Built around showing, not telling.",
    bestFor: "Visual products, marketplaces, and brands with strong imagery.",
    fonts: { display: FRAUNCES, body: INTER, label: INTER, webfonts: ["Fraunces:opsz,wght@9..144,400;9..144,600", "Inter:wght@400;500;600"] },
    type: { statement: 96, display: 58, headline: 40, subhead: 24, body: 17, caption: 13, micro: 11 },
    leading: { tight: 1.04, normal: 1.35, relaxed: 1.6 },
    grid: { margin: 10, columns: 12, gutter: 10 },
    defaults: { ink: "#1a1a18", paper: "#f5f2ea", accent: "#8fbc8f" },
    traits: { cover: "image-overlay", titlePlacement: "top-full", rule: "block-fill", align: "left", numbering: "numeric", points: "grid-cards", density: "balanced", invertsStatements: false, portraits: "square" },
  },
  {
    id: "dossier",
    name: "Dossier",
    description: "A ruled technical document: masthead, hairline rules, findings in a table rhythm.",
    bestFor: "Diligence-heavy raises, technical partners, and formal reviews.",
    fonts: { display: SOURCE_SERIF, body: INTER, label: JETBRAINS, webfonts: ["Source+Serif+4:wght@400;600", "Inter:wght@400;500", "JetBrains+Mono:wght@400;500"] },
    type: { statement: 76, display: 48, headline: 32, subhead: 21, body: 16, caption: 12, micro: 10 },
    leading: { tight: 1.1, normal: 1.45, relaxed: 1.65 },
    grid: { margin: 64, columns: 12, gutter: 20 },
    defaults: { ink: "#1c1c1e", paper: "#f9f9f7", accent: "#4a5568" },
    traits: { cover: "banded", titlePlacement: "top-rule", rule: "hairline-full", align: "left", numbering: "sectioned", points: "numbered-rows", density: "dense", invertsStatements: false, portraits: "square" },
  },
  {
    id: "edition",
    name: "Edition",
    description: "A magazine spread: a dominant image bleeds off the edge against a high-contrast serif.",
    bestFor: "Consumer and lifestyle brands with editorial ambition.",
    fonts: { display: PLAYFAIR, body: INTER, label: INTER, webfonts: ["Playfair+Display:wght@400;700", "Inter:wght@400;500;600"] },
    type: { statement: 104, display: 66, headline: 42, subhead: 25, body: 18, caption: 14, micro: 11 },
    leading: { tight: 1.0, normal: 1.35, relaxed: 1.6 },
    grid: { margin: 80, columns: 12, gutter: 24 },
    defaults: { ink: "#141414", paper: "#fafafa", accent: "#c0392b" },
    traits: { cover: "image-overlay", titlePlacement: "left-column", rule: "none", align: "left", numbering: "numeric", points: "grid-cards", density: "generous", invertsStatements: true, portraits: "tall" },
  },
  {
    id: "signal",
    name: "Signal",
    description: "A colour field where type is the only element. Maximum signal, zero ornament.",
    bestFor: "Live-delivered pitches and bold single-idea decks.",
    fonts: { display: SPACE_GROTESK, body: INTER, label: INTER, webfonts: ["Space+Grotesk:wght@400;500;700", "Inter:wght@400;500"] },
    type: { statement: 156, display: 92, headline: 52, subhead: 28, body: 20, caption: 14, micro: 11 },
    leading: { tight: 0.94, normal: 1.25, relaxed: 1.45 },
    grid: { margin: 96, columns: 8, gutter: 28 },
    defaults: { ink: "#0a0a0a", paper: "#f5f5f5", accent: "#2563eb" },
    traits: { cover: "paper-minimal", titlePlacement: "side-rail", rule: "block-fill", align: "left", numbering: "none", points: "stacked-rules", density: "generous", invertsStatements: true, portraits: "square" },
  },
  {
    id: "blueprint",
    name: "Blueprint",
    description: "A saturated field with a visible structural grid and an extreme type scale.",
    bestFor: "Deep tech and infrastructure teams that want to look engineered.",
    fonts: { display: ARCHIVO, body: INTER, label: JETBRAINS, webfonts: ["Archivo:wght@400;600;700", "Inter:wght@400;500", "JetBrains+Mono:wght@400;500"] },
    type: { statement: 168, display: 84, headline: 40, subhead: 24, body: 16, caption: 13, micro: 11 },
    leading: { tight: 0.92, normal: 1.35, relaxed: 1.55 },
    grid: { margin: 56, columns: 12, gutter: 20 },
    defaults: { ink: "#0d1b2a", paper: "#e8f0fe", accent: "#1a56db" },
    traits: { cover: "banded", titlePlacement: "top-rule", rule: "hairline-full", align: "left", numbering: "sectioned", points: "numbered-rows", density: "dense", invertsStatements: false, portraits: "square" },
  },

  // ── Four new design systems (see templates-v3.ts for their composers). ──
  {
    id: "obsidian",
    name: "Obsidian",
    description: "Near-black canvas, gold accents, high contrast.",
    bestFor: "Fintech, late-stage, institutional investors.",
    fonts: { display: PLAYFAIR, body: INTER, label: INTER, webfonts: ["Playfair+Display:wght@400;700", "Inter:wght@300;400;500;600"] },
    type: { statement: 108, display: 72, headline: 42, subhead: 24, body: 18, caption: 13, micro: 11 },
    leading: { tight: 1.0, normal: 1.4, relaxed: 1.6 },
    grid: { margin: 88, columns: 12, gutter: 24 },
    defaults: { ink: "#f5f0e8", paper: "#0d0d0b", accent: "#c9a84c" },
    traits: { cover: "ink-field", titlePlacement: "left-column", rule: "accent-bar", align: "left", numbering: "numeric", points: "columns", density: "generous", invertsStatements: false, portraits: "square" },
  },
  {
    id: "brutus",
    name: "Brutus",
    description: "Maximum type, hard edges, zero decoration.",
    bestFor: "Consumer, gaming, bold B2C brands.",
    fonts: { display: ARCHIVO, body: INTER, label: JETBRAINS, webfonts: ["Archivo:wght@700;900", "Inter:wght@400;500", "JetBrains+Mono:wght@400"] },
    type: { statement: 160, display: 96, headline: 72, subhead: 28, body: 22, caption: 14, micro: 12 },
    leading: { tight: 0.92, normal: 1.25, relaxed: 1.45 },
    grid: { margin: 100, columns: 12, gutter: 24 },
    defaults: { ink: "#0a0a0a", paper: "#f0f0f0", accent: "#ff3300" },
    traits: { cover: "paper-minimal", titlePlacement: "top-full", rule: "block-fill", align: "left", numbering: "numeric", points: "numbered-rows", density: "generous", invertsStatements: true, portraits: "square" },
  },
  {
    id: "cartier",
    name: "Cartier",
    description: "Extreme whitespace, precise typography, luxury restraint.",
    bestFor: "Luxury, healthcare, impact, sophisticated B2B.",
    fonts: { display: INTER, body: INTER, label: INTER, webfonts: ["Inter:wght@300;400;500;700"] },
    type: { statement: 88, display: 56, headline: 44, subhead: 32, body: 18, caption: 13, micro: 11 },
    leading: { tight: 1.1, normal: 1.5, relaxed: 1.8 },
    grid: { margin: 120, columns: 12, gutter: 28 },
    defaults: { ink: "#1a1a1a", paper: "#ffffff", accent: "#1a1a1a" },
    traits: { cover: "paper-minimal", titlePlacement: "left-column", rule: "none", align: "left", numbering: "numeric", points: "stacked-rules", density: "generous", invertsStatements: false, portraits: "square" },
  },
  {
    id: "herald",
    name: "Herald",
    description: "Magazine editorial, serif authority, data in cards.",
    bestFor: "Investor decks, grant applications, premium presentations.",
    fonts: { display: FRAUNCES, body: INTER, label: INTER, webfonts: ["Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700", "Inter:wght@400;500;600"] },
    type: { statement: 104, display: 72, headline: 48, subhead: 26, body: 17, caption: 14, micro: 11 },
    leading: { tight: 1.02, normal: 1.4, relaxed: 1.65 },
    grid: { margin: 88, columns: 12, gutter: 24 },
    defaults: { ink: "#1a2e1a", paper: "#f5f0e4", accent: "#b5cc47" },
    traits: { cover: "ink-field", titlePlacement: "left-column", rule: "accent-bar", align: "left", numbering: "sectioned", points: "grid-cards", density: "balanced", invertsStatements: true, portraits: "square" },
  },
];

export const DEFAULT_TEMPLATE_ID = "editorial";

export function getTemplate(id?: string | null): DeckTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}

/**
 * Loads the webfonts a template needs. Templates are switched live, so
 * fonts load on demand rather than shipping every family up front.
 */
const loadedFonts = new Set<string>();

export function ensureFonts(template: DeckTemplate): void {
  const families = template.fonts.webfonts ?? [];
  const missing = families.filter((f) => !loadedFonts.has(f));
  if (missing.length === 0) return;

  const href =
    "https://fonts.googleapis.com/css2?" +
    missing.map((f) => `family=${f}`).join("&") +
    "&display=swap";

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
  missing.forEach((f) => loadedFonts.add(f));
}

/**
 * Colour schemes, applied on top of a template. A scheme changes mood
 * without touching composition, which is the axis a founder most often
 * wants to try quickly.
 */
export interface ColorScheme {
  id: string;
  name: string;
  ink: string;
  paper: string;
  accent: string;
}

export const COLOR_SCHEMES: ColorScheme[] = [
  { id: "template", name: "Template default", ink: "", paper: "", accent: "" },
  { id: "ink-gold", name: "Ink and gold", ink: "#161412", paper: "#faf8f3", accent: "#b8860b" },
  { id: "graphite", name: "Graphite", ink: "#1c1c1e", paper: "#f5f5f7", accent: "#5b6470" },
  { id: "pine", name: "Pine", ink: "#12211d", paper: "#f4f7f4", accent: "#2d6a4f" },
  { id: "oxblood", name: "Oxblood", ink: "#1a1214", paper: "#faf6f5", accent: "#8c2f39" },
  { id: "cobalt", name: "Cobalt", ink: "#0f1621", paper: "#f4f7fb", accent: "#1d4ed8" },
  { id: "sand", name: "Sand", ink: "#2b2519", paper: "#f7f2e7", accent: "#b07d3a" },
  { id: "mono", name: "Monochrome", ink: "#0a0a0a", paper: "#ffffff", accent: "#0a0a0a" },
];

export function applyScheme(
  template: DeckTemplate,
  schemeId: string | null | undefined,
  brandPrimary?: string | null,
  brandSecondary?: string | null,
): { ink: string; paper: string; accent: string } {
  const scheme = COLOR_SCHEMES.find((s) => s.id === schemeId);
  const base =
    scheme && scheme.id !== "template"
      ? { ink: scheme.ink, paper: scheme.paper, accent: scheme.accent }
      : { ...template.defaults };

  // The founder's own brand colours, when set, always win: the deck should
  // look like their company, not like a template that happens to be nice.
  return {
    ink: normaliseHex(brandSecondary) ?? base.ink,
    paper: base.paper,
    accent: normaliseHex(brandPrimary) ?? base.accent,
  };
}

function normaliseHex(value?: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return "#" + v.slice(1).split("").map((c) => c + c).join("");
  return null;
}
