import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import "./chart-view.css";

interface ChartViewProps {
  chartType: "bar" | "line" | "pie" | "table";
  columns: string[];
  rows: string[][];
  height?: number;
}

const COLORS = ["#f2b705", "#2563eb", "#16a34a", "#dc2626", "#9333ea", "#0891b2", "#ea580c"];

function toChartData(columns: string[], rows: string[][]) {
  const [labelCol, ...seriesCols] = columns;
  return rows.map((row) => {
    const entry: Record<string, string | number> = { [labelCol]: row[0] ?? "" };
    seriesCols.forEach((col, i) => {
      const raw = row[i + 1] ?? "";
      const num = parseFloat(raw.replace(/[^0-9.-]/g, ""));
      entry[col] = isNaN(num) ? raw : num;
    });
    return entry;
  });
}

export default function ChartView({ chartType, columns, rows, height = 280 }: ChartViewProps) {
  if (columns.length === 0 || rows.length === 0) {
    return <p className="chart-empty-note">No data yet.</p>;
  }

  if (chartType === "table") {
    return (
      <div className="chart-table-wrap">
        <table className="chart-table">
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={i}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const data = toChartData(columns, rows);
  const [labelCol, ...seriesCols] = columns;

  if (chartType === "bar") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data}>
          <XAxis dataKey={labelCol} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          {seriesCols.length > 1 && <Legend />}
          {seriesCols.map((col, i) => (
            <Bar key={col} dataKey={col} fill={COLORS[i % COLORS.length]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <XAxis dataKey={labelCol} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          {seriesCols.length > 1 && <Legend />}
          {seriesCols.map((col, i) => (
            <Line key={col} type="monotone" dataKey={col} stroke={COLORS[i % COLORS.length]} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  const valueCol = seriesCols[0];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey={valueCol}
          nameKey={labelCol}
          outerRadius={Math.min(height / 2 - 20, 100)}
          label
          isAnimationActive={false}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
