import { useState, type CSSProperties, type ReactNode } from "react";
import { defaultComparisonTable } from "./elements";
import type { SlideElement, ElementStyle, TableCell, TableData, TableCellIcon } from "./elements";
import type { DeckTheme } from "./theme";
import { treatmentFilter, objectPosition, type ImageTreatment } from "./images";
import { ASSETS, assetToSvg } from "./assets";

/**
 * Renders a single element.
 *
 * Style values are named roles ("accent", "display") rather than literal
 * colours and fonts, so changing the theme repaints every element on every
 * slide without touching element data. That indirection is what makes a
 * live theme editor possible at all.
 */

export function resolveColor(token: string | undefined, theme: DeckTheme, fallback = "ink"): string {
  const key = token ?? fallback;
  switch (key) {
    case "ink": return theme.ink;
    case "paper": return theme.paper;
    case "accent": return theme.accent;
    case "muted": return theme.muted;
    case "inverse": return theme.inverse;
    case "accentSoft": return theme.accentSoft;
    case "rule": return theme.rule;
    case "none": return "transparent";
    default: return key; // a literal colour, when the user has overridden
  }
}

export function resolveFont(token: string | undefined, theme: DeckTheme): string {
  switch (token) {
    case "display": return theme.fonts.display;
    case "label": return theme.fonts.label;
    default: return theme.fonts.body;
  }
}

export function elementStyleToCss(el: SlideElement, theme: DeckTheme): CSSProperties {
  const s: ElementStyle = el.style ?? {};
  const css: CSSProperties = {
    position: "absolute",
    left: el.frame.x,
    top: el.frame.y,
    width: el.frame.w,
    height: el.frame.h,
    zIndex: el.frame.z ?? 10,
    opacity: el.opacity ?? s.opacity ?? 1,
    display: el.hidden ? "none" : undefined,
    boxSizing: "border-box",
  };

  if (el.frame.rotation) css.transform = `rotate(${el.frame.rotation}deg)`;

  if (s.background && s.background !== "none") {
    css.background = resolveColor(s.background, theme, "paper");
  }
  if (s.borderRadius) css.borderRadius = s.borderRadius;
  if (s.padding) css.padding = s.padding;
  if (s.borderLeft) {
    css.borderLeft = `${s.borderLeft}px solid ${resolveColor(s.borderColor ?? "accent", theme)}`;
    css.paddingLeft = (s.padding ?? 0) + 12;
  }
  if (s.borderTop) {
    css.borderTop = `${s.borderTop}px solid ${resolveColor(s.borderColor ?? "rule", theme)}`;
    css.paddingTop = s.padding ?? 8;
  }

  // Text-bearing elements
  if (["text", "heading", "eyebrow", "statement", "caption", "list", "quote", "metric", "pageNumber"].includes(el.type)) {
    css.color = resolveColor(s.color, theme);
    css.fontFamily = resolveFont(s.fontFamily, theme);
    css.fontSize = s.fontSize ?? 18;
    css.fontWeight = s.fontWeight ?? 400;
    css.lineHeight = s.lineHeight ?? 1.5;
    css.letterSpacing = s.letterSpacing;
    css.textAlign = s.align ?? "left";
    css.whiteSpace = "pre-wrap";
    css.overflowWrap = "break-word";
    // Clip text to its frame so a block that wraps taller than its fixed
    // height can't bleed over the rule or row beneath it. Covers every
    // text-bearing type: text, heading, eyebrow, statement, caption, list,
    // quote, metric, pageNumber.
    css.overflow = "hidden";
    if (s.verticalAlign) {
      css.display = "flex";
      css.flexDirection = "column";
      css.justifyContent =
        s.verticalAlign === "middle" ? "center" : s.verticalAlign === "bottom" ? "flex-end" : "flex-start";
    }
  }

  return css;
}

/**
 * Migrate a comparison-table's stored data to the current TableData shape.
 *
 * Decks saved before the table rebuild hold the old shape
 * ({ headers: string[], rows: { label, values }[] }); the renderer now
 * expects rows: TableCell[][]. Converting on read keeps those decks from
 * crashing with "e.map is not a function" without a backend migration.
 */
export function normalizeTableData(table: unknown): TableData {
  if (!table) return defaultComparisonTable();
  const t = table as { rows?: unknown[]; headers?: unknown };

  // Already the new shape: rows is an array of arrays (TableCell[][]).
  if (Array.isArray(t.rows) && t.rows.length > 0 && Array.isArray(t.rows[0])) {
    return table as TableData;
  }

  // Old shape → new. Build a header row from `headers`, then a row per
  // old row: a label cell followed by one cell per value, mapping the
  // yes/no sentinels to icons.
  const headers: string[] = Array.isArray(t.headers) ? (t.headers as string[]) : [];
  const oldRows = Array.isArray(t.rows) ? (t.rows as { label?: string; values?: string[] }[]) : [];

  const headerRow: TableCell[] = [
    { content: "", isHeader: true },
    ...headers.map((h) => ({ content: h, isHeader: true })),
  ];

  const dataRows: TableCell[][] = oldRows.map((row) => [
    { content: row.label ?? "" },
    ...(row.values ?? []).map((v: string) => ({
      content: v === "yes" || v === "no" || v === "partial" ? "" : (v ?? ""),
      icon: (v === "yes" || v === "no" ? (v as TableCellIcon) : undefined),
    })),
  ]);

  return { rows: [headerRow, ...dataRows] };
}

export interface ElementRenderProps {
  element: SlideElement;
  theme: DeckTheme;
  /** Charts are rendered by the caller, which owns the charting system. */
  renderChart?: (el: SlideElement) => ReactNode;
  /** In the editor, text is editable in place. */
  editable?: boolean;
  onTextChange?: (id: string, text: string) => void;
  /** Structured element update (used by the table's in-canvas cell editing).
   *  Its presence is what enables table editing on the canvas. */
  onElementChange?: (id: string, patch: Partial<SlideElement>) => void;
  /** Table cell selected in the editor panel, highlighted on the canvas. */
  selectedCell?: { row: number; col: number } | null;
  /** Reports which table cell the user clicked, to sync the editor panel. */
  onCellSelect?: (row: number, col: number) => void;
}

export default function ElementView({
  element, theme, renderChart, editable, onTextChange,
  onElementChange, selectedCell, onCellSelect,
}: ElementRenderProps) {
  const css = elementStyleToCss(element, theme);
  const s = element.style ?? {};
  // Which table cell is open for inline editing (contentEditable). Local to
  // this element; a table that isn't being edited keeps this null.
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);

  switch (element.type) {
    case "asset": {
      // Assets are SVG coloured from the theme at render time, so a shape
      // dropped on a slide recolours with the deck instead of staying
      // whatever colour it was drawn in.
      const asset = ASSETS.find((a) => a.id === s.assetId);
      if (!asset) return null;
      const colour = resolveColor(s.color ?? "accent", theme, "accent");
      return (
        <div
          style={{ ...css, display: "flex", alignItems: "center", justifyContent: "center" }}
          dangerouslySetInnerHTML={{
            __html: assetToSvg(asset, colour, s.assetStyle ?? asset.defaultStyle ?? "solid"),
          }}
        />
      );
    }

    case "shape":
    case "rule":
      return (
        <div
          style={{
            ...css,
            background: resolveColor(s.background ?? "accent", theme),
            borderRadius: s.shape === "circle" ? "50%" : s.borderRadius ?? 0,
          }}
        />
      );

    case "image":
    case "logo":
    case "portrait": {
      if (!element.src) {
        // A placeholder that still occupies the right frame, so a missing
        // photo doesn't collapse the composition.
        return (
          <div style={{
            ...css,
            background: theme.accentSoft,
            display: element.hidden ? "none" : "flex", alignItems: "center", justifyContent: "center",
            color: theme.muted, fontFamily: theme.fonts.display,
            fontSize: Math.min(element.frame.h * 0.3, 34),
            borderRadius: s.borderRadius ?? 0,
          }}>
            {element.type === "portrait" && element.text
              ? element.text.split(" ").map((p) => p[0]).slice(0, 2).join("")
              : ""}
          </div>
        );
      }
      // Crop is presentation-only: focal point and zoom are applied here
      // rather than baked into the data, so they stay adjustable.
      const crop = { focusX: s.focusX ?? 0.5, focusY: s.focusY ?? 0.5, zoom: s.zoom ?? 1 };
      const filter = s.filter ?? treatmentFilter(s.treatment as ImageTreatment | undefined);
      const zoomed = crop.zoom !== 1;
      const img = (
        <img
          src={element.src}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: s.objectFit ?? "cover",
            objectPosition: objectPosition(crop),
            filter,
            transform: zoomed ? `scale(${crop.zoom})` : undefined,
            transformOrigin: `${crop.focusX * 100}% ${crop.focusY * 100}%`,
            display: "block",
          }}
        />
      );
      // Zoom needs a clipping wrapper, otherwise the scaled image bleeds
      // past its frame and over neighbouring elements.
      return (
        <div style={{ ...css, display: element.hidden ? "none" : undefined, overflow: "hidden", borderRadius: s.borderRadius ?? 0 }}>
          {img}
        </div>
      );
    }

    case "chart":
      return (
        <div style={{ ...css, overflow: "hidden" }}>
          {renderChart ? renderChart(element) : null}
        </div>
      );

    case "comparison-table": {
      // Migrate old-shape data up front so every .map() below is safe.
      const table: TableData = normalizeTableData(element.table);
      const rows = table.rows ?? [];
      // No rows means a ghost element; render nothing rather than an empty,
      // selectable box floating on the slide.
      if (!rows.length) return null;
      // In-canvas editing is enabled only when a structured-update callback is
      // supplied (i.e. on the editable canvas, not thumbnails/preview).
      const canEdit = !!onElementChange;
      const cellBorder = "1px solid rgba(0,0,0,0.15)";

      const commitCell = (r: number, c: number, patch: Partial<TableCell>) => {
        if (!onElementChange) return;
        const nextRows = rows.map((row, ri) =>
          ri === r ? row.map((cell, ci) => (ci === c ? { ...cell, ...patch } : cell)) : row,
        );
        onElementChange(element.id, { table: { ...table, rows: nextRows } });
      };

      const iconFor = (cell: TableCell) =>
        cell.icon === "yes" ? <span style={{ color: theme.accent, fontWeight: 700, fontSize: 16 }}>✓</span>
          : cell.icon === "no" ? <span style={{ color: theme.muted, fontSize: 16 }}>✗</span>
            : null;

      return (
        <div style={{ ...css, overflow: "hidden", background: "transparent" }}>
          <table
            style={{
              width: "100%",
              height: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed",
              fontFamily: theme.fonts.body,
            }}
          >
            {table.colWidths && table.colWidths.length
              ? <colgroup>{table.colWidths.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
              : null}
            <tbody>
              {rows.map((row, r) => (
                // Alternating tint on even rows; header cells paint their own
                // accent background on top of it.
                <tr key={r} style={{ background: r % 2 === 0 ? "rgba(0,0,0,0.03)" : "transparent" }}>
                  {row.map((cell, c) => {
                    const isHeader = !!cell.isHeader;
                    const isEditing = canEdit && editingCell?.row === r && editingCell?.col === c;
                    const isSelected = !!selectedCell && selectedCell.row === r && selectedCell.col === c;
                    const align = cell.align ?? (isHeader ? "center" : "left");
                    const icon = iconFor(cell);
                    const cellStyle: CSSProperties = {
                      border: isEditing
                        ? `1.5px solid ${theme.accent}`
                        : isSelected
                          ? `1.5px solid ${theme.accentSoft}`
                          : cellBorder,
                      padding: "4px 8px",
                      background: isHeader ? theme.accent : undefined,
                      color: isHeader ? theme.inverse : theme.ink,
                      fontWeight: cell.bold || isHeader ? 700 : 400,
                      // Per-cell size when set; otherwise the header/body default.
                      fontSize: cell.fontSize ?? (isHeader ? 12 : 14),
                      textAlign: align,
                      verticalAlign: "middle",
                      cursor: canEdit ? "text" : "default",
                    };
                    return (
                      <td
                        key={c}
                        style={cellStyle}
                        onClick={canEdit ? (e) => {
                          e.stopPropagation();
                          onCellSelect?.(r, c);
                          // A click while already editing moves the edit to the
                          // clicked cell rather than deselecting.
                          setEditingCell((prev) => (prev ? { row: r, col: c } : prev));
                        } : undefined}
                        onDoubleClick={canEdit ? (e) => {
                          e.stopPropagation();
                          onCellSelect?.(r, c);
                          setEditingCell({ row: r, col: c });
                        } : undefined}
                      >
                        {isEditing ? (
                          <div
                            contentEditable
                            suppressContentEditableWarning
                            // Focus and place the caret at the end once, when
                            // editing begins; the guard stops a refocus loop.
                            ref={(node) => {
                              if (node && document.activeElement !== node) {
                                node.focus();
                                const sel = window.getSelection();
                                if (sel) { sel.selectAllChildren(node); sel.collapseToEnd(); }
                              }
                            }}
                            style={{ outline: "none", minHeight: "1em", textAlign: align }}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              // Enter commits; Shift+Enter inserts a newline.
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                (e.currentTarget as HTMLDivElement).blur();
                              }
                            }}
                            onBlur={(e) => {
                              commitCell(r, c, { content: e.currentTarget.textContent ?? "" });
                              setEditingCell((prev) => (prev?.row === r && prev?.col === c ? null : prev));
                            }}
                          >
                            {cell.content}
                          </div>
                        ) : icon && cell.content ? (
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 6,
                            justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
                          }}>
                            {icon}<span>{cell.content}</span>
                          </span>
                        ) : icon ? icon : cell.content}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    default: {
      if (editable && onTextChange) {
        return (
          <div
            style={{ ...css, outline: "none", cursor: "text" }}
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => onTextChange(element.id, e.currentTarget.textContent ?? "")}
          >
            {element.text}
          </div>
        );
      }
      return <div style={css}>{element.text}</div>;
    }
  }
}
