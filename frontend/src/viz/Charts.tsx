import { useState } from "react";
import {
  CHART_INK, CHART_MUTED, CHART_FAINT, CHART_BASELINE, CHART_SURFACE,
  CHART_FONT, CHART_DISPLAY_FONT, TYPE, MARGIN,
  seriesColor, heatColor, heatTextColor,
} from "./theme";
import { formatCompact, formatFull, niceTicks, truncateLabel, type ValueFormat } from "./format";
import { EmptyPlot } from "./BarChart";

/* ------------------------------------------------------------------ */
/* Stat cards: the right answer for a short key/value table            */
/* ------------------------------------------------------------------ */

export interface StatDatum {
  label: string;
  value: number;
  format?: ValueFormat;
}

export function StatCards({ data }: { data: StatDatum[] }) {
  if (data.length === 0) return null;
  // Lead with the largest figure; a KPI block should have a clear focal point
  // rather than presenting every number at identical weight.
  const [lead, ...rest] = data;

  return (
    <div className="viz-stats">
      <div className="viz-stat viz-stat-lead">
        <span className="viz-stat-value">{formatFull(lead.value, lead.format)}</span>
        <span className="viz-stat-label">{lead.label}</span>
      </div>
      {rest.length > 0 && (
        <div className="viz-stat-grid">
          {rest.map((d) => (
            <div className="viz-stat" key={d.label}>
              <span className="viz-stat-value viz-stat-value-sm">{formatFull(d.value, d.format)}</span>
              <span className="viz-stat-label">{d.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Histogram: distribution of a single measure                         */
/* ------------------------------------------------------------------ */

export function Histogram({
  values,
  bins = 12,
  format = {},
  width = 640,
  height = 320,
}: {
  values: number[];
  bins?: number;
  format?: ValueFormat;
  width?: number;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const clean = values.filter((v) => isFinite(v));
  if (clean.length === 0) return <EmptyPlot width={width} height={height} message="No numeric values." />;

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const binWidth = (max - min) / bins || 1;
  const counts = new Array(bins).fill(0);
  clean.forEach((v) => {
    const idx = Math.min(bins - 1, Math.floor((v - min) / binWidth));
    counts[idx] += 1;
  });

  const m = MARGIN;
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const maxCount = Math.max(...counts);
  const ticks = niceTicks(0, maxCount, 4);
  const scaleMax = Math.max(...ticks);
  const y = (v: number) => plotH - (v / (scaleMax || 1)) * plotH;
  const slot = plotW / bins;

  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  const meanX = m.left + ((mean - min) / (max - min || 1)) * plotW;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: CHART_FONT, display: "block" }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={m.left} x2={m.left + plotW} y1={m.top + y(t)} y2={m.top + y(t)}
            stroke={t === 0 ? CHART_BASELINE : CHART_FAINT} strokeWidth={t === 0 ? 1.25 : 1} />
          <text x={m.left - 10} y={m.top + y(t)} textAnchor="end" dominantBaseline="central"
            fontSize={TYPE.axisTick} fill={CHART_MUTED} style={{ fontVariantNumeric: "tabular-nums" }}>
            {t}
          </text>
        </g>
      ))}

      {counts.map((c, i) => {
        const binStart = min + i * binWidth;
        const isHover = hover === i;
        return (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect
              x={m.left + slot * i + 1} y={m.top + y(c)}
              width={slot - 2} height={plotH - y(c)}
              fill={seriesColor(0)} opacity={hover === null || isHover ? 0.9 : 0.4}
            />
            {isHover && (
              <text x={m.left + slot * i + slot / 2} y={m.top + y(c) - 7} textAnchor="middle"
                fontSize={TYPE.valueLabel} fill={CHART_INK} fontWeight={600}>
                {c}
              </text>
            )}
            {(i === 0 || i === bins - 1 || i === Math.floor(bins / 2)) && (
              <text x={m.left + slot * i} y={m.top + plotH + 18} textAnchor="middle"
                fontSize={TYPE.axisTick} fill={CHART_MUTED} style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatCompact(binStart, format)}
              </text>
            )}
          </g>
        );
      })}

      {/* Mean marker: a distribution without a reference point is hard to judge */}
      <line x1={meanX} x2={meanX} y1={m.top} y2={m.top + plotH}
        stroke={seriesColor(3)} strokeWidth={1.5} strokeDasharray="4 3" />
      <text x={meanX} y={m.top - 8} textAnchor="middle" fontSize={TYPE.axisTick} fill={seriesColor(3)} fontWeight={600}>
        mean {formatCompact(mean, format)}
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Heatmap: two categorical dimensions plus a measure                  */
/* ------------------------------------------------------------------ */

export function Heatmap({
  rowLabels,
  columnLabels,
  matrix,
  format = {},
  width = 680,
}: {
  rowLabels: string[];
  columnLabels: string[];
  matrix: (number | null)[][];
  format?: ValueFormat;
  width?: number;
}) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const flat = matrix.flat().filter((v): v is number => v !== null && isFinite(v));
  if (flat.length === 0) return <EmptyPlot width={width} height={240} message="No values to map." />;

  const max = Math.max(...flat);
  const min = Math.min(...flat);
  const labelW = Math.min(150, Math.max(80, Math.max(...rowLabels.map((l) => l.length)) * 6.5));
  const headerH = 56;
  const cellW = Math.max(56, (width - labelW - 16) / columnLabels.length);
  const cellH = 34;
  const height = headerH + rowLabels.length * cellH + 16;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: CHART_FONT, display: "block" }}>
      {columnLabels.map((c, ci) => (
        <text
          key={c}
          x={labelW + ci * cellW + cellW / 2}
          y={headerH - 12}
          textAnchor="end"
          fontSize={TYPE.axisTick}
          fill={CHART_MUTED}
          transform={`rotate(-38, ${labelW + ci * cellW + cellW / 2}, ${headerH - 12})`}
        >
          {truncateLabel(c, 14)}
        </text>
      ))}

      {rowLabels.map((r, ri) => (
        <g key={r}>
          <text
            x={labelW - 10} y={headerH + ri * cellH + cellH / 2}
            textAnchor="end" dominantBaseline="central"
            fontSize={TYPE.axisTick} fill={CHART_MUTED}
          >
            {truncateLabel(r, Math.floor(labelW / 6.5))}
          </text>
          {columnLabels.map((_, ci) => {
            const v = matrix[ri]?.[ci] ?? null;
            const t = v === null ? 0 : (v - min) / (max - min || 1);
            const isHover = hover?.r === ri && hover?.c === ci;
            return (
              <g key={ci} onMouseEnter={() => setHover({ r: ri, c: ci })} onMouseLeave={() => setHover(null)}>
                <rect
                  x={labelW + ci * cellW} y={headerH + ri * cellH}
                  width={cellW - 2} height={cellH - 2}
                  fill={v === null ? "transparent" : heatColor(t)}
                  stroke={isHover ? CHART_INK : v === null ? CHART_FAINT : "transparent"}
                  strokeWidth={isHover ? 1.5 : 1}
                  strokeDasharray={v === null ? "2 2" : undefined}
                />
                {v !== null && cellW > 52 && (
                  <text
                    x={labelW + ci * cellW + (cellW - 2) / 2}
                    y={headerH + ri * cellH + (cellH - 2) / 2}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize={TYPE.valueLabel} fill={heatTextColor(t)}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {formatCompact(v, format)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      ))}

      {hover && matrix[hover.r]?.[hover.c] !== null && (
        <title>
          {`${rowLabels[hover.r]} / ${columnLabels[hover.c]}: ${formatFull(matrix[hover.r][hover.c] as number, format)}`}
        </title>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Donut: part-to-whole, only used when the data genuinely is one      */
/* ------------------------------------------------------------------ */

export function DonutChart({
  data,
  format = {},
  width = 460,
  height = 300,
}: {
  data: { label: string; value: number }[];
  format?: ValueFormat;
  width?: number;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((a, d) => a + d.value, 0);
  if (total <= 0) return <EmptyPlot width={width} height={height} message="No positive values to divide." />;

  const cx = height / 2 + 10;
  const cy = height / 2;
  const outer = Math.min(height, width) / 2 - 24;
  const inner = outer * 0.62;

  let angle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const sweep = (d.value / total) * Math.PI * 2;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const large = sweep > Math.PI ? 1 : 0;
    const p = (r: number, a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    const path =
      `M${p(outer, start)} A${outer},${outer} 0 ${large} 1 ${p(outer, end)} ` +
      `L${p(inner, end)} A${inner},${inner} 0 ${large} 0 ${p(inner, start)} Z`;
    return { ...d, path, share: d.value / total, index: i };
  });

  return (
    <div className="viz-donut-wrap">
      <svg width={height + 20} viewBox={`0 0 ${height + 20} ${height}`} style={{ fontFamily: CHART_FONT, flexShrink: 0 }}>
        {slices.map((s) => (
          <path
            key={s.label} d={s.path} fill={seriesColor(s.index)}
            opacity={hover === null || hover === s.index ? 1 : 0.35}
            onMouseEnter={() => setHover(s.index)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={22} fill={CHART_INK}
          style={{ fontFamily: CHART_DISPLAY_FONT, fontVariantNumeric: "tabular-nums" }}>
          {hover !== null ? `${(slices[hover].share * 100).toFixed(1)}%` : formatCompact(total, format)}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize={TYPE.statLabel} fill={CHART_MUTED}>
          {hover !== null ? truncateLabel(slices[hover].label, 18) : "total"}
        </text>
      </svg>

      <div className="viz-donut-legend">
        {slices.map((s) => (
          <button
            key={s.label}
            className={`viz-legend-row ${hover === s.index ? "is-active" : ""}`}
            onMouseEnter={() => setHover(s.index)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="viz-legend-swatch" style={{ background: seriesColor(s.index) }} />
            <span className="viz-legend-label">{s.label}</span>
            <span className="viz-legend-value">{(s.share * 100).toFixed(1)}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scatter: relationship between two measures                          */
/* ------------------------------------------------------------------ */

export function ScatterChart({
  points,
  xLabel,
  yLabel,
  xFormat = {},
  yFormat = {},
  width = 620,
  height = 380,
}: {
  points: { x: number; y: number; label: string }[];
  xLabel: string;
  yLabel: string;
  xFormat?: ValueFormat;
  yFormat?: ValueFormat;
  width?: number;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return <EmptyPlot width={width} height={height} message="No pairs to plot." />;

  const m = { ...MARGIN, bottom: 52 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xTicks = niceTicks(Math.min(...xs, 0), Math.max(...xs), 5);
  const yTicks = niceTicks(Math.min(...ys, 0), Math.max(...ys), 5);
  const xMin = Math.min(...xTicks), xMax = Math.max(...xTicks);
  const yMin = Math.min(...yTicks), yMax = Math.max(...yTicks);
  const sx = (v: number) => ((v - xMin) / (xMax - xMin || 1)) * plotW;
  const sy = (v: number) => plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: CHART_FONT, display: "block" }}>
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={m.left} x2={m.left + plotW} y1={m.top + sy(t)} y2={m.top + sy(t)}
            stroke={t === 0 ? CHART_BASELINE : CHART_FAINT} strokeWidth={t === 0 ? 1.25 : 1} />
          <text x={m.left - 10} y={m.top + sy(t)} textAnchor="end" dominantBaseline="central"
            fontSize={TYPE.axisTick} fill={CHART_MUTED} style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatCompact(t, yFormat)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={`x${t}`} x={m.left + sx(t)} y={m.top + plotH + 18} textAnchor="middle"
          fontSize={TYPE.axisTick} fill={CHART_MUTED} style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatCompact(t, xFormat)}
        </text>
      ))}

      {points.map((p, i) => (
        <circle
          key={i} cx={m.left + sx(p.x)} cy={m.top + sy(p.y)}
          r={hover === i ? 7 : 5}
          fill={seriesColor(0)} opacity={hover === null || hover === i ? 0.8 : 0.3}
          stroke={CHART_SURFACE} strokeWidth={1.5}
          onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
        />
      ))}

      {hover !== null && (
        <text
          x={m.left + sx(points[hover].x)} y={m.top + sy(points[hover].y) - 12}
          textAnchor="middle" fontSize={TYPE.valueLabel} fill={CHART_INK} fontWeight={600}
        >
          {truncateLabel(points[hover].label, 20)}
        </text>
      )}

      <text x={m.left + plotW / 2} y={height - 8} textAnchor="middle" fontSize={TYPE.axisTitle} fill={CHART_MUTED}>
        {xLabel}
      </text>
      <text x={14} y={m.top + plotH / 2} textAnchor="middle" fontSize={TYPE.axisTitle} fill={CHART_MUTED}
        transform={`rotate(-90, 14, ${m.top + plotH / 2})`}>
        {yLabel}
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Regional view: geographic comparison without a fake world map       */
/* ------------------------------------------------------------------ */

const REGION_NAMES: Record<string, string> = {
  NG: "Nigeria", KE: "Kenya", GH: "Ghana", ZA: "South Africa", EG: "Egypt",
  US: "United States", GB: "United Kingdom", UK: "United Kingdom", CA: "Canada",
  FR: "France", DE: "Germany", IN: "India", CN: "China", JP: "Japan",
  BR: "Brazil", AU: "Australia", MX: "Mexico", ES: "Spain", IT: "Italy",
  NL: "Netherlands", SE: "Sweden", AE: "United Arab Emirates", SA: "Saudi Arabia",
  TZ: "Tanzania", UG: "Uganda", RW: "Rwanda", ET: "Ethiopia", CI: "Côte d'Ivoire",
  SN: "Senegal", CM: "Cameroon", ZM: "Zambia", ZW: "Zimbabwe", MA: "Morocco",
  DZ: "Algeria", TN: "Tunisia",
};

/**
 * A proportional regional breakdown rather than a choropleth.
 *
 * A real choropleth needs accurate boundary geometry, and a wrong or
 * low-fidelity map is worse than none: it implies precision that isn't
 * there. This shows magnitude and share per region with the intensity
 * encoding a map would provide, and expands the region code to its full
 * name so "NG" is legible to someone who doesn't know ISO codes.
 */
export function RegionalBreakdown({
  data,
  format = {},
}: {
  data: { label: string; value: number }[];
  format?: ValueFormat;
}) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const max = Math.max(...data.map((d) => d.value), 0);
  if (data.length === 0) return null;

  return (
    <div className="viz-regions">
      {data.map((d) => {
        const share = total > 0 ? d.value / total : 0;
        const intensity = max > 0 ? d.value / max : 0;
        const name = REGION_NAMES[d.label.trim().toUpperCase()] ?? d.label;
        return (
          <div className="viz-region" key={d.label}>
            <div className="viz-region-head">
              <span className="viz-region-code" style={{ background: heatColor(intensity), color: heatTextColor(intensity) }}>
                {d.label.trim().toUpperCase().slice(0, 3)}
              </span>
              <span className="viz-region-name">{name}</span>
              <span className="viz-region-value">{formatFull(d.value, format)}</span>
            </div>
            <div className="viz-region-bar">
              <div className="viz-region-fill" style={{ width: `${share * 100}%`, background: heatColor(intensity) }} />
            </div>
            <span className="viz-region-share">{(share * 100).toFixed(1)}% of total</span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Data table: precise figures, properly aligned                       */
/* ------------------------------------------------------------------ */

export function DataTable({
  columns,
  rows,
  numericColumns = new Set<number>(),
  formats = {},
  maxRows = 100,
}: {
  columns: string[];
  rows: (string | number | null)[][];
  numericColumns?: Set<number>;
  formats?: Record<number, ValueFormat>;
  maxRows?: number;
}) {
  const shown = rows.slice(0, maxRows);
  return (
    <div className="viz-table-wrap">
      <table className="viz-table">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} className={numericColumns.has(i) ? "is-numeric" : ""}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, ri) => (
            <tr key={ri}>
              {columns.map((_, ci) => {
                const raw = row[ci];
                const isNum = numericColumns.has(ci);
                const num = typeof raw === "number" ? raw : parseFloat(String(raw ?? "").replace(/[^0-9.\-]/g, ""));
                return (
                  <td key={ci} className={isNum ? "is-numeric" : ""}>
                    {isNum && isFinite(num) ? formatFull(num, formats[ci]) : (raw ?? "")}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > maxRows && (
        <p className="viz-table-note">Showing {maxRows} of {rows.length.toLocaleString()} rows.</p>
      )}
    </div>
  );
}
