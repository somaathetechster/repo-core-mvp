import { useState } from "react";
import {
  CHART_INK, CHART_MUTED, CHART_FAINT, CHART_BASELINE,
  CHART_FONT, TYPE, MARGIN, seriesColor,
} from "./theme";
import { formatCompact, formatFull, truncateLabel, niceTicks, type ValueFormat } from "./format";

export interface BarDatum {
  label: string;
  value: number;
}

interface BarChartProps {
  data: BarDatum[];
  format?: ValueFormat;
  width?: number;
  height?: number;
  /** Horizontal bars are the right default when labels are long. */
  orientation?: "vertical" | "horizontal";
  highlightIndex?: number | null;
}

export default function BarChart({
  data,
  format = {},
  width = 640,
  height = 360,
  orientation,
  highlightIndex = null,
}: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return <EmptyPlot width={width} height={height} message="No data to plot." />;
  }

  // Long labels are unreadable rotated on a vertical axis, so flip to
  // horizontal bars automatically rather than producing a chart nobody can
  // read. This is the single most common bar-chart legibility failure.
  const longestLabel = Math.max(...data.map((d) => d.label.length));
  const resolved = orientation ?? (longestLabel > 12 || data.length > 8 ? "horizontal" : "vertical");

  return resolved === "horizontal" ? (
    <HorizontalBars
      data={data} format={format} width={width} height={height}
      hover={hover} setHover={setHover} highlightIndex={highlightIndex}
    />
  ) : (
    <VerticalBars
      data={data} format={format} width={width} height={height}
      hover={hover} setHover={setHover} highlightIndex={highlightIndex}
    />
  );
}

interface InnerProps extends BarChartProps {
  hover: number | null;
  setHover: (i: number | null) => void;
}

function HorizontalBars({ data, format = {}, width = 640, height = 360, hover, setHover, highlightIndex }: InnerProps) {
  const labelWidth = Math.min(180, Math.max(90, Math.max(...data.map((d) => d.label.length)) * 6.5));
  const m = { ...MARGIN, left: labelWidth + 12, right: 64, bottom: 28 };
  const plotW = width - m.left - m.right;
  const rowH = Math.max(22, Math.min(46, (height - m.top - m.bottom) / data.length));
  const plotH = rowH * data.length;
  const totalH = plotH + m.top + m.bottom;

  const max = Math.max(...data.map((d) => d.value), 0);
  const min = Math.min(...data.map((d) => d.value), 0);
  const ticks = niceTicks(min, max, 4);
  const scaleMax = Math.max(...ticks, max);
  const scaleMin = Math.min(...ticks, 0);
  const x = (v: number) => ((v - scaleMin) / (scaleMax - scaleMin || 1)) * plotW;
  const zeroX = x(0);
  const barGap = Math.min(8, rowH * 0.28);

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${totalH}`} style={{ fontFamily: CHART_FONT, display: "block" }}>
      {/* Vertical gridlines only, since bars run horizontally */}
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={m.left + x(t)} x2={m.left + x(t)} y1={m.top} y2={m.top + plotH}
            stroke={t === 0 ? CHART_BASELINE : CHART_FAINT}
            strokeWidth={t === 0 ? 1.25 : 1}
          />
          <text
            x={m.left + x(t)} y={m.top + plotH + 18}
            textAnchor="middle" fontSize={TYPE.axisTick} fill={CHART_MUTED}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatCompact(t, format)}
          </text>
        </g>
      ))}

      {data.map((d, i) => {
        const y = m.top + i * rowH + barGap / 2;
        const h = rowH - barGap;
        const barX = m.left + Math.min(x(0), x(d.value));
        const barW = Math.abs(x(d.value) - zeroX);
        const isActive = hover === i || highlightIndex === i;
        const isDimmed = (hover !== null && hover !== i) || (highlightIndex !== null && highlightIndex !== i);

        return (
          <g
            key={`${d.label}-${i}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: "default" }}
          >
            <rect x={0} y={y - barGap / 2} width={width} height={rowH} fill="transparent" />
            <text
              x={m.left - 12} y={y + h / 2}
              textAnchor="end" dominantBaseline="central"
              fontSize={TYPE.axisTick}
              fill={isActive ? CHART_INK : CHART_MUTED}
              fontWeight={isActive ? 600 : 400}
            >
              {truncateLabel(d.label, Math.floor(labelWidth / 6.5))}
            </text>
            <rect
              x={barX} y={y} width={Math.max(barW, 1)} height={h}
              fill={seriesColor(0)}
              opacity={isDimmed ? 0.35 : 1}
              rx={1.5}
            />
            {/* Direct value label: removes the need to read values off an axis */}
            <text
              x={barX + barW + 8} y={y + h / 2}
              dominantBaseline="central"
              fontSize={TYPE.valueLabel}
              fill={isDimmed ? CHART_MUTED : CHART_INK}
              fontWeight={500}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatCompact(d.value, format)}
            </text>
          </g>
        );
      })}

      {hover !== null && (
        <title>{`${data[hover].label}: ${formatFull(data[hover].value, format)}`}</title>
      )}
    </svg>
  );
}

function VerticalBars({ data, format = {}, width = 640, height = 360, hover, setHover, highlightIndex }: InnerProps) {
  const m = MARGIN;
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  const max = Math.max(...data.map((d) => d.value), 0);
  const min = Math.min(...data.map((d) => d.value), 0);
  const ticks = niceTicks(min, max, 5);
  const scaleMax = Math.max(...ticks, max);
  const scaleMin = Math.min(...ticks, 0);
  const y = (v: number) => plotH - ((v - scaleMin) / (scaleMax - scaleMin || 1)) * plotH;

  const slot = plotW / data.length;
  const barW = Math.min(64, slot * 0.62);

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: CHART_FONT, display: "block" }}>
      {/* Horizontal gridlines only. Vertical gridlines on a category axis
          are pure chartjunk, they don't correspond to anything measurable. */}
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={m.left} x2={m.left + plotW} y1={m.top + y(t)} y2={m.top + y(t)}
            stroke={t === 0 ? CHART_BASELINE : CHART_FAINT}
            strokeWidth={t === 0 ? 1.25 : 1}
          />
          <text
            x={m.left - 10} y={m.top + y(t)}
            textAnchor="end" dominantBaseline="central"
            fontSize={TYPE.axisTick} fill={CHART_MUTED}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatCompact(t, format)}
          </text>
        </g>
      ))}

      {data.map((d, i) => {
        const cx = m.left + slot * i + slot / 2;
        const top = m.top + Math.min(y(d.value), y(0));
        const h = Math.abs(y(d.value) - y(0));
        const isActive = hover === i || highlightIndex === i;
        const isDimmed = (hover !== null && hover !== i) || (highlightIndex !== null && highlightIndex !== i);

        return (
          <g
            key={`${d.label}-${i}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <rect x={cx - slot / 2} y={m.top} width={slot} height={plotH} fill="transparent" />
            <rect
              x={cx - barW / 2} y={top} width={barW} height={Math.max(h, 1)}
              fill={seriesColor(0)} opacity={isDimmed ? 0.35 : 1} rx={1.5}
            />
            <text
              x={cx} y={top - 7} textAnchor="middle"
              fontSize={TYPE.valueLabel}
              fill={isDimmed ? CHART_MUTED : CHART_INK}
              fontWeight={500}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatCompact(d.value, format)}
            </text>
            <text
              x={cx} y={m.top + plotH + 18} textAnchor="middle"
              fontSize={TYPE.axisTick}
              fill={isActive ? CHART_INK : CHART_MUTED}
              fontWeight={isActive ? 600 : 400}
            >
              {truncateLabel(d.label, Math.floor(slot / 6.5))}
            </text>
          </g>
        );
      })}

      {hover !== null && (
        <title>{`${data[hover].label}: ${formatFull(data[hover].value, format)}`}</title>
      )}
    </svg>
  );
}

export function EmptyPlot({ width, height, message }: { width: number; height: number; message: string }) {
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: CHART_FONT, display: "block" }}>
      <text
        x={width / 2} y={height / 2} textAnchor="middle"
        fontSize={13} fill={CHART_MUTED} fontStyle="italic"
      >
        {message}
      </text>
    </svg>
  );
}
