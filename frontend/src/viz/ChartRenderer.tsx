import BarChart from "./BarChart";
import LineChart, { type LineSeries } from "./LineChart";
import {
  StatCards, Histogram, Heatmap, DonutChart, ScatterChart,
  RegionalBreakdown, DataTable,
} from "./Charts";
import { formatDateLabel, type ValueFormat } from "./format";
import "./viz.css";

export interface ColumnMeta {
  name: string;
  type: string;
  role: string;
  currency?: string | null;
  is_percentage?: boolean;
  date_granularity?: string | null;
}

export interface ChartSpec {
  chart_type: string;
  title: string;
  reason: string;
  encoding: Record<string, unknown>;
  warnings?: string[];
}

interface RenderProps {
  spec: ChartSpec;
  columns: ColumnMeta[];
  rows: (string | number | null)[][];
  showTitle?: boolean;
  showReason?: boolean;
}

function columnIndex(columns: ColumnMeta[], name: string): number {
  return columns.findIndex((c) => c.name === name);
}

function formatFor(col: ColumnMeta | undefined): ValueFormat {
  if (!col) return {};
  return { currency: col.currency, isPercentage: col.is_percentage };
}

function numberAt(row: (string | number | null)[], idx: number): number {
  const raw = row[idx];
  if (typeof raw === "number") return raw;
  if (raw === null || raw === undefined) return NaN;
  // Mirror the backend's tolerant parsing so a currency-formatted cell
  // doesn't silently become NaN on the client.
  const cleaned = String(raw).replace(/[^0-9.\-]/g, "");
  return parseFloat(cleaned);
}

function labelAt(row: (string | number | null)[], idx: number, col?: ColumnMeta): string {
  const raw = row[idx];
  const str = raw === null || raw === undefined ? "" : String(raw);
  if (col?.role === "temporal" && str) {
    return formatDateLabel(str, col.date_granularity);
  }
  return str;
}

export default function ChartRenderer({
  spec,
  columns,
  rows,
  showTitle = true,
  showReason = false,
}: RenderProps) {
  const body = renderBody(spec, columns, rows);

  return (
    <div className="viz-surface">
      {showTitle && <h3 className="viz-title">{spec.title}</h3>}
      {showReason && <p className="viz-subtitle">{spec.reason}</p>}
      {body}
      {spec.warnings && spec.warnings.length > 0 && (
        <p className="viz-note">{spec.warnings.join(" ")}</p>
      )}
    </div>
  );
}

function renderBody(spec: ChartSpec, columns: ColumnMeta[], rows: (string | number | null)[][]) {
  const enc = spec.encoding ?? {};

  switch (spec.chart_type) {
    case "line": {
      const xName = String(enc.x ?? "");
      const yNames = (enc.y as string[]) ?? [];
      const xi = columnIndex(columns, xName);
      if (xi < 0 || yNames.length === 0) return <Fallback />;

      const series: LineSeries[] = [];
      yNames.forEach((yName) => {
        const yi = columnIndex(columns, yName);
        if (yi < 0) return;
        series.push({
          name: yName,
          format: formatFor(columns[yi]),
          points: rows.map((r) => {
            const v = numberAt(r, yi);
            return { label: labelAt(r, xi, columns[xi]), value: isFinite(v) ? v : null };
          }),
        });
      });

      return <LineChart series={series} />;
    }

    case "bar": {
      const dimName = String(enc.dimension ?? "");
      const measureName = String(enc.measure ?? "");
      const di = columnIndex(columns, dimName);
      if (di < 0) return <Fallback />;

      // "__count__" means count rows per category, used when there's no
      // numeric column to aggregate.
      if (measureName === "__count__") {
        const counts = new Map<string, number>();
        rows.forEach((r) => {
          const key = labelAt(r, di, columns[di]);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        });
        const data = [...counts.entries()]
          .map(([label, value]) => ({ label, value }))
          .sort((a, b) => b.value - a.value);
        return <BarChart data={data} />;
      }

      const mi = columnIndex(columns, measureName);
      if (mi < 0) return <Fallback />;
      let data = rows
        .map((r) => ({ label: labelAt(r, di, columns[di]), value: numberAt(r, mi) }))
        .filter((d) => isFinite(d.value));

      if (enc.sort === "desc") data = [...data].sort((a, b) => b.value - a.value);
      if (typeof enc.limit === "number") data = data.slice(0, enc.limit as number);

      return <BarChart data={data} format={formatFor(columns[mi])} />;
    }

    case "pie": {
      const di = columnIndex(columns, String(enc.dimension ?? ""));
      const mi = columnIndex(columns, String(enc.measure ?? ""));
      if (di < 0 || mi < 0) return <Fallback />;
      const data = rows
        .map((r) => ({ label: labelAt(r, di, columns[di]), value: numberAt(r, mi) }))
        .filter((d) => isFinite(d.value) && d.value > 0)
        .sort((a, b) => b.value - a.value);
      return <DonutChart data={data} format={formatFor(columns[mi])} />;
    }

    case "scatter": {
      const xi = columnIndex(columns, String(enc.x ?? ""));
      const yi = columnIndex(columns, String(enc.y ?? ""));
      if (xi < 0 || yi < 0) return <Fallback />;
      const labelIdx = columns.findIndex((c) => c.role === "categorical" || c.role === "temporal");
      const points = rows
        .map((r) => ({
          x: numberAt(r, xi),
          y: numberAt(r, yi),
          label: labelIdx >= 0 ? labelAt(r, labelIdx, columns[labelIdx]) : "",
        }))
        .filter((p) => isFinite(p.x) && isFinite(p.y));
      return (
        <ScatterChart
          points={points}
          xLabel={columns[xi].name}
          yLabel={columns[yi].name}
          xFormat={formatFor(columns[xi])}
          yFormat={formatFor(columns[yi])}
        />
      );
    }

    case "histogram": {
      const mi = columnIndex(columns, String(enc.measure ?? ""));
      if (mi < 0) return <Fallback />;
      const values = rows.map((r) => numberAt(r, mi)).filter((v) => isFinite(v));
      return <Histogram values={values} bins={Number(enc.bins ?? 12)} format={formatFor(columns[mi])} />;
    }

    case "heatmap": {
      const ri = columnIndex(columns, String(enc.row ?? ""));
      const ci = columnIndex(columns, String(enc.column ?? ""));
      const mi = columnIndex(columns, String(enc.measure ?? ""));
      if (ri < 0 || ci < 0 || mi < 0) return <Fallback />;

      const rowLabels: string[] = [];
      const colLabels: string[] = [];
      const cellMap = new Map<string, number>();
      rows.forEach((r) => {
        const rl = labelAt(r, ri, columns[ri]);
        const cl = labelAt(r, ci, columns[ci]);
        if (!rowLabels.includes(rl)) rowLabels.push(rl);
        if (!colLabels.includes(cl)) colLabels.push(cl);
        const v = numberAt(r, mi);
        if (isFinite(v)) cellMap.set(`${rl}||${cl}`, (cellMap.get(`${rl}||${cl}`) ?? 0) + v);
      });
      const matrix = rowLabels.map((rl) =>
        colLabels.map((cl) => cellMap.get(`${rl}||${cl}`) ?? null)
      );
      return <Heatmap rowLabels={rowLabels} columnLabels={colLabels} matrix={matrix} format={formatFor(columns[mi])} />;
    }

    case "map": {
      const gi = columnIndex(columns, String(enc.geo_dimension ?? ""));
      const mi = columnIndex(columns, String(enc.measure ?? ""));
      if (gi < 0 || mi < 0) return <Fallback />;
      const data = rows
        .map((r) => ({ label: labelAt(r, gi, columns[gi]), value: numberAt(r, mi) }))
        .filter((d) => isFinite(d.value))
        .sort((a, b) => b.value - a.value);
      return <RegionalBreakdown data={data} format={formatFor(columns[mi])} />;
    }

    case "stat_cards": {
      const li = columnIndex(columns, String(enc.label ?? ""));
      const vi = columnIndex(columns, String(enc.value ?? ""));
      if (li < 0 || vi < 0) return <Fallback />;
      const data = rows
        .map((r) => ({
          label: labelAt(r, li, columns[li]),
          value: numberAt(r, vi),
          format: formatFor(columns[vi]),
        }))
        .filter((d) => isFinite(d.value));
      return <StatCards data={data} />;
    }

    case "table":
    default: {
      const numericColumns = new Set(
        columns.map((c, i) => (c.role === "measure" ? i : -1)).filter((i) => i >= 0)
      );
      const formats: Record<number, ValueFormat> = {};
      columns.forEach((c, i) => {
        if (c.role === "measure") formats[i] = formatFor(c);
      });
      return (
        <DataTable
          columns={columns.map((c) => c.name)}
          rows={rows}
          numericColumns={numericColumns}
          formats={formats}
        />
      );
    }
  }
}

function Fallback() {
  return <p className="viz-note">This chart's columns aren't present in the current data.</p>;
}
