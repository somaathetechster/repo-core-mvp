import { useState } from "react";
import { type SlideContent } from "./deck/SlideLayouts";
import TemplatedSlide from "./deck/TemplatedSlide";
import SlideFrame from "./deck/SlideFrame";
import { buildPalette, mix, type SlideLayout } from "./deck/design";
import { getTemplate, applyScheme } from "./deck/templates";
import ChartRenderer, { type ColumnMeta } from "./viz/ChartRenderer";
import type { DeckSlide, DeckTheme } from "./api";
import "./designed-slide.css";

interface Props {
  slide: DeckSlide;
  theme: DeckTheme | null;
  companyName?: string;
  logo?: string | null;
  pageNumber?: number;
  totalPages?: number;
  onChange?: (updated: DeckSlide) => void;
  editable?: boolean;
  /** Overrides the automatically chosen layout, when the user picks one. */
  layoutOverride?: SlideLayout | null;
  templateId?: string;
  schemeId?: string;
}

/**
 * Renders a slide using the deck design system, with an editing overlay.
 *
 * Editing happens in a side panel rather than directly on the slide. Typing
 * into the composed slide would either break its layout or force the layout
 * to be loose enough to accommodate arbitrary text, and that looseness is
 * exactly what made the previous deck look like a document.
 */
export default function DesignedSlide({
  slide, theme, companyName, logo, pageNumber, totalPages,
  onChange, editable = false, layoutOverride = null,
  templateId, schemeId,
}: Props) {
  const [editing, setEditing] = useState(false);

  const template = getTemplate(templateId);
  // The scheme sets the base colours, then the founder's brand colours
  // override the accent and ink on top of it.
  const colors = applyScheme(template, schemeId, theme?.primary_color, theme?.secondary_color);
  const base = buildPalette(colors.accent, colors.ink);
  const palette = {
    ...base,
    paper: colors.paper,
    muted: mix(colors.ink, colors.paper, 0.45),
    rule: mix(colors.ink, colors.paper, 0.86),
  };

  const content: SlideContent = {
    id: slide.id,
    type: slide.type,
    title: slide.title,
    blocks: slide.blocks,
    image_data_url: slide.image_data_url,
    team_members: slide.team_members,
    toc_entries: slide.toc_entries,
    chart: slide.chart,
  };

  // Chart slides get a real rendered chart inside the slide composition,
  // using the same visualization system as the Data Studio so a chart looks
  // identical wherever it appears.
  const chartNode = slide.chart ? (
    <ChartRenderer
      spec={{
        chart_type: slide.chart.chart_type,
        title: "",
        reason: "",
        encoding: encodingForChart(slide.chart),
      }}
      columns={columnsForChart(slide.chart)}
      rows={slide.chart.rows}
      showTitle={false}
    />
  ) : null;

  return (
    <div className="dsl">
      <SlideFrame className="dsl-frame">
        <TemplatedSlide
          slide={content}
          template={template}
          palette={palette}
          logo={logo}
          companyName={companyName}
          pageNumber={pageNumber}
          totalPages={totalPages}
          chartNode={chartNode}
          layoutOverride={layoutOverride}
        />
      </SlideFrame>

      {editable && onChange && (
        <div className="dsl-edit">
          <button className="dsl-edit-toggle" onClick={() => setEditing((e) => !e)}>
            {editing ? "Done editing" : "Edit this slide"}
          </button>

          {editing && (
            <div className="dsl-editor">
              <label className="dsl-field">
                <span>Title</span>
                <input
                  className="p-input"
                  value={slide.title}
                  onChange={(e) => onChange({ ...slide, title: e.target.value })}
                />
              </label>

              {slide.blocks.map((b, i) => (
                <label className="dsl-field" key={i}>
                  <span>
                    Text {i + 1}
                    {b.source && <em className="dsl-source">{b.source}</em>}
                  </span>
                  <textarea
                    className="p-input"
                    rows={3}
                    value={b.text}
                    onChange={(e) =>
                      onChange({
                        ...slide,
                        blocks: slide.blocks.map((bb, bi) =>
                          bi === i ? { ...bb, text: e.target.value } : bb
                        ),
                      })
                    }
                  />
                  <button
                    className="dsl-remove"
                    onClick={() =>
                      onChange({ ...slide, blocks: slide.blocks.filter((_, bi) => bi !== i) })
                    }
                  >
                    Remove this text
                  </button>
                </label>
              ))}

              <button
                className="p-btn p-btn-ghost"
                onClick={() =>
                  onChange({
                    ...slide,
                    blocks: [...slide.blocks, { text: "", source: "Added manually" }],
                  })
                }
              >
                + Add text
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Chart slides carry raw columns/rows; derive the encoding the renderer needs. */
function encodingForChart(chart: { chart_type: string; columns: string[] }): Record<string, unknown> {
  const [first, ...rest] = chart.columns;
  switch (chart.chart_type) {
    case "line":
      return { x: first, y: rest.slice(0, 3) };
    case "pie":
      return { dimension: first, measure: rest[0] };
    case "bar":
      return { dimension: first, measure: rest[0], sort: "desc" };
    default:
      return { columns: chart.columns };
  }
}

/** Minimal column metadata for chart slides, inferred from position. */
function columnsForChart(chart: { columns: string[]; rows: string[][] }): ColumnMeta[] {
  return chart.columns.map((name, i) => ({
    name,
    type: i === 0 ? "category" : "decimal",
    role: i === 0 ? "categorical" : "measure",
  }));
}
