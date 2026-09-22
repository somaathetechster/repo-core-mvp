import {
  CANVAS_W, makeElement, elementId,
  type SlideElement, type ElementType,
} from "./elements";

/**
 * The element library.
 *
 * Presets are design structures, not clip art: a metric row, a comparison
 * table, a quote block, a timeline. Each inserts several correctly
 * proportioned, correctly styled elements at once, because the value is in
 * the arrangement rather than in any single box.
 *
 * Everything is tagged for search by industry and by what it does, so a
 * fintech founder looking for "unit economics" finds the metric row without
 * knowing the product's vocabulary.
 */

export interface LibraryItem {
  id: string;
  name: string;
  description: string;
  category: "structure" | "data" | "text" | "media" | "decoration";
  tags: string[];
  industries: string[];
  /** Builds the elements, positioned relative to a drop point. */
  build: (at: { x: number; y: number }) => SlideElement[];
}

function textEl(text: string, x: number, y: number, w: number, h: number, style: Record<string, unknown>): SlideElement {
  return makeElement("text", { x, y, w, h, z: 20 }, style as never, { text });
}

export const LIBRARY: LibraryItem[] = [
  /* ---------------- structures ---------------- */
  {
    id: "metric-row",
    name: "Metric row",
    description: "Three headline figures with labels beneath. The standard way to open a traction slide.",
    category: "data",
    tags: ["metrics", "kpi", "traction", "numbers", "growth", "unit economics", "stats"],
    industries: ["fintech", "saas", "marketplace", "consumer", "health", "govtech", "agritech", "edtech", "impact"],
    build: ({ x, y }) => {
      const w = 300, gap = 40;
      return [0, 1, 2].flatMap((i) => [
        makeElement("metric", { x: x + i * (w + gap), y, w, h: 74, z: 20 },
          { color: "accent", fontFamily: "display", fontSize: 58, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.03em" },
          { text: ["2,407", "₦57.4M", "90.5%"][i] }),
        makeElement("caption", { x: x + i * (w + gap), y: y + 84, w, h: 22, z: 20 },
          { color: "muted", fontFamily: "label", fontSize: 14 },
          { text: ["Transactions", "Volume processed", "Success rate"][i] }),
      ]);
    },
  },
  {
    id: "comparison-two",
    name: "Before and after",
    description: "Two tinted panels contrasting the status quo with your solution.",
    category: "structure",
    tags: ["comparison", "problem", "solution", "before after", "versus", "contrast"],
    industries: ["saas", "fintech", "health", "logistics", "consumer", "govtech", "agritech", "impact"],
    build: ({ x, y }) => {
      const w = 470, gap = 40;
      return [
        makeElement("shape", { x, y, w, h: 240, z: 15 }, { background: "accentSoft", shape: "rect" }),
        makeElement("caption", { x: x + 24, y: y + 22, w: w - 48, h: 20, z: 20 },
          { color: "muted", fontFamily: "label", fontSize: 12, letterSpacing: "0.08em" }, { text: "TODAY" }),
        textEl("Describe the current state.", x + 24, y + 52, w - 48, 160,
          { color: "ink", fontFamily: "body", fontSize: 18, lineHeight: 1.55 }),
        makeElement("shape", { x: x + w + gap, y, w, h: 240, z: 15 }, { background: "ink", shape: "rect" }),
        makeElement("caption", { x: x + w + gap + 24, y: y + 22, w: w - 48, h: 20, z: 20 },
          { color: "inverse", fontFamily: "label", fontSize: 12, letterSpacing: "0.08em", opacity: 0.6 }, { text: "WITH US" }),
        textEl("Describe what changes.", x + w + gap + 24, y + 52, w - 48, 160,
          { color: "inverse", fontFamily: "body", fontSize: 18, lineHeight: 1.55 }),
      ];
    },
  },
  {
    id: "timeline",
    name: "Timeline",
    description: "A horizontal sequence of milestones on a rule. Use for roadmap or company history.",
    category: "structure",
    tags: ["timeline", "roadmap", "milestones", "history", "phases", "plan"],
    industries: ["saas", "hardware", "biotech", "fintech", "energy", "agritech", "climate", "govtech"],
    build: ({ x, y }) => {
      const span = 980, steps = 4, gap = span / (steps - 1);
      const out: SlideElement[] = [
        makeElement("rule", { x, y: y + 40, w: span, h: 2, z: 15 }, { background: "rule" }),
      ];
      for (let i = 0; i < steps; i++) {
        const cx = x + i * gap;
        out.push(makeElement("shape", { x: cx - 6, y: y + 34, w: 14, h: 14, z: 20 },
          { background: "accent", shape: "circle" }));
        out.push(makeElement("caption", { x: cx - 70, y: y + 4, w: 140, h: 20, z: 20 },
          { color: "accent", fontFamily: "label", fontSize: 13, align: "center" },
          { text: `Q${i + 1} 2026` }));
        out.push(textEl(`Milestone ${i + 1}`, cx - 70, y + 62, 140, 60,
          { color: "ink", fontFamily: "body", fontSize: 15, lineHeight: 1.45, align: "center" }));
      }
      return out;
    },
  },
  {
    id: "three-column",
    name: "Three columns",
    description: "Three parallel points, each under a short accent rule.",
    category: "structure",
    tags: ["columns", "points", "features", "pillars", "three", "benefits"],
    industries: ["saas", "consumer", "fintech", "health", "education", "edtech", "govtech", "impact"],
    build: ({ x, y }) => {
      const w = 320, gap = 32;
      return [0, 1, 2].flatMap((i) => [
        makeElement("rule", { x: x + i * (w + gap), y, w: 40, h: 3, z: 20 }, { background: "accent" }),
        textEl(`Point ${i + 1}. Replace with your text.`, x + i * (w + gap), y + 20, w, 130,
          { color: "ink", fontFamily: "body", fontSize: 18, lineHeight: 1.55 }),
      ]);
    },
  },
  {
    id: "quote",
    name: "Pull quote",
    description: "A customer or investor quote set large with attribution.",
    category: "text",
    tags: ["quote", "testimonial", "customer", "social proof", "validation"],
    industries: ["consumer", "saas", "marketplace", "health", "education", "edtech", "agritech", "impact"],
    build: ({ x, y }) => [
      makeElement("quote", { x, y, w: 820, h: 140, z: 20 },
        { color: "ink", fontFamily: "display", fontSize: 34, lineHeight: 1.3, fontWeight: 500, borderLeft: 3, borderColor: "accent" },
        { text: "A short, specific quote carries more weight than a paragraph of claims." }),
      makeElement("caption", { x: x + 16, y: y + 156, w: 500, h: 22, z: 20 },
        { color: "muted", fontFamily: "label", fontSize: 14 },
        { text: "Name, Role, Company" }),
    ],
  },
  {
    id: "stat-callout",
    name: "Single statistic",
    description: "One number at large scale with a supporting sentence. For a slide built on one fact.",
    category: "data",
    tags: ["statistic", "number", "callout", "headline metric", "single"],
    industries: ["fintech", "health", "climate", "saas", "marketplace", "agritech", "govtech", "impact"],
    build: ({ x, y }) => [
      makeElement("statement", { x, y, w: 700, h: 120, z: 20 },
        { color: "accent", fontFamily: "display", fontSize: 96, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.04em" },
        { text: "44.9%" }),
      textEl("Explain what the number means and why it matters.", x, y + 134, 620, 70,
        { color: "ink", fontFamily: "body", fontSize: 21, lineHeight: 1.5 }),
    ],
  },
  {
    id: "logo-wall",
    name: "Partner row",
    description: "A row of placeholder logo slots for customers, partners, or investors.",
    category: "media",
    tags: ["logos", "partners", "customers", "clients", "investors", "integrations"],
    industries: ["saas", "fintech", "marketplace", "enterprise"],
    build: ({ x, y }) => {
      const w = 180, gap = 28;
      return [0, 1, 2, 3, 4].map((i) =>
        makeElement("image", { x: x + i * (w + gap), y, w, h: 74, z: 20 },
          { objectFit: "contain", background: "accentSoft" }, { src: null }),
      );
    },
  },
  {
    id: "two-col-text",
    name: "Two text columns",
    description: "A wide passage split into two readable columns.",
    category: "text",
    tags: ["text", "columns", "prose", "detail", "narrative"],
    industries: [],
    build: ({ x, y }) => [
      textEl("First column of text.", x, y, 480, 200, { color: "ink", fontFamily: "body", fontSize: 18, lineHeight: 1.6 }),
      textEl("Second column of text.", x + 520, y, 480, 200, { color: "muted", fontFamily: "body", fontSize: 18, lineHeight: 1.6 }),
    ],
  },
  {
    id: "section-break",
    name: "Section divider",
    description: "A full-bleed field with a large section title. Use to break a long deck into parts.",
    category: "decoration",
    tags: ["section", "divider", "chapter", "break", "transition"],
    industries: [],
    build: () => [
      makeElement("shape", { x: 0, y: 0, w: CANVAS_W, h: 720, z: 1 }, { background: "ink", shape: "rect" }),
      makeElement("rule", { x: 96, y: 300, w: 72, h: 8, z: 10 }, { background: "accent" }),
      makeElement("heading", { x: 96, y: 330, w: 900, h: 110, z: 10 },
        { color: "inverse", fontFamily: "display", fontSize: 72, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.03em" },
        { text: "Section title" }),
    ],
  },
  {
    id: "risk-table",
    name: "Risk and mitigation",
    description: "Paired rows listing each risk against how you address it. Investors look for this.",
    category: "structure",
    tags: ["risk", "mitigation", "diligence", "concerns", "table", "objections"],
    industries: ["fintech", "health", "biotech", "energy", "insurance"],
    build: ({ x, y }) => {
      const out: SlideElement[] = [
        makeElement("caption", { x, y, w: 460, h: 20, z: 20 },
          { color: "muted", fontFamily: "label", fontSize: 12, letterSpacing: "0.08em" }, { text: "RISK" }),
        makeElement("caption", { x: x + 520, y, w: 460, h: 20, z: 20 },
          { color: "accent", fontFamily: "label", fontSize: 12, letterSpacing: "0.08em" }, { text: "HOW WE ADDRESS IT" }),
      ];
      for (let i = 0; i < 3; i++) {
        const ry = y + 34 + i * 92;
        out.push(makeElement("rule", { x, y: ry, w: 980, h: 1, z: 15 }, { background: "rule" }));
        out.push(textEl(`Risk ${i + 1}`, x, ry + 14, 460, 66,
          { color: "ink", fontFamily: "body", fontSize: 16, lineHeight: 1.5 }));
        out.push(textEl(`Mitigation ${i + 1}`, x + 520, ry + 14, 460, 66,
          { color: "muted", fontFamily: "body", fontSize: 16, lineHeight: 1.5 }));
      }
      return out;
    },
  },
  {
    id: "use-of-funds",
    name: "Use of funds",
    description: "Proportional allocation bars with percentages. For the ask slide.",
    category: "data",
    tags: ["funds", "ask", "raise", "allocation", "budget", "spend", "runway"],
    industries: [],
    build: ({ x, y }) => {
      const rows = [["Engineering", 45], ["Go to market", 30], ["Operations", 15], ["Reserve", 10]] as [string, number][];
      return rows.flatMap(([label, pct], i) => {
        const ry = y + i * 62;
        return [
          makeElement("caption", { x, y: ry, w: 220, h: 22, z: 20 },
            { color: "ink", fontFamily: "body", fontSize: 16 }, { text: label }),
          makeElement("shape", { x: x + 240, y: ry + 4, w: 560, h: 14, z: 15 },
            { background: "accentSoft", shape: "rect" }),
          makeElement("shape", { x: x + 240, y: ry + 4, w: 560 * (pct / 100), h: 14, z: 16 },
            { background: "accent", shape: "rect" }),
          makeElement("caption", { x: x + 820, y: ry, w: 80, h: 22, z: 20 },
            { color: "muted", fontFamily: "label", fontSize: 15, align: "right" }, { text: `${pct}%` }),
        ];
      });
    },
  },
  {
    id: "plain-text",
    name: "Text box",
    description: "An empty text box. The simplest building block.",
    category: "text",
    tags: ["text", "box", "blank", "empty", "write", "paragraph"],
    industries: [],
    build: ({ x, y }) => [
      textEl("Type here.", x, y, 420, 90, { color: "ink", fontFamily: "body", fontSize: 18, lineHeight: 1.55 }),
    ],
  },
  {
    id: "heading-text",
    name: "Heading",
    description: "A display-size heading.",
    category: "text",
    tags: ["heading", "title", "headline", "large text"],
    industries: [],
    build: ({ x, y }) => [
      makeElement("heading", { x, y, w: 680, h: 64, z: 20 },
        { color: "ink", fontFamily: "display", fontSize: 40, fontWeight: 600, lineHeight: 1.15, letterSpacing: "-0.015em" },
        { text: "Heading" }),
    ],
  },
  {
    id: "accent-block",
    name: "Colour block",
    description: "A filled rectangle in the accent colour. Use behind text or as structure.",
    category: "decoration",
    tags: ["block", "shape", "rectangle", "fill", "background", "colour"],
    industries: [],
    build: ({ x, y }) => [
      makeElement("shape", { x, y, w: 360, h: 200, z: 5 }, { background: "accent", shape: "rect" }),
    ],
  },
  {
    id: "image-frame",
    name: "Image",
    description: "An image placeholder you can drop a file into.",
    category: "media",
    tags: ["image", "photo", "picture", "screenshot", "product shot"],
    industries: [],
    build: ({ x, y }) => [
      makeElement("image", { x, y, w: 460, h: 300, z: 15 }, { objectFit: "cover", background: "accentSoft" }, { src: null }),
    ],
  },
];

export function searchLibrary(query: string, industry?: string | null): LibraryItem[] {
  const q = query.trim().toLowerCase();
  let items = LIBRARY;

  if (industry) {
    const ind = industry.toLowerCase();
    // Items with no industry tags are general-purpose and always relevant;
    // filtering them out would hide the text box from a fintech founder.
    items = items.filter((i) => i.industries.length === 0 || i.industries.some((x) => ind.includes(x) || x.includes(ind)));
  }

  if (!q) return items;

  return items
    .map((item) => {
      let score = 0;
      if (item.name.toLowerCase().includes(q)) score += 10;
      if (item.description.toLowerCase().includes(q)) score += 3;
      for (const tag of item.tags) {
        if (tag === q) score += 8;
        else if (tag.includes(q) || q.includes(tag)) score += 5;
      }
      for (const ind of item.industries) {
        if (ind.includes(q)) score += 4;
      }
      return { item, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}

/** Re-ids a preset's elements so the same item can be inserted repeatedly. */
export function instantiate(item: LibraryItem, at: { x: number; y: number }): SlideElement[] {
  return item.build(at).map((el) => ({ ...el, id: elementId(el.type as ElementType) }));
}


/**
 * The industries a founder can filter the library by.
 *
 * The picker used to be a single checkbox reading "show items suited to
 * Fintech", which made the product look like it was built for one sector.
 * These are the sectors the library is actually tagged for.
 */
export const LIBRARY_INDUSTRIES: { id: string; label: string }[] = [
  { id: "saas",        label: "SaaS / B2B" },
  { id: "fintech",     label: "Fintech" },
  { id: "health",      label: "Healthtech" },
  { id: "govtech",     label: "Govtech" },
  { id: "agritech",    label: "Agritech" },
  { id: "edtech",      label: "Edtech" },
  { id: "climate",     label: "Climate / Energy" },
  { id: "impact",      label: "Impact / Non-profit" },
  { id: "marketplace", label: "Marketplace" },
  { id: "consumer",    label: "Consumer" },
  { id: "logistics",   label: "Logistics" },
  { id: "hardware",    label: "Hardware / Deeptech" },
  { id: "biotech",     label: "Biotech" },
  { id: "enterprise",  label: "Enterprise" },
];

/** Maps a free-text profile industry onto a library tag, best-effort. */
export function normaliseIndustry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.toLowerCase();
  const hit = LIBRARY_INDUSTRIES.find(
    (i) => t.includes(i.id) || i.label.toLowerCase().split(/[^a-z]+/).some((w) => w.length > 3 && t.includes(w)),
  );
  if (hit) return hit.id;
  if (/bank|pay|lend|invest|wallet/.test(t)) return "fintech";
  if (/farm|agri|crop|livestock/.test(t)) return "agritech";
  if (/gov|public sector|civic/.test(t)) return "govtech";
  if (/school|learn|student|educat/.test(t)) return "edtech";
  if (/clinic|patient|medic|care|health/.test(t)) return "health";
  return null;
}
