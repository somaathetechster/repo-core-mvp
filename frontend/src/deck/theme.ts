/**
 * The resolved deck theme.
 *
 * Elements reference colours and fonts by role ("accent", "display"), and
 * this resolves those roles to actual values. One object drives the entire
 * deck's appearance, which is what lets the theme editor repaint every
 * slide instantly instead of rewriting element data.
 */

export interface DeckTheme {
  ink: string;
  paper: string;
  accent: string;
  muted: string;
  rule: string;
  inverse: string;
  accentSoft: string;
  fonts: { display: string; body: string; label: string };
  /** Global scale applied to every font size, for decks that need to run
   *  larger or tighter overall without editing each element. */
  typeScale: number;
}

export interface ThemeSettings {
  ink: string;
  paper: string;
  accent: string;
  fontPairing: string;
  typeScale: number;
}

export const FONT_PAIRINGS: Record<string, { name: string; display: string; body: string; label: string; webfonts: string[]; note: string }> = {
  "fraunces-inter": {
    name: "Fraunces / Inter",
    display: '"Fraunces", Georgia, serif',
    body: '"Inter", -apple-system, sans-serif',
    label: '"Inter", -apple-system, sans-serif',
    webfonts: ["Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700", "Inter:wght@400;500;600;700"],
    note: "Editorial warmth with a neutral workhorse body.",
  },
  "archivo-inter": {
    name: "Archivo / Inter",
    display: '"Archivo", "Helvetica Neue", sans-serif',
    body: '"Inter", -apple-system, sans-serif',
    label: '"JetBrains Mono", ui-monospace, monospace',
    webfonts: ["Archivo:wght@500;600;700;800", "Inter:wght@400;500", "JetBrains+Mono:wght@400;500"],
    note: "Technical and direct. Monospaced labels signal engineering.",
  },
  "source-serif": {
    name: "Source Serif",
    display: '"Source Serif 4", Georgia, serif',
    body: '"Source Serif 4", Georgia, serif',
    label: '"Inter", -apple-system, sans-serif',
    webfonts: ["Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700", "Inter:wght@400;500"],
    note: "Formal throughout. Reads as an institutional document.",
  },
  "inter-only": {
    name: "Inter",
    display: '"Inter", -apple-system, sans-serif',
    body: '"Inter", -apple-system, sans-serif',
    label: '"Inter", -apple-system, sans-serif',
    webfonts: ["Inter:wght@400;500;600;700;800"],
    note: "Swiss neutrality. Nothing decorative, nothing in the way.",
  },
  "playfair-inter": {
    name: "Playfair / Inter",
    display: '"Playfair Display", Georgia, serif',
    body: '"Inter", -apple-system, sans-serif',
    label: '"Inter", -apple-system, sans-serif',
    webfonts: ["Playfair+Display:wght@500;600;700;800", "Inter:wght@400;500"],
    note: "High contrast and elegant. Suits consumer and lifestyle.",
  },
  "space-inter": {
    name: "Space Grotesk / Inter",
    display: '"Space Grotesk", sans-serif',
    body: '"Inter", -apple-system, sans-serif',
    label: '"Space Grotesk", sans-serif',
    webfonts: ["Space+Grotesk:wght@500;600;700", "Inter:wght@400;500"],
    note: "Contemporary and slightly mechanical. Reads modern without novelty.",
  },
};

export function buildTheme(settings: ThemeSettings): DeckTheme {
  const pairing = FONT_PAIRINGS[settings.fontPairing] ?? FONT_PAIRINGS["fraunces-inter"];
  return {
    ink: settings.ink,
    paper: settings.paper,
    accent: settings.accent,
    muted: mix(settings.ink, settings.paper, 0.42),
    rule: mix(settings.ink, settings.paper, 0.85),
    inverse: settings.paper,
    accentSoft: mix(settings.accent, settings.paper, 0.88),
    fonts: { display: pairing.display, body: pairing.body, label: pairing.label },
    typeScale: settings.typeScale,
  };
}

export function mix(a: string, b: string, amount: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  if (!pa || !pb) return a;
  const out = pa.map((c, i) => Math.round(c + (pb[i] - c) * amount));
  return `#${out.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio, used to warn when a chosen colour pair is unreadable. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  const light = Math.max(la, lb), dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

const loaded = new Set<string>();
export function loadFontPairing(id: string): void {
  const pairing = FONT_PAIRINGS[id];
  if (!pairing) return;
  const missing = pairing.webfonts.filter((f) => !loaded.has(f));
  if (missing.length === 0) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?" + missing.map((f) => `family=${f}`).join("&") + "&display=swap";
  document.head.appendChild(link);
  missing.forEach((f) => loaded.add(f));
}
