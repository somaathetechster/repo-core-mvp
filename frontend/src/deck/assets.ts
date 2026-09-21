/**
 * The asset library.
 *
 * Shapes, icons, illustrations and patterns, all as SVG path data rather
 * than bitmaps, so they scale to any size, weigh almost nothing in the deck
 * JSON, and recolour with the theme instead of being locked to whatever
 * colour they were drawn in.
 *
 * Everything here is original geometry. Nothing traces or reproduces an
 * existing icon set or illustration, which matters because a deck a founder
 * sends to investors should not carry someone else's licensed artwork.
 */

export type AssetCategory = "shape" | "icon" | "illustration" | "pattern" | "arrow" | "device" | "effects";

export interface AssetDef {
  id: string;
  name: string;
  category: AssetCategory;
  tags: string[];
  /** viewBox the paths are drawn in. */
  viewBox: string;
  /** Path data. `fill` paths take the element's colour; `stroke` paths its outline. */
  paths: { d: string; mode: "fill" | "stroke"; opacity?: number; width?: number }[];
  /** Sensible default frame, in canvas pixels. */
  size: { w: number; h: number };
  /** Whether the asset reads better filled with the accent or drawn as a line. */
  defaultStyle?: "solid" | "outline";
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

const SHAPES: AssetDef[] = [
  {
    id: "rect", name: "Rectangle", category: "shape",
    tags: ["rectangle", "box", "block", "square", "panel"],
    viewBox: "0 0 100 100", size: { w: 260, h: 160 },
    paths: [{ d: "M0 0 H100 V100 H0 Z", mode: "fill" }],
  },
  {
    id: "rounded", name: "Rounded block", category: "shape",
    tags: ["rounded", "card", "panel", "box"],
    viewBox: "0 0 100 100", size: { w: 260, h: 160 },
    paths: [{ d: "M12 0 H88 A12 12 0 0 1 100 12 V88 A12 12 0 0 1 88 100 H12 A12 12 0 0 1 0 88 V12 A12 12 0 0 1 12 0 Z", mode: "fill" }],
  },
  {
    id: "circle", name: "Circle", category: "shape",
    tags: ["circle", "dot", "round", "ellipse"],
    viewBox: "0 0 100 100", size: { w: 180, h: 180 },
    paths: [{ d: "M50 0 A50 50 0 1 1 49.9 0 Z", mode: "fill" }],
  },
  {
    id: "triangle", name: "Triangle", category: "shape",
    tags: ["triangle", "arrow", "play", "point"],
    viewBox: "0 0 100 100", size: { w: 160, h: 140 },
    paths: [{ d: "M50 4 L96 92 H4 Z", mode: "fill" }],
  },
  {
    id: "diamond", name: "Diamond", category: "shape",
    tags: ["diamond", "rhombus", "decision"],
    viewBox: "0 0 100 100", size: { w: 150, h: 150 },
    paths: [{ d: "M50 2 L98 50 L50 98 L2 50 Z", mode: "fill" }],
  },
  {
    id: "quarter", name: "Quarter round", category: "shape",
    tags: ["quarter", "arc", "corner", "curve"],
    viewBox: "0 0 100 100", size: { w: 180, h: 180 },
    paths: [{ d: "M0 100 V0 A100 100 0 0 1 100 100 Z", mode: "fill" }],
  },
  {
    id: "blob", name: "Organic blob", category: "shape",
    tags: ["blob", "organic", "soft", "background", "shape"],
    viewBox: "0 0 200 200", size: { w: 320, h: 320 },
    paths: [{ d: "M54 14 C104 -8 172 14 186 62 C200 110 158 140 148 174 C138 208 78 200 44 176 C10 152 -6 96 12 62 C24 38 34 24 54 14 Z", mode: "fill" }],
  },
  {
    id: "ring", name: "Ring", category: "shape",
    tags: ["ring", "donut", "circle", "outline", "loop"],
    viewBox: "0 0 100 100", size: { w: 180, h: 180 },
    paths: [{ d: "M50 6 A44 44 0 1 1 49.9 6 Z", mode: "stroke", width: 7 }],
  },
  {
    id: "hairline", name: "Hairline rule", category: "shape",
    tags: ["line", "rule", "divider", "hairline", "separator"],
    viewBox: "0 0 100 2", size: { w: 400, h: 2 },
    paths: [{ d: "M0 1 H100", mode: "stroke", width: 1 }],
  },
  {
    id: "bracket", name: "Bracket", category: "shape",
    tags: ["bracket", "frame", "corner", "highlight"],
    viewBox: "0 0 100 100", size: { w: 200, h: 200 },
    paths: [{ d: "M28 4 H4 V96 H28 M72 4 H96 V96 H72", mode: "stroke", width: 4 }],
  },
];

/* ------------------------------------------------------------------ */
/* Arrows and connectors                                               */
/* ------------------------------------------------------------------ */

const ARROWS: AssetDef[] = [
  {
    id: "arrow-right", name: "Arrow", category: "arrow",
    tags: ["arrow", "right", "next", "direction", "flow"],
    viewBox: "0 0 120 40", size: { w: 200, h: 66 },
    paths: [{ d: "M2 20 H104 M86 4 L104 20 L86 36", mode: "stroke", width: 3 }],
  },
  {
    id: "arrow-curve", name: "Curved arrow", category: "arrow",
    tags: ["arrow", "curve", "flow", "loop", "process"],
    viewBox: "0 0 120 80", size: { w: 200, h: 130 },
    paths: [{ d: "M6 68 C6 20 60 6 110 24 M94 10 L112 25 L92 38", mode: "stroke", width: 3 }],
  },
  {
    id: "arrow-up-right", name: "Growth arrow", category: "arrow",
    tags: ["growth", "up", "increase", "trend", "arrow"],
    viewBox: "0 0 100 100", size: { w: 170, h: 170 },
    paths: [{ d: "M12 88 L88 12 M52 12 H88 V48", mode: "stroke", width: 4 }],
  },
  {
    id: "connector", name: "Step connector", category: "arrow",
    tags: ["connector", "step", "process", "chain", "timeline"],
    viewBox: "0 0 200 20", size: { w: 340, h: 34 },
    paths: [
      { d: "M10 10 H190", mode: "stroke", width: 1.5, opacity: 0.4 },
      { d: "M10 10 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0", mode: "fill" },
      { d: "M100 10 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0", mode: "fill" },
      { d: "M190 10 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0", mode: "fill" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Icons — drawn on a consistent 24-unit grid with a 2-unit stroke     */
/* ------------------------------------------------------------------ */

function icon(id: string, name: string, tags: string[], d: string | string[]): AssetDef {
  return {
    id: `icon-${id}`, name, category: "icon", tags,
    viewBox: "0 0 24 24", size: { w: 72, h: 72 }, defaultStyle: "outline",
    paths: (Array.isArray(d) ? d : [d]).map((p) => ({ d: p, mode: "stroke" as const, width: 1.7 })),
  };
}

const ICONS: AssetDef[] = [
  icon("users", "People", ["users", "team", "people", "customers", "audience"],
    ["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z", "M2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5",
     "M16.5 11.5a3 3 0 1 0 0-6", "M17 14.6c2.7.5 4.5 2.4 4.5 5.4"]),
  icon("growth", "Growth", ["growth", "chart", "increase", "revenue", "up", "trend"],
    ["M3 20h18", "M6 16l4.5-5 3.5 3.5L21 7", "M16 7h5v5"]),
  icon("shield", "Security", ["security", "shield", "safe", "protection", "compliance", "trust"],
    ["M12 3l7.5 3v6c0 4.4-3 8-7.5 9-4.5-1-7.5-4.6-7.5-9V6L12 3Z", "M9 12l2 2 4-4"]),
  icon("bolt", "Speed", ["speed", "fast", "instant", "bolt", "energy", "performance"],
    "M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z"),
  icon("globe", "Global", ["global", "world", "international", "cross-border", "globe"],
    ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M3.5 9h17M3.5 15h17",
     "M12 3c2.4 2.4 3.6 5.4 3.6 9s-1.2 6.6-3.6 9c-2.4-2.4-3.6-5.4-3.6-9S9.6 5.4 12 3Z"]),
  icon("wallet", "Payments", ["payment", "wallet", "money", "fintech", "card", "transaction"],
    ["M3 7.5A2.5 2.5 0 0 1 5.5 5h12A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-12A2.5 2.5 0 0 1 3 16.5v-9Z",
     "M3 9.5h18", "M16.5 14.5h.01"]),
  icon("chat", "Conversation", ["chat", "message", "conversation", "whatsapp", "support", "bot"],
    ["M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.5-5A8 8 0 1 1 21 12Z", "M9 11h.01M12 11h.01M15 11h.01"]),
  icon("layers", "Architecture", ["architecture", "layers", "stack", "system", "infrastructure"],
    ["M12 3 3 7.5l9 4.5 9-4.5L12 3Z", "M3 12.5 12 17l9-4.5", "M3 17 12 21.5 21 17"]),
  icon("code", "Engineering", ["code", "engineering", "developer", "technical", "build"],
    ["m8.5 8-5 4 5 4", "m15.5 8 5 4-5 4", "m13.5 5-3 14"]),
  icon("target", "Focus", ["target", "goal", "focus", "aim", "objective", "market"],
    ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z", "M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"]),
  icon("clock", "Time", ["time", "clock", "speed", "fast", "duration", "settlement"],
    ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7v5.5l3.5 2"]),
  icon("check", "Verified", ["check", "done", "verified", "complete", "success", "tick"],
    ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "m8 12 2.8 2.8L16 9.5"]),
  icon("alert", "Risk", ["risk", "warning", "alert", "caution", "problem"],
    ["M12 3.5 21.5 20H2.5L12 3.5Z", "M12 10v4.5", "M12 17.5h.01"]),
  icon("lock", "Private", ["lock", "private", "secure", "encryption", "key"],
    ["M5.5 10.5h13v9h-13v-9Z", "M8.5 10.5V7.5a3.5 3.5 0 1 1 7 0v3"]),
  icon("database", "Data", ["data", "database", "storage", "records", "ledger"],
    ["M12 7.5c4.1 0 7.5-1.1 7.5-2.5S16.1 2.5 12 2.5 4.5 3.6 4.5 5 7.9 7.5 12 7.5Z",
     "M19.5 5v14c0 1.4-3.4 2.5-7.5 2.5S4.5 20.4 4.5 19V5", "M19.5 12c0 1.4-3.4 2.5-7.5 2.5S4.5 13.4 4.5 12"]),
  icon("cycle", "Process", ["process", "cycle", "loop", "repeat", "workflow", "automation"],
    ["M20 12a8 8 0 0 1-13.7 5.7", "M4 12a8 8 0 0 1 13.7-5.7", "M17.5 2.5v4h-4", "M6.5 21.5v-4h4"]),
];

/* ------------------------------------------------------------------ */
/* Illustrations — abstract, compositional, original                   */
/* ------------------------------------------------------------------ */

const ILLUSTRATIONS: AssetDef[] = [
  {
    id: "ill-network", name: "Network", category: "illustration",
    tags: ["network", "nodes", "connections", "distributed", "graph", "routing"],
    viewBox: "0 0 200 160", size: { w: 380, h: 300 },
    paths: [
      { d: "M100 80 L36 40 M100 80 L164 40 M100 80 L36 124 M100 80 L164 124 M36 40 L164 40 M36 124 L164 124",
        mode: "stroke", width: 1.2, opacity: 0.35 },
      { d: "M100 80 m-14 0 a14 14 0 1 0 28 0 a14 14 0 1 0 -28 0", mode: "fill" },
      { d: "M36 40 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0", mode: "fill", opacity: 0.7 },
      { d: "M164 40 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0", mode: "fill", opacity: 0.7 },
      { d: "M36 124 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0", mode: "fill", opacity: 0.7 },
      { d: "M164 124 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0", mode: "fill", opacity: 0.7 },
    ],
  },
  {
    id: "ill-flow", name: "Flow", category: "illustration",
    tags: ["flow", "pipeline", "steps", "process", "sequence", "rails"],
    viewBox: "0 0 240 100", size: { w: 460, h: 190 },
    paths: [
      { d: "M20 50 H220", mode: "stroke", width: 1.5, opacity: 0.3 },
      { d: "M20 30 h40 v40 h-40 Z", mode: "fill", opacity: 0.85 },
      { d: "M100 30 h40 v40 h-40 Z", mode: "fill", opacity: 0.6 },
      { d: "M180 30 h40 v40 h-40 Z", mode: "fill", opacity: 0.35 },
      { d: "M66 50 h28 M88 44 l8 6 -8 6 M146 50 h28 M168 44 l8 6 -8 6", mode: "stroke", width: 2 },
    ],
  },
  {
    id: "ill-stack", name: "Layer stack", category: "illustration",
    tags: ["stack", "layers", "architecture", "system", "infrastructure", "platform"],
    viewBox: "0 0 200 160", size: { w: 360, h: 290 },
    paths: [
      { d: "M100 16 L180 52 L100 88 L20 52 Z", mode: "fill", opacity: 0.9 },
      { d: "M100 62 L180 98 L100 134 L20 98 Z", mode: "fill", opacity: 0.55 },
      { d: "M100 100 L180 136 L100 172 L20 136 Z", mode: "fill", opacity: 0.28 },
    ],
  },
  {
    id: "ill-bars", name: "Growth bars", category: "illustration",
    tags: ["growth", "bars", "chart", "traction", "increase", "revenue"],
    viewBox: "0 0 200 120", size: { w: 360, h: 216 },
    paths: [
      { d: "M14 110 H190", mode: "stroke", width: 1.5, opacity: 0.35 },
      { d: "M24 84 h26 v24 h-26 Z", mode: "fill", opacity: 0.32 },
      { d: "M64 64 h26 v44 h-26 Z", mode: "fill", opacity: 0.52 },
      { d: "M104 40 h26 v68 h-26 Z", mode: "fill", opacity: 0.74 },
      { d: "M144 12 h26 v96 h-26 Z", mode: "fill" },
    ],
  },
  {
    id: "ill-globe", name: "Globe lines", category: "illustration",
    tags: ["global", "world", "cross-border", "international", "reach", "africa"],
    viewBox: "0 0 200 200", size: { w: 340, h: 340 },
    paths: [
      { d: "M100 8 a92 92 0 1 1 -0.1 0 Z", mode: "stroke", width: 1.6 },
      { d: "M8 100 H192 M100 8 v184", mode: "stroke", width: 1, opacity: 0.4 },
      { d: "M100 8 C148 44 148 156 100 192 C52 156 52 44 100 8 Z", mode: "stroke", width: 1, opacity: 0.4 },
      { d: "M26 56 C64 76 136 76 174 56 M26 144 C64 124 136 124 174 144", mode: "stroke", width: 1, opacity: 0.4 },
    ],
  },
  {
    id: "ill-grid", name: "Dot field", category: "illustration",
    tags: ["dots", "grid", "field", "texture", "background", "pattern"],
    viewBox: "0 0 200 200", size: { w: 300, h: 300 },
    paths: Array.from({ length: 64 }, (_, i) => {
      const x = 16 + (i % 8) * 24;
      const y = 16 + Math.floor(i / 8) * 24;
      return { d: `M${x} ${y} m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0`, mode: "fill" as const, opacity: 0.5 };
    }),
  },
];

/* ------------------------------------------------------------------ */
/* Patterns and device frames                                          */
/* ------------------------------------------------------------------ */

const EXTRAS: AssetDef[] = [
  {
    id: "phone", name: "Phone frame", category: "device",
    tags: ["phone", "mobile", "device", "screenshot", "app", "mockup"],
    viewBox: "0 0 120 240", size: { w: 200, h: 400 },
    paths: [
      { d: "M18 4 h84 a14 14 0 0 1 14 14 v204 a14 14 0 0 1 -14 14 h-84 a14 14 0 0 1 -14 -14 v-204 a14 14 0 0 1 14 -14 Z", mode: "stroke", width: 3 },
      { d: "M48 14 h24", mode: "stroke", width: 3, opacity: 0.6 },
    ],
  },
  {
    id: "browser", name: "Browser frame", category: "device",
    tags: ["browser", "window", "web", "screenshot", "desktop", "mockup"],
    viewBox: "0 0 240 160", size: { w: 420, h: 280 },
    paths: [
      { d: "M6 10 h228 v144 h-228 Z", mode: "stroke", width: 2.5 },
      { d: "M6 32 h228", mode: "stroke", width: 2 },
      { d: "M18 21 m-4 0 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 M34 21 m-4 0 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 M50 21 m-4 0 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0", mode: "fill", opacity: 0.5 },
    ],
  },
  {
    id: "diagonal", name: "Diagonal stripes", category: "pattern",
    tags: ["stripes", "diagonal", "pattern", "texture", "background", "hatch"],
    viewBox: "0 0 200 200", size: { w: 300, h: 300 },
    paths: Array.from({ length: 14 }, (_, i) => ({
      d: `M${-40 + i * 24} 210 L${60 + i * 24} -10`, mode: "stroke" as const, width: 6, opacity: 0.4,
    })),
  },
  {
    id: "corner-mark", name: "Corner marks", category: "pattern",
    tags: ["corner", "crop", "marks", "frame", "registration"],
    viewBox: "0 0 200 200", size: { w: 280, h: 280 },
    paths: [
      { d: "M4 28 V4 H28 M172 4 H196 V28 M196 172 V196 H172 M28 196 H4 V172", mode: "stroke", width: 2.5 },
    ],
  },
];


/* ------------------------------------------------------------------ */
/* Special effects elements                                             */
/* ------------------------------------------------------------------ */

const EFFECTS: AssetDef[] = [
  {
    id: "fx-holo-card", name: "Holographic card", category: "shape",
    tags: ["holographic", "holo", "rainbow", "iridescent", "card", "special", "effect", "premium"],
    viewBox: "0 0 200 130", size: { w: 320, h: 208 },
    paths: [
      { d: "M12 0 H188 A12 12 0 0 1 200 12 V118 A12 12 0 0 1 188 130 H12 A12 12 0 0 1 0 118 V12 A12 12 0 0 1 12 0 Z", mode: "fill", opacity: 0.15 },
      { d: "M12 0 H188 A12 12 0 0 1 200 12 V118 A12 12 0 0 1 188 130 H12 A12 12 0 0 1 0 118 V12 A12 12 0 0 1 12 0 Z", mode: "stroke", width: 1.5, opacity: 0.8 },
      { d: "M0 40 Q50 20 100 45 Q150 70 200 40", mode: "stroke", width: 0.8, opacity: 0.6 },
      { d: "M0 65 Q50 45 100 70 Q150 95 200 65", mode: "stroke", width: 0.8, opacity: 0.5 },
      { d: "M0 90 Q50 70 100 95 Q150 120 200 90", mode: "stroke", width: 0.8, opacity: 0.4 },
    ],
    defaultStyle: "outline",
  },
  {
    id: "fx-glass-panel", name: "Glass panel", category: "shape",
    tags: ["glass", "glassmorphism", "frosted", "blur", "transparent", "panel", "card", "ui"],
    viewBox: "0 0 200 140", size: { w: 320, h: 224 },
    paths: [
      { d: "M14 0 H186 A14 14 0 0 1 200 14 V126 A14 14 0 0 1 186 140 H14 A14 14 0 0 1 0 126 V14 A14 14 0 0 1 14 0 Z", mode: "fill", opacity: 0.12 },
      { d: "M14 0 H186 A14 14 0 0 1 200 14 V126 A14 14 0 0 1 186 140 H14 A14 14 0 0 1 0 126 V14 A14 14 0 0 1 14 0 Z", mode: "stroke", width: 1, opacity: 0.5 },
      { d: "M2 14 Q100 6 198 14", mode: "stroke", width: 6, opacity: 0.18 },
    ],
    defaultStyle: "outline",
  },
  {
    id: "fx-glow-circle", name: "Glow orb", category: "shape",
    tags: ["glow", "orb", "radial", "light", "gradient", "soft", "spotlight"],
    viewBox: "0 0 200 200", size: { w: 280, h: 280 },
    paths: [
      { d: "M100 100 m-80 0 a80 80 0 1 0 160 0 a80 80 0 1 0 -160 0", mode: "fill", opacity: 0.08 },
      { d: "M100 100 m-56 0 a56 56 0 1 0 112 0 a56 56 0 1 0 -112 0", mode: "fill", opacity: 0.12 },
      { d: "M100 100 m-32 0 a32 32 0 1 0 64 0 a32 32 0 1 0 -64 0", mode: "fill", opacity: 0.22 },
      { d: "M100 100 m-14 0 a14 14 0 1 0 28 0 a14 14 0 1 0 -28 0", mode: "fill", opacity: 0.9 },
    ],
  },
  {
    id: "fx-noise-rect", name: "Noise texture", category: "pattern",
    tags: ["noise", "grain", "texture", "film", "organic", "rough"],
    viewBox: "0 0 100 100", size: { w: 300, h: 300 },
    paths: Array.from({length: 80}, (_, i) => {
      const x = ((i * 37 + 11) % 97) + 1;
      const y = ((i * 61 + 23) % 97) + 1;
      const r = 0.6 + (i % 4) * 0.3;
      return { d: `M${x} ${y} m-${r} 0 a${r} ${r} 0 1 0 ${r*2} 0 a${r} ${r} 0 1 0 -${r*2} 0`, mode: "fill" as const, opacity: 0.25 + (i % 5) * 0.06 };
    }),
  },
  {
    id: "fx-scan-lines", name: "Scan lines", category: "pattern",
    tags: ["scanlines", "scan", "lines", "retro", "screen", "crt", "texture"],
    viewBox: "0 0 100 100", size: { w: 300, h: 300 },
    paths: Array.from({length: 20}, (_, i) => ({
      d: `M0 ${i * 5 + 2} H100`, mode: "stroke" as const, width: 1, opacity: 0.3,
    })),
  },
  {
    id: "fx-gradient-mesh", name: "Gradient mesh", category: "shape",
    tags: ["gradient", "mesh", "soft", "background", "colour", "abstract"],
    viewBox: "0 0 200 200", size: { w: 360, h: 360 },
    paths: [
      { d: "M0 0 Q80 40 160 0 Q200 20 200 80 Q160 120 200 200 Q120 160 40 200 Q0 180 0 120 Q40 80 0 0 Z", mode: "fill", opacity: 0.4 },
      { d: "M40 40 Q100 0 160 40 Q200 80 160 140 Q120 180 60 160 Q0 140 40 80 Q20 60 40 40 Z", mode: "fill", opacity: 0.3 },
    ],
  },
];

export const ASSETS: AssetDef[] = [...SHAPES, ...ARROWS, ...ICONS, ...ILLUSTRATIONS, ...EXTRAS, ...EFFECTS];

export const ASSET_CATEGORIES: { id: AssetCategory | "all"; name: string }[] = [
  { id: "all", name: "All" },
  { id: "shape", name: "Shapes" },
  { id: "icon", name: "Icons" },
  { id: "illustration", name: "Illustrations" },
  { id: "arrow", name: "Arrows" },
  { id: "device", name: "Frames" },
  { id: "pattern", name: "Patterns" },
  { id: "effects", name: "Effects" },
];

export function searchAssets(query: string, category: AssetCategory | "all" = "all"): AssetDef[] {
  const pool = category === "all" ? ASSETS : ASSETS.filter((a) => a.category === category);
  const q = query.trim().toLowerCase();
  if (!q) return pool;

  return pool
    .map((a) => {
      let score = 0;
      if (a.name.toLowerCase().includes(q)) score += 10;
      for (const t of a.tags) {
        if (t === q) score += 8;
        else if (t.startsWith(q)) score += 6;
        else if (t.includes(q) || q.includes(t)) score += 4;
      }
      return { a, score };
    })
    .filter((r) => r.score > 0)
    .sort((x, y) => y.score - x.score)
    .map((r) => r.a);
}

/** Renders an asset to an inline SVG string, coloured by the caller. */
export function assetToSvg(asset: AssetDef, color: string, style: "solid" | "outline" = "solid"): string {
  const body = asset.paths
    .map((p) => {
      const useStroke = p.mode === "stroke" || style === "outline";
      const opacity = p.opacity !== undefined ? ` opacity="${p.opacity}"` : "";
      return useStroke
        ? `<path d="${p.d}" fill="none" stroke="${color}" stroke-width="${p.width ?? 2}" stroke-linecap="round" stroke-linejoin="round"${opacity}/>`
        : `<path d="${p.d}" fill="${color}"${opacity}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${asset.viewBox}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
}
