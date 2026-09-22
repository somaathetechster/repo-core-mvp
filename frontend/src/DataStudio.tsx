import { useRef, useState } from "react";
import {
  ingestText, ingestFile, profileTable, transformTable,
  type DetectedTable, type ProfileResponse, type ChartSpecDTO,
  type SuggestedTransform,
} from "./api";
import ChartRenderer, { type ColumnMeta } from "./viz/ChartRenderer";
import PlacementPicker, { type Placement } from "./PlacementPicker";
import { stashChartForDeck } from "./DeckEditor";
import "./theme.css";
import "./data-studio.css";

type Stage = "input" | "choose_table" | "workspace";

export default function DataStudio() {
  const [stage, setStage] = useState<Stage>("input");
  const [pasteText, setPasteText] = useState("");
  const [detected, setDetected] = useState<DetectedTable[]>([]);
  const [table, setTable] = useState<{ title: string; columns: string[]; rows: (string | number | null)[][] } | null>(null);
  const [analysis, setAnalysis] = useState<ProfileResponse | null>(null);
  const [activeChart, setActiveChart] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAllColumns, setShowAllColumns] = useState(false);
  const [placing, setPlacing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function flash(message: string) {
    setNotice(message);
    setTimeout(() => setNotice(null), 3500);
  }

  async function handleTables(tables: DetectedTable[]) {
    if (tables.length === 1) {
      await loadTable(tables[0]);
    } else {
      setDetected(tables);
      setStage("choose_table");
    }
  }

  async function handlePaste() {
    setBusy("Reading your data");
    setError(null);
    try {
      const { tables } = await ingestText(pasteText);
      await handleTables(tables);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that data.");
    } finally {
      setBusy(null);
    }
  }

  async function handleFile(file: File) {
    setBusy(`Reading ${file.name}`);
    setError(null);
    try {
      const { tables } = await ingestFile(file);
      await handleTables(tables);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setBusy(null);
    }
  }

  async function loadTable(t: DetectedTable) {
    setBusy("Working out what this data is");
    setError(null);
    try {
      const result = await profileTable(t.title, t.columns, t.rows);
      setTable({ title: t.title, columns: t.columns, rows: t.rows });
      setAnalysis(result);
      setActiveChart(0);
      setHistory([`Imported ${t.row_count} rows from ${t.source}.`]);
      setStage("workspace");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not analyse that table.");
    } finally {
      setBusy(null);
    }
  }

  async function applyTransform(op: string, params: Record<string, unknown>, label: string) {
    if (!table) return;
    setBusy("Reshaping");
    setError(null);
    try {
      const res = await transformTable(op, table.columns, table.rows, params, table.title);
      setTable({ title: table.title, columns: res.result.columns, rows: res.result.rows });
      setAnalysis({
        profile: res.profile,
        charts: res.charts,
        suggested_transforms: res.suggested_transforms,
      });
      setActiveChart(0);
      setHistory((h) => [...h, res.result.description]);
      flash(label);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply that.");
    } finally {
      setBusy(null);
    }
  }

  async function applyPlacement(placement: Placement) {
    if (!table || !analysis) return;
    const spec = analysis.charts.recommendations[activeChart];
    setPlacing(false);
    setError(null);

    const chart = {
      chart_type: (["bar", "line", "pie"].includes(spec.chart_type)
        ? spec.chart_type
        : "table") as "bar" | "line" | "pie" | "table",
      columns: table.columns,
      rows: table.rows.map((r) => r.map((c) => (c === null ? "" : String(c)))),
    };

    // Hand the chart to the deck editor rather than writing it straight
    // into the deck. Position is a design decision, and the editor is where
    // the founder can actually see the slide and drag it into place.
    stashChartForDeck({ chart, title: spec.title, note: placement.note });
    flash(`Ready to place in "${placement.deck.name}". Opening the deck…`);
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("provisio:open-deck", { detail: { deckId: placement.deck.id } }),
      );
    }, 500);
  }

  function reset() {
    setStage("input");
    setPasteText("");
    setDetected([]);
    setTable(null);
    setAnalysis(null);
    setHistory([]);
    setError(null);
  }

  /* ---------------- input stage ---------------- */

  if (stage === "input") {
    return (
      <div className="data-studio">
        <div className="data-studio-header">
          <div>
            <div className="data-studio-title">Data Studio</div>
            <div className="data-studio-desc">
              Bring in a spreadsheet, export, or report. Provisio works out what each column is
              and shows you the charts that actually fit the data.
            </div>
          </div>
        </div>
        <div className="data-studio-body">
          <div className="data-studio-main" style={{ maxWidth: "700px" }}>
            {error && <p className="data-error">{error}</p>}
            {busy  && <p className="data-busy">⏳ {busy}…</p>}

            {/* Drop zone */}
            <div
              className="data-drop"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) handleFile(f);
              }}
            >
              <div className="data-drop-icon">📂</div>
              <div className="data-drop-title">Drop a file, or click to choose</div>
              <div className="data-drop-sub">Excel, CSV, PDF, JSON — up to 15MB.</div>
              <button className="data-upload-btn" type="button" onClick={e => { e.stopPropagation(); fileInput.current?.click(); }}>
                Choose file
              </button>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,.json,.xlsx,.xlsm,.pdf"
              hidden
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />

            {/* Paste */}
            <span className="data-paste-label">or paste it</span>
            <div className="data-paste">
              <textarea
                rows={6}
                placeholder={"Paste a table, CSV, or JSON here.\nSeveral tables in one paste is fine — you'll pick which one to use."}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
            </div>
            <div style={{ marginTop: "0.75rem" }}>
              <button
                className="p-btn p-btn-primary"
                onClick={handlePaste}
                disabled={!pasteText.trim() || !!busy}
              >
                {busy ?? "Read this data"}
              </button>
            </div>
          </div>

          {/* Side tips */}
          <aside className="data-studio-side">
            <div className="data-side-label">What you can bring in</div>
            {[
              { icon: "📊", label: "Excel / CSV", desc: "Any spreadsheet — we detect the structure" },
              { icon: "📄", label: "PDF tables", desc: "Reports and exports with embedded tables" },
              { icon: "📋", label: "Paste", desc: "Copy a table straight from Notion, Sheets, or a browser" },
              { icon: "🗂", label: "JSON", desc: "Arrays of objects, API exports, raw data" },
            ].map((t, i) => (
              <div key={i} style={{ display:"flex", gap:".75rem", marginBottom:".85rem", alignItems:"flex-start" }}>
                <span style={{ fontSize:"1.1rem", lineHeight:1 }}>{t.icon}</span>
                <div>
                  <div style={{ fontSize:".82rem", fontWeight:500, marginBottom:".15rem" }}>{t.label}</div>
                  <div style={{ fontSize:".74rem", color:"var(--text-muted)", lineHeight:1.4 }}>{t.desc}</div>
                </div>
              </div>
            ))}
            <div className="data-side-hint" style={{ marginTop:"1.25rem", paddingTop:"1rem", borderTop:"1px solid var(--ink-border)" }}>
              Once loaded, Provisio analyses every column and suggests the charts that show your data best. Then push any chart straight to your pitch deck.
            </div>
          </aside>
        </div>
      </div>
    );
  }

  /* ---------------- table picker ---------------- */

  if (stage === "choose_table") {
    return (
      <div className="data-studio">
        <div className="data-studio-header">
          <div className="data-studio-title">{detected.length} tables found</div>
          <div className="data-studio-desc">Pick the one to work with. You can come back for the others.</div>
        </div>
        <div className="data-studio-body">
          {error && <p className="p-error">{error}</p>}
          <div className="ds-table-options">
            {detected.map((t, i) => (
              <button key={i} className="ds-table-option" onClick={() => loadTable(t)} disabled={!!busy}>
                <span className="ds-option-title">{t.title}</span>
                <span className="ds-option-meta">
                  {t.row_count} rows, {t.column_count} columns, from {t.source}
                </span>
                <span className="ds-option-cols">{t.columns.slice(0, 6).join(" · ")}</span>
                {t.notes.length > 0 && <span className="ds-option-note">{t.notes.join(" ")}</span>}
              </button>
            ))}
          </div>
          <button className="p-btn p-btn-ghost" onClick={reset}>Start over</button>
        </div>
      </div>
    );
  }

  /* ---------------- workspace ---------------- */

  if (!table || !analysis) return null;

  const { profile, charts, suggested_transforms } = analysis;
  const columnMeta: ColumnMeta[] = profile.columns.map((c) => ({
    name: c.name,
    type: c.type,
    role: c.role,
    currency: c.currency,
    is_percentage: c.is_percentage,
    date_granularity: c.date_granularity,
  }));
  const spec: ChartSpecDTO | undefined = charts.recommendations[activeChart];
  const visibleColumns = showAllColumns ? profile.columns : profile.columns.slice(0, 6);

  return (
    <div className="data-studio">
      <div className="data-studio-header">
        <div>
          <div className="data-studio-title">{profile.title}</div>
          <div className="data-studio-desc">{profile.row_count.toLocaleString()} rows · {profile.columns.length} columns</div>
        </div>
        <div style={{display:"flex",gap:".5rem"}}>
          <button className="p-btn p-btn-secondary" onClick={() => setPlacing(true)} disabled={!!busy}>Add to deck</button>
          <button className="p-btn p-btn-ghost" onClick={reset}>New import</button>
        </div>
      </div>
      <div className="data-studio-body">

      {error && <p className="p-error">{error}</p>}
      {notice && <p className="ds-notice">{notice}</p>}
      {busy && <p className="ds-busy">{busy}…</p>}

      {placing && spec && (
        <PlacementPicker
          itemTitle={spec.title}
          onConfirm={applyPlacement}
          onCancel={() => setPlacing(false)}
        />
      )}

      <div className="ds-grid">
        <main className="data-studio-main">
          {spec ? (
            <>
              <div className="data-chart-tabs">
                {charts.recommendations.slice(0, 6).map((r, i) => (
                  <button
                    key={`${r.chart_type}-${i}`}
                    className={`ds-chart-tab ${i === activeChart ? "is-active" : ""}`}
                    onClick={() => setActiveChart(i)}
                  >
                    {r.title}
                  </button>
                ))}
              </div>
              <ChartRenderer spec={spec} columns={columnMeta} rows={table.rows} showReason />
            </>
          ) : (
            <p className="ds-empty">No chart could be built from this table.</p>
          )}

          {charts.rejections.length > 0 && (
            <section className="ds-panel ds-rejections">
              <h3>Charts that would mislead here</h3>
              {charts.rejections.map((r, i) => (
                <p key={i}>
                  <strong>{r.chart_type}</strong> {r.reason}
                </p>
              ))}
            </section>
          )}
        </main>

        <aside className="ds-side">
          <section className="ds-panel">
            <h3>What each column is</h3>
            <div className="ds-columns">
              {visibleColumns.map((c) => (
                <div className="ds-column" key={c.name}>
                  <div className="ds-column-head">
                    <span className="ds-column-name">{c.name}</span>
                    <span className={`ds-role ds-role-${c.role}`}>{c.role}</span>
                  </div>
                  <span className="ds-column-detail">
                    {c.type}
                    {c.currency ? ` · ${c.currency}` : ""}
                    {c.date_granularity ? ` · by ${c.date_granularity}` : ""}
                    {c.role === "measure" && c.min !== null
                      ? ` · ${c.min.toLocaleString()} to ${c.max?.toLocaleString()}`
                      : ""}
                    {c.role === "categorical" ? ` · ${c.unique_count} values` : ""}
                  </span>
                  {c.issues.map((issue, i) => (
                    <span className="ds-column-issue" key={i}>{issue}</span>
                  ))}
                </div>
              ))}
            </div>
            {profile.columns.length > 6 && (
              <button className="ds-link" onClick={() => setShowAllColumns((s) => !s)}>
                {showAllColumns ? "Show fewer" : `Show all ${profile.columns.length} columns`}
              </button>
            )}
            {profile.issues.length > 0 && (
              <div className="ds-issues">
                {profile.issues.map((i, idx) => <p key={idx}>{i}</p>)}
              </div>
            )}
          </section>

          {suggested_transforms.length > 0 && (
            <section className="ds-panel">
              <h3>Reshape this data</h3>
              {suggested_transforms.map((t: SuggestedTransform, i) => (
                <button
                  key={i}
                  className="ds-transform"
                  onClick={() => applyTransform(t.op, t.params, t.label)}
                  disabled={!!busy}
                >
                  <span className="ds-transform-label">{t.label}</span>
                  <span className="ds-transform-reason">{t.reason}</span>
                </button>
              ))}
            </section>
          )}

          {history.length > 1 && (
            <section className="ds-panel">
              <h3>What's been done</h3>
              <ol className="ds-history">
                {history.map((h, i) => <li key={i}>{h}</li>)}
              </ol>
            </section>
          )}
        </aside>
        </div>
      </div>
    </div>
  );
}