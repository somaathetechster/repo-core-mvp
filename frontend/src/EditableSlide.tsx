import { useState } from "react";
import type { DeckSlide, DeckTheme } from "./api";
import ChartView from "./ChartView";

interface EditableSlideProps {
  slide: DeckSlide;
  theme: DeckTheme | null;
  onChange: (updated: DeckSlide) => void;
}

export default function EditableSlide({ slide, theme, onChange }: EditableSlideProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingBlockIndex, setEditingBlockIndex] = useState<number | null>(null);

  const style: React.CSSProperties & Record<string, string> = {} as React.CSSProperties & Record<string, string>;
  if (theme?.primary_color) style["--slide-accent"] = theme.primary_color;
  if (theme?.secondary_color) style["--slide-text"] = theme.secondary_color;
  const fontClass = theme?.font_style ? `deck-font-${theme.font_style}` : "deck-font-serif";

  function updateTitle(newTitle: string) {
    onChange({ ...slide, title: newTitle });
  }

  function updateBlockText(index: number, text: string) {
    const blocks = slide.blocks.map((b, i) => (i === index ? { ...b, text } : b));
    onChange({ ...slide, blocks });
  }

  function removeBlock(index: number) {
    onChange({ ...slide, blocks: slide.blocks.filter((_, i) => i !== index) });
  }

  const titleField = editingTitle ? (
    <input
      className="deck-edit-title-input"
      autoFocus
      value={slide.title}
      onChange={(e) => updateTitle(e.target.value)}
      onBlur={() => setEditingTitle(false)}
      onKeyDown={(e) => e.key === "Enter" && setEditingTitle(false)}
    />
  ) : (
    <div className="deck-slide-label deck-editable" onClick={() => setEditingTitle(true)} title="Click to edit">
      {slide.title}
    </div>
  );

  if (slide.type === "cover") {
    return (
      <div className={`deck-slide deck-slide-cover ${fontClass}`} style={style}>
        {slide.image_data_url && <img className="deck-cover-logo" src={slide.image_data_url} alt="Logo" />}
        {editingTitle ? (
          <input
            className="deck-edit-title-input deck-edit-cover-title"
            autoFocus
            value={slide.title}
            onChange={(e) => updateTitle(e.target.value)}
            onBlur={() => setEditingTitle(false)}
            onKeyDown={(e) => e.key === "Enter" && setEditingTitle(false)}
          />
        ) : (
          <h1 className="deck-editable" onClick={() => setEditingTitle(true)} title="Click to edit">
            {slide.title}
          </h1>
        )}
        {slide.blocks.map((b, i) => (
          <EditableParagraph
            key={i}
            className="deck-cover-subtitle"
            text={b.text}
            editing={editingBlockIndex === i}
            onStartEdit={() => setEditingBlockIndex(i)}
            onStopEdit={() => setEditingBlockIndex(null)}
            onChange={(text) => updateBlockText(i, text)}
          />
        ))}
      </div>
    );
  }

  if (slide.type === "chart" && slide.chart) {
    return (
      <div className={`deck-slide ${fontClass}`} style={style}>
        {titleField}
        <div className="deck-chart-wrap">
          <ChartView chartType={slide.chart.chart_type} columns={slide.chart.columns} rows={slide.chart.rows} height={300} />
        </div>
        <p className="deck-chart-note">Edit this chart's data in the Data Studio tab.</p>
      </div>
    );
  }

  if (slide.type === "team" || slide.type === "toc" || slide.type === "image") {
    // Team, table of contents, and pure-image slides aren't text-edited
    // inline for now; only their title is. Reordering/removal still works
    // via the sidebar.
    return (
      <div className={`deck-slide ${fontClass}`} style={style}>
        {titleField}
        {slide.type === "team" && (
          <div className="deck-team-grid">
            {(slide.team_members ?? []).map((m, i) => (
              <div className="deck-team-member" key={i}>
                {m.photo_data_url ? (
                  <img src={m.photo_data_url} alt={m.name} />
                ) : (
                  <div className="deck-team-photo-placeholder" />
                )}
                <strong>{m.name}</strong>
                <span className="deck-team-role">{m.role}</span>
                <p>{m.bio}</p>
              </div>
            ))}
          </div>
        )}
        {slide.type === "toc" && (
          <ol className="deck-toc-list">
            {(slide.toc_entries ?? []).map((entry, i) => (
              <li key={i}>
                <span className="deck-toc-item-static">{entry.title}</span>
              </li>
            ))}
          </ol>
        )}
        {slide.type === "image" && slide.image_data_url && <img src={slide.image_data_url} alt={slide.title} />}
      </div>
    );
  }

  // type === "text"
  return (
    <div className={`deck-slide ${fontClass}`} style={style}>
      {titleField}
      {slide.image_data_url && <img className="deck-text-slide-image" src={slide.image_data_url} alt={slide.title} />}
      {slide.blocks.map((b, i) => (
        <div className="deck-editable-block" key={i}>
          <EditableParagraph
            className="deck-text-block"
            text={b.text}
            editing={editingBlockIndex === i}
            onStartEdit={() => setEditingBlockIndex(i)}
            onStopEdit={() => setEditingBlockIndex(null)}
            onChange={(text) => updateBlockText(i, text)}
          />
          <div className="deck-block-footer">
            <span className="deck-block-source">{b.source}</span>
            <button className="deck-block-remove" onClick={() => removeBlock(i)} title="Remove this text">
              Remove
            </button>
          </div>
        </div>
      ))}
      {slide.blocks.length === 0 && <p className="deck-empty-note">All text removed from this slide.</p>}
    </div>
  );
}

function EditableParagraph({
  text,
  className,
  editing,
  onStartEdit,
  onStopEdit,
  onChange,
}: {
  text: string;
  className: string;
  editing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onChange: (text: string) => void;
}) {
  if (editing) {
    return (
      <textarea
        className={`${className} deck-edit-textarea`}
        autoFocus
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onStopEdit}
      />
    );
  }
  return (
    <p className={`${className} deck-editable`} onClick={onStartEdit} title="Click to edit">
      {text}
    </p>
  );
}
