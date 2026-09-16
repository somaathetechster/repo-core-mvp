import { useEffect, useState } from "react";
import {
  listRecordTypes,
  listDataRecords,
  createDataRecord,
  updateDataRecord,
  deleteDataRecord,
  listDecks,
  getDeck,
  saveDeckEditorState,
  type RecordType,
  type DataRecord,
} from "./api";
import ChartView from "./ChartView";
import "./theme.css";
import "./data-studio.css";

const CHART_TYPES: { key: DataRecord["chart_type"]; label: string }[] = [
  { key: "table", label: "Table" },
  { key: "bar", label: "Bar chart" },
  { key: "line", label: "Line chart" },
  { key: "pie", label: "Pie chart" },
];

function emptyDraft(columns: string[]): Pick<DataRecord, "columns" | "rows"> {
  return { columns, rows: [columns.map(() => "")] };
}

export default function DataStudio() {
  const [recordTypes, setRecordTypes] = useState<RecordType[]>([]);
  const [records, setRecords] = useState<DataRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string>("competitive_analysis");
  const [title, setTitle] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [chartType, setChartType] = useState<DataRecord["chart_type"]>("table");
  const [importText, setImportText] = useState("");
  const [importFormat, setImportFormat] = useState<"csv" | "json">("csv");
  const [saving, setSaving] = useState(false);
  const [addingToDeckId, setAddingToDeckId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detectedSections, setDetectedSections] = useState<
    { title: string; columns: string[]; rows: string[][] }[] | null
  >(null);

  useEffect(() => {
    Promise.all([listRecordTypes(), listDataRecords()])
      .then(([types, recs]) => {
        setRecordTypes(types);
        setRecords(recs);
        const initial = types.find((t) => t.key === "competitive_analysis") ?? types[0];
        if (initial) {
          setSelectedType(initial.key);
          const draft = emptyDraft(initial.default_columns);
          setColumns(draft.columns);
          setRows(draft.rows);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load Data Studio."))
      .finally(() => setLoading(false));
  }, []);

  function startNew(typeKey: string) {
    const type = recordTypes.find((t) => t.key === typeKey);
    if (!type) return;
    setEditingId(null);
    setSelectedType(typeKey);
    setTitle("");
    const draft = emptyDraft(type.default_columns);
    setColumns(draft.columns);
    setRows(draft.rows);
    setChartType("table");
    setImportText("");
  }

  function startEdit(record: DataRecord) {
    setEditingId(record.id);
    setSelectedType(record.record_type);
    setTitle(record.title);
    setColumns(record.columns);
    setRows(record.rows);
    setChartType(record.chart_type);
  }

  function updateCell(rowIndex: number, colIndex: number, value: string) {
    setRows((r) => r.map((row, ri) => (ri === rowIndex ? row.map((c, ci) => (ci === colIndex ? value : c)) : row)));
  }

  function addRow() {
    setRows((r) => [...r, columns.map(() => "")]);
  }

  function removeRow(index: number) {
    setRows((r) => r.filter((_, i) => i !== index));
  }

  function updateColumnName(index: number, name: string) {
    setColumns((c) => c.map((col, i) => (i === index ? name : col)));
  }

  function addColumn() {
    setColumns((c) => [...c, `Column ${c.length + 1}`]);
    setRows((r) => r.map((row) => [...row, ""]));
  }

  function removeColumn(index: number) {
    setColumns((c) => c.filter((_, i) => i !== index));
    setRows((r) => r.map((row) => row.filter((_, i) => i !== index)));
  }

  function clearTable() {
    const hasContent = rows.some((row) => row.some((cell) => cell.trim()));
    if (hasContent && !window.confirm("Clear every row in this table? The columns stay as they are.")) return;
    setRows([columns.map(() => "")]);
    setNotice("Table cleared.");
    setTimeout(() => setNotice(null), 2000);
  }

  function parseCsvLine(line: string): string[] {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells.map((c) => c.replace(/^"|"$/g, ""));
  }

  function detectSections(rawText: string): { title: string; columns: string[]; rows: string[][] }[] {
    const cleaned = rawText.replace(/\r/g, "");
    const lines = cleaned.split("\n");
    const sections: { title: string; columns: string[]; rows: string[][] }[] = [];
    let current: { title: string; columns: string[]; rows: string[][] } | null = null;

    function isTitleLine(idx: number): boolean {
      const cells = parseCsvLine(lines[idx]);
      if (cells.length !== 1) return false;
      let j = idx + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j >= lines.length) return false;
      return parseCsvLine(lines[j]).length > 1;
    }

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") {
        i++;
        continue;
      }
      if (isTitleLine(i)) {
        const title = parseCsvLine(line)[0];
        i++;
        while (i < lines.length && lines[i].trim() === "") i++;
        const header = parseCsvLine(lines[i]);
        current = { title, columns: header, rows: [] };
        sections.push(current);
        i++;
      } else if (current === null) {
        const header = parseCsvLine(line);
        current = { title: `Section ${sections.length + 1}`, columns: header, rows: [] };
        sections.push(current);
        i++;
      } else {
        current.rows.push(parseCsvLine(line));
        i++;
      }
    }
    return sections;
  }

  function applySection(section: { title: string; columns: string[]; rows: string[][] }) {
    if (section.columns.length > 30) {
      setError(
        `"${section.title}" parsed into ${section.columns.length} columns, which almost certainly means this isn't comma-separated data. Check the format, or try JSON instead.`
      );
      setDetectedSections(null);
      return;
    }
    setColumns(section.columns);
    setRows(section.rows.length > 0 ? section.rows : [section.columns.map(() => "")]);
    if (!title) setTitle(section.title);
    setDetectedSections(null);
    setImportText("");
    setNotice(`Imported "${section.title}": ${section.rows.length} row${section.rows.length === 1 ? "" : "s"}.`);
    setTimeout(() => setNotice(null), 3000);
  }

  function handleImport() {
    setError(null);
    try {
      if (importFormat === "csv") {
        const trimmedInput = importText.trim();
        if (trimmedInput.startsWith("[") || trimmedInput.startsWith("{")) {
          setError('This looks like JSON, not CSV. Switch the format dropdown to "JSON" above and try again.');
          return;
        }

        const sections = detectSections(importText);

        if (sections.length === 0) {
          setError("Couldn't find any table in that paste.");
          return;
        }

        if (sections.length > 1) {
          setDetectedSections(sections);
          return;
        }

        applySection(sections[0]);
      } else {
        const parsed = JSON.parse(importText);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          setError("JSON import expects a non-empty array of objects.");
          return;
        }
        const parsedColumns = Object.keys(parsed[0]);
        const parsedRows = parsed.map((obj: Record<string, unknown>) =>
          parsedColumns.map((c) => String(obj[c] ?? ""))
        );
        setColumns(parsedColumns);
        setRows(parsedRows);
        setImportText("");
        setNotice(`Imported ${parsedRows.length} row${parsedRows.length === 1 ? "" : "s"}.`);
        setTimeout(() => setNotice(null), 3000);
      }
    } catch {
      setError("Couldn't parse that import. Check the format and try again.");
    }
  }

  async function handleSaveRecord() {
    setSaving(true);
    setError(null);
    try {
      const payload = { record_type: selectedType, title, columns, rows, chart_type: chartType };
      if (editingId) {
        await updateDataRecord(editingId, payload);
      } else {
        await createDataRecord(payload);
      }
      const refreshed = await listDataRecords();
      setRecords(refreshed);
      setEditingId(null);
      setNotice("Saved.");
      setTimeout(() => setNotice(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save this record.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this data record?")) return;
    try {
      await deleteDataRecord(id);
      setRecords((r) => r.filter((rec) => rec.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete this record.");
    }
  }

  async function handleAddToDeck(record: DataRecord) {
    setAddingToDeckId(record.id);
    setError(null);
    try {
      const decks = await listDecks();
      if (decks.length === 0) {
        setError("Create a deck first (in the Deck tab), then come back to add this chart to it.");
        return;
      }
      // With multiple decks, ask which one this chart goes into rather than
      // guessing. A simple prompt is a pragmatic placeholder for a proper
      // picker UI, which the Deck tab's own modal already provides for
      // deck creation, this just needs a lighter-weight equivalent here.
      const options = decks.map((d, i) => `${i + 1}. ${d.name}`).join("\n");
      const choice = window.prompt(`Add "${record.title || "this chart"}" to which deck?\n${options}\n\nEnter a number:`);
      const index = choice ? parseInt(choice, 10) - 1 : -1;
      if (index < 0 || index >= decks.length) return;

      const target = await getDeck(decks[index].id);
      const chartSlide = {
        id: `chart-${record.id}`,
        type: "chart" as const,
        title: record.title || "Chart",
        blocks: [],
        image_data_url: null,
        team_members: null,
        toc_entries: null,
        chart: { chart_type: record.chart_type, columns: record.columns, rows: record.rows },
      };
      const withoutDuplicate = target.slides.filter((s) => s.id !== chartSlide.id);
      await saveDeckEditorState(target.id, {
        slides: [...withoutDuplicate, chartSlide],
        theme: target.theme,
        layouts: target.layouts,
        freeform_slide_ids: target.freeform_slide_ids,
      });
      setNotice(`Added to "${target.name}". Open the Deck tab to see it.`);
      setTimeout(() => setNotice(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add this to your deck.");
    } finally {
      setAddingToDeckId(null);
    }
  }

  if (loading) return <p className="data-studio-loading">Loading Data Studio...</p>;

  return (
    <div className="data-studio">
      <h1 className="dash-title">Data Studio</h1>
      <p className="dash-subtitle">
        Build a table, import a CSV or JSON, preview it as a chart, and add it to your deck.
      </p>

      {error && <p className="p-error">{error}</p>}
      {notice && <p className="data-studio-notice">{notice}</p>}

      <div className="data-studio-layout">
        <div className="data-studio-editor">
          <div className="data-studio-type-row">
            <select
              className="p-input"
              value={selectedType}
              onChange={(e) => startNew(e.target.value)}
              disabled={!!editingId}
            >
              {recordTypes.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <input
              className="p-input"
              type="text"
              placeholder="Title (e.g. Q4 competitor comparison)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="data-studio-import">
            <div className="data-studio-import-controls">
              <select
                className="p-input data-studio-import-format"
                value={importFormat}
                onChange={(e) => setImportFormat(e.target.value as "csv" | "json")}
              >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
              <textarea
                className="p-input"
                rows={2}
                placeholder={
                  importFormat === "csv"
                    ? "Paste CSV, first row as headers"
                    : 'Paste a JSON array, e.g. [{"Label":"A","Value":10}]'
                }
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <button className="p-btn p-btn-secondary" onClick={handleImport} disabled={!importText.trim()}>
                Import
              </button>
            </div>

            {detectedSections && (
              <div className="data-studio-section-picker">
                <p className="data-studio-section-hint">
                  Found {detectedSections.length} tables in that paste. Choose one to import:
                </p>
                <div className="data-studio-section-list">
                  {detectedSections.map((s, i) => (
                    <button key={i} className="data-studio-section-item" onClick={() => applySection(s)}>
                      <strong>{s.title}</strong>
                      <span>
                        {s.columns.length} columns, {s.rows.length} row{s.rows.length === 1 ? "" : "s"}
                      </span>
                    </button>
                  ))}
                </div>
                <button className="p-btn p-btn-ghost" onClick={() => setDetectedSections(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>

          <div className="data-studio-table-wrap">
            <table className="data-studio-table">
              <thead>
                <tr>
                  {columns.map((col, ci) => (
                    <th key={ci}>
                      <input
                        className="data-studio-col-input"
                        value={col}
                        onChange={(e) => updateColumnName(ci, e.target.value)}
                      />
                      {columns.length > 1 && (
                        <button className="data-studio-col-remove" onClick={() => removeColumn(ci)}>
                          x
                        </button>
                      )}
                    </th>
                  ))}
                  <th>
                    <button className="p-btn p-btn-ghost" onClick={addColumn}>
                      + Col
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci}>
                        <input
                          className="data-studio-cell-input"
                          value={cell}
                          onChange={(e) => updateCell(ri, ci, e.target.value)}
                        />
                      </td>
                    ))}
                    <td>
                      <button className="data-studio-row-remove" onClick={() => removeRow(ri)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="data-studio-table-actions">
              <button className="p-btn p-btn-ghost" onClick={addRow}>
                + Add row
              </button>
              <button
                className="p-btn p-btn-ghost data-studio-clear-table"
                onClick={clearTable}
                disabled={rows.length === 0}
              >
                Clear table
              </button>
            </div>
          </div>

          <div className="data-studio-chart-type-row">
            <span>Display as:</span>
            {CHART_TYPES.map((ct) => (
              <button
                key={ct.key}
                className={`data-studio-chart-btn ${chartType === ct.key ? "data-studio-chart-btn-active" : ""}`}
                onClick={() => setChartType(ct.key)}
              >
                {ct.label}
              </button>
            ))}
          </div>

          <button className="p-btn p-btn-primary" onClick={handleSaveRecord} disabled={saving}>
            {saving ? "Saving..." : editingId ? "Update record" : "Save record"}
          </button>
        </div>

        <div className="data-studio-preview">
          <h3>Preview</h3>
          <div className="data-studio-preview-box">
            <ChartView chartType={chartType} columns={columns} rows={rows} height={260} />
          </div>
        </div>
      </div>

      <div className="data-studio-saved">
        <h2>Saved records</h2>
        {records.length === 0 && <p className="data-studio-empty">No records yet.</p>}
        <div className="data-studio-saved-grid">
          {records.map((r) => (
            <div className="data-studio-saved-card" key={r.id}>
              <div className="data-studio-saved-card-header">
                <strong>{r.title || "Untitled"}</strong>
                <span className="data-studio-saved-type">
                  {recordTypes.find((t) => t.key === r.record_type)?.label ?? r.record_type}
                </span>
              </div>
              <div className="data-studio-saved-preview">
                <ChartView chartType={r.chart_type} columns={r.columns} rows={r.rows} height={140} />
              </div>
              <div className="data-studio-saved-actions">
                <button className="p-btn p-btn-ghost" onClick={() => startEdit(r)}>
                  Edit
                </button>
                <button
                  className="p-btn p-btn-secondary"
                  onClick={() => handleAddToDeck(r)}
                  disabled={addingToDeckId === r.id}
                >
                  {addingToDeckId === r.id ? "Adding..." : "Add to deck"}
                </button>
                <button className="p-btn p-btn-ghost data-studio-delete" onClick={() => handleDelete(r.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
