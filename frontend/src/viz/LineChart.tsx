import { useState } from "react";
import {
  CHART_INK, CHART_MUTED, CHART_FAINT, CHART_BASELINE, CHART_SURFACE,
  CHART_FONT, TYPE, MARGIN, seriesColor,
} from "./theme";
import { formatCompact, formatFull, niceTicks, truncateLabel, type ValueFormat } from "./format";
import { EmptyPlot } from "./BarChart";

export interface LineSeries {
  name: string;
  points: { label: string; value: number | null }[];
  format?: ValueFormat;
}

interface LineChartProps {
  series: LineSeries[];
  width?: number;
  height?: number;
  /** A single series reads better with a subtle area fill beneath it. */
  fillArea?: boolean;
}

export default function LineChart({
  series,
  width = 640,
  height = 360,
  fillArea,
}: LineChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (series.length === 0 || series[0].points.length === 0) {
    return <EmptyPlot width={width} height={height} message="No data to plot." />;
  }

  // Reserve room on the right for end-of-line labels, which are easier to
  // read than a legend that forces the eye to cross-reference colours.
  const labelRoom = series.length > 1 ? 92 : 56;
  const m = { ...MARGIN, right: labelRoom };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  const labels = series[0].points.map((p) => p.label);
  const allValues = series.flatMap((s) => s.points.map((p) => p.value).filter((v): v is number => v !== null));
  if (allValues.length === 0) {
    return <EmptyPlot width={width} height={height} message="No numeric values in this series." />;
  }

  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  // Start at zero unless the data sits far above it, where a zero baseline
  // would flatten all the variation into an unreadable band.
  const baseline = rawMin > 0 && rawMin / rawMax > 0.45 ? rawMin : Math.min(0, rawMin);
  const ticks = niceTicks(baseline, rawMax, 5);
  const scaleMin = Math.min(...ticks);
  const scaleMax = Math.max(...ticks);

  const x = (i: number) => (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const y = (v: number) => plotH - ((v - scaleMin) / (scaleMax - scaleMin || 1)) * plotH;

  // Show a readable subset of x labels rather than overlapping every tick.
  const maxLabels = Math.max(2, Math.floor(plotW / 78));
  const labelStride = Math.max(1, Math.ceil(labels.length / maxLabels));

  return (
    <svg
      width="100%" viewBox={`0 0 ${width} ${height}`}
      style={{ fontFamily: CHART_FONT, display: "block" }}
      onMouseLeave={() => setHoverIndex(null)}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={m.left} x2={m.left + plotW} y1={m.top + y(t)} y2={m.top + y(t)}
            stroke={t === 0 ? CHART_BASELINE : CHART_FAINT}
            strokeWidth={t === 0 ? 1.25 : 1}
          />
          <text
            x={m.left - 10} y={m.top + y(t)} textAnchor="end" dominantBaseline="central"
            fontSize={TYPE.axisTick} fill={CHART_MUTED}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatCompact(t, series[0].format)}
          </text>
        </g>
      ))}

      {labels.map((label, i) =>
        i % labelStride === 0 || i === labels.length - 1 ? (
          <text
            key={`${label}-${i}`}
            x={m.left + x(i)} y={m.top + plotH + 20} textAnchor="middle"
            fontSize={TYPE.axisTick}
            fill={hoverIndex === i ? CHART_INK : CHART_MUTED}
            fontWeight={hoverIndex === i ? 600 : 400}
          >
            {truncateLabel(label, 12)}
          </text>
        ) : null
      )}

      {series.map((s, si) => {
        const color = seriesColor(si);
        const pts = s.points
          .map((p, i) => (p.value === null ? null : { x: m.left + x(i), y: m.top + y(p.value), i }))
          .filter((p): p is { x: number; y: number; i: number } => p !== null);
        if (pts.length === 0) return null;

        const path = pts.map((p, idx) => `${idx === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
        const showArea = (fillArea ?? series.length === 1) && si === 0;
        const areaPath =
          `${path} L${pts[pts.length - 1].x},${m.top + y(scaleMin)} L${pts[0].x},${m.top + y(scaleMin)} Z`;

        const last = pts[pts.length - 1];
        const lastValue = s.points[last.i].value;

        return (
          <g key={s.name}>
            {showArea && <path d={areaPath} fill={color} opacity={0.07} />}
            <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {/* Point markers only when sparse enough that they aid reading */}
            {pts.length <= 20 &&
              pts.map((p) => (
                <circle
                  key={p.i} cx={p.x} cy={p.y} r={hoverIndex === p.i ? 4.5 : 3}
                  fill={CHART_SURFACE} stroke={color} strokeWidth={2}
                />
              ))}
            {/* End-of-line label, replacing a legend */}
            <text
              x={last.x + 10} y={last.y} dominantBaseline="central"
              fontSize={TYPE.seriesLabel} fill={color} fontWeight={600}
            >
              {series.length > 1 ? truncateLabel(s.name, 12) : formatCompact(lastValue ?? 0, s.format)}
            </text>
            {series.length > 1 && (
              <text
                x={last.x + 10} y={last.y + 13} dominantBaseline="central"
                fontSize={TYPE.axisTick} fill={CHART_MUTED}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatCompact(lastValue ?? 0, s.format)}
              </text>
            )}
          </g>
        );
      })}

      {/* Hover crosshair with a readout, instead of a floating tooltip box */}
      {hoverIndex !== null && (
        <g pointerEvents="none">
          <line
            x1={m.left + x(hoverIndex)} x2={m.left + x(hoverIndex)}
            y1={m.top} y2={m.top + plotH}
            stroke={CHART_INK} strokeWidth={1} strokeDasharray="3 3" opacity={0.4}
          />
          {series.map((s, si) => {
            const v = s.points[hoverIndex]?.value;
            if (v === null || v === undefined) return null;
            return (
              <circle
                key={s.name}
                cx={m.left + x(hoverIndex)} cy={m.top + y(v)} r={5}
                fill={seriesColor(si)} stroke={CHART_SURFACE} strokeWidth={2}
              />
            );
          })}
        </g>
      )}

      {/* Invisible hit areas for hover */}
      {labels.map((_, i) => (
        <rect
          key={i}
          x={m.left + x(i) - plotW / (labels.length * 2 || 1)}
          y={m.top} width={plotW / (labels.length || 1)} height={plotH}
          fill="transparent"
          onMouseEnter={() => setHoverIndex(i)}
        />
      ))}

      {hoverIndex !== null && (
        <title>
          {`${labels[hoverIndex]} — ` +
            series
              .map((s) => `${s.name}: ${formatFull(s.points[hoverIndex]?.value ?? 0, s.format)}`)
              .join(", ")}
        </title>
      )}
    </svg>
  );
}
