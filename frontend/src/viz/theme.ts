/**
 * Chart design tokens.
 *
 * These charts render on the deck's cream paper, and are meant to read like
 * a financial publication's figures rather than an admin dashboard's. The
 * palette is muted jewel tones chosen to stay distinguishable on cream, in
 * greyscale print, and for the common forms of colour blindness (no
 * red/green adjacency in the first four series).
 */

export const SERIES_COLORS = [
  "#1f1d1a", // ink, the primary series
  "#b8860b", // gold
  "#2d5f56", // pine
  "#8c3b2e", // brick
  "#3d5a80", // slate
  "#6b7340", // moss
  "#7d5a7a", // plum
  "#a67c52", // bronze
];

export const CHART_INK = "#1f1d1a";
export const CHART_MUTED = "#8a8272";      // axis labels, secondary text
export const CHART_FAINT = "#d8d2c4";      // gridlines
export const CHART_BASELINE = "#a9a294";   // the zero line, deliberately darker than grid
export const CHART_SURFACE = "#f7f4ec";    // paper

export const CHART_FONT = '"Inter", -apple-system, sans-serif';
export const CHART_DISPLAY_FONT = '"Fraunces", Georgia, serif';

/** Type scale for chart text, in px. Deliberately small and tight. */
export const TYPE = {
  axisTick: 11,
  axisTitle: 11,
  valueLabel: 11,
  seriesLabel: 12,
  title: 15,
  statValue: 30,
  statLabel: 11,
};

/**
 * Default plot margins. Generous left/bottom because axis labels need room;
 * cramped margins are a common reason charts look unfinished.
 */
export const MARGIN = { top: 24, right: 28, bottom: 44, left: 64 };

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

/**
 * A sequential ramp for heatmaps, running from the paper colour up through
 * gold to ink so intensity reads correctly in greyscale too.
 */
export function heatColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const stops: [number, [number, number, number]][] = [
    [0.0, [247, 244, 236]],
    [0.45, [224, 194, 122]],
    [0.75, [184, 134, 11]],
    [1.0, [76, 56, 20]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (clamped >= t0 && clamped <= t1) {
      const local = (clamped - t0) / (t1 - t0);
      const rgb = c0.map((c, j) => Math.round(c + (c1[j] - c) * local));
      return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    }
  }
  return `rgb(${stops[stops.length - 1][1].join(",")})`;
}

/** Readable text colour for a given heat intensity. */
export function heatTextColor(t: number): string {
  return t > 0.6 ? "#f7f4ec" : "#1f1d1a";
}
