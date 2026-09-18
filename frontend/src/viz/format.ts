/**
 * Value formatting for charts and tables.
 *
 * Unformatted numbers are the single biggest reason a chart looks amateur.
 * An axis reading "57444.96" instead of "₦57.4K", or "0.68" where "68%" was
 * meant, makes a chart harder to read than the table it replaced.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", NGN: "₦", JPY: "¥", INR: "₹",
  ZAR: "R", KES: "KSh", GHS: "GH₵", USDT: "₮", USDC: "$",
};

export interface ValueFormat {
  currency?: string | null;
  isPercentage?: boolean;
  decimals?: number;
}

/** Compact form for axis ticks and tight labels: 57444.96 -> 57.4K */
export function formatCompact(value: number, fmt: ValueFormat = {}): string {
  if (!isFinite(value)) return "";
  const symbol = fmt.currency ? CURRENCY_SYMBOLS[fmt.currency] ?? "" : "";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (fmt.isPercentage) {
    return `${sign}${abs.toFixed(abs < 10 ? 1 : 0)}%`;
  }

  let out: string;
  if (abs >= 1_000_000_000) out = `${(abs / 1_000_000_000).toFixed(abs < 10_000_000_000 ? 1 : 0)}B`;
  else if (abs >= 1_000_000) out = `${(abs / 1_000_000).toFixed(abs < 10_000_000 ? 1 : 0)}M`;
  else if (abs >= 1_000) out = `${(abs / 1_000).toFixed(abs < 10_000 ? 1 : 0)}K`;
  else if (abs >= 1) out = abs.toFixed(abs < 10 && !Number.isInteger(abs) ? 1 : 0);
  else if (abs === 0) out = "0";
  else out = abs.toPrecision(2);

  return `${sign}${symbol}${out}`;
}

/** Full precision for tooltips and tables: 57444.96 -> ₦57,444.96 */
export function formatFull(value: number, fmt: ValueFormat = {}): string {
  if (!isFinite(value)) return "";
  const symbol = fmt.currency ? CURRENCY_SYMBOLS[fmt.currency] ?? "" : "";
  const decimals = fmt.decimals ?? (Number.isInteger(value) ? 0 : 2);
  const formatted = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const sign = value < 0 ? "-" : "";
  if (fmt.isPercentage) return `${sign}${formatted}%`;
  return `${sign}${symbol}${formatted}`;
}

/**
 * Formats a temporal label according to its granularity, so a monthly
 * series doesn't render as "2026-03-01T00:00:00" on every tick.
 */
export function formatDateLabel(iso: string, granularity?: string | null): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  switch (granularity) {
    case "year":
      return String(d.getFullYear());
    case "quarter":
      return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
    case "month":
      return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
    default:
      return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
}

/**
 * Chooses axis tick values that land on human-friendly round numbers,
 * rather than whatever the data's exact min/max happen to be.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min];
  const range = max - min;
  const rawStep = range / (count - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;

  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step * 0.001; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}

/** Truncates a category label for an axis without cutting mid-word where avoidable. */
export function truncateLabel(label: string, maxChars = 18): string {
  if (label.length <= maxChars) return label;
  const cut = label.slice(0, maxChars - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}
