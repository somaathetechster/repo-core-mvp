import { useState } from "react";
import { Rnd } from "react-rnd";
import type { DeckSlide, DeckTheme } from "./api";
import { STAGE_WIDTH, STAGE_HEIGHT, type LayoutElement } from "./layoutTypes";
import "./freeform.css";

interface FreeformCanvasProps {
  slide: DeckSlide;
  layout: LayoutElement[];
  theme: DeckTheme | null;
  onLayoutChange: (layout: LayoutElement[]) => void;
  onSlideChange: (updated: DeckSlide) => void;
}

export default function FreeformCanvas({
  slide,
  layout,
  theme,
  onLayoutChange,
  onSlideChange,
}: FreeformCanvasProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);

  const style: React.CSSProperties & Record<string, string> = {} as React.CSSProperties & Record<string, string>;
  if (theme?.primary_color) style["--slide-accent"] = theme.primary_color;
  if (theme?.secondary_color) style["--slide-text"] = theme.secondary_color;
  const fontClass = theme?.font_style ? `deck-font-${theme.font_style}` : "deck-font-serif";

  function updateElement(id: string, patch: Partial<LayoutElement>) {
    onLayoutChange(layout.map((el) => (el.id === id ? { ...el, ...patch } : el)));
  }

  function updateTitleText(text: string) {
    onSlideChange({ ...slide, title: text });
  }

  function updateBlockText(refIndex: number, text: string) {
    const blocks = slide.blocks.map((b, i) => (i === refIndex ? { ...b, text } : b));
    onSlideChange({ ...slide, blocks });
  }

  return (
    <div className="freeform-wrapper">
      <div className="freeform-zoom-controls">
        <button className="p-btn p-btn-ghost" onClick={() => setScale((s) => Math.max(0.4, s - 0.1))}>
          -
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button className="p-btn p-btn-ghost" onClick={() => setScale((s) => Math.min(1.5, s + 0.1))}>
          +
        </button>
      </div>

      <div
        className="freeform-stage-outer"
        style={{ width: STAGE_WIDTH * scale, height: STAGE_HEIGHT * scale }}
      >
        <div
          className={`freeform-stage ${fontClass}`}
          style={{
            ...style,
            width: STAGE_WIDTH,
            height: STAGE_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          {layout.map((el) => (
            <Rnd
              key={el.id}
              size={{ width: el.width, height: el.height }}
              position={{ x: el.x, y: el.y }}
              bounds="parent"
              onDragStop={(_e, d) => updateElement(el.id, { x: d.x, y: d.y })}
              onResizeStop={(_e, _dir, ref, _delta, pos) =>
                updateElement(el.id, {
                  width: parseInt(ref.style.width, 10),
                  height: parseInt(ref.style.height, 10),
                  x: pos.x,
                  y: pos.y,
                })
              }
              className="freeform-element"
            >
              <ElementContent
                el={el}
                slide={slide}
                editing={editingId === el.id}
                onStartEdit={() => setEditingId(el.id)}
                onStopEdit={() => setEditingId(null)}
                onTitleChange={updateTitleText}
                onBlockChange={updateBlockText}
              />
            </Rnd>
          ))}
        </div>
      </div>
    </div>
  );
}

function ElementContent({
  el,
  slide,
  editing,
  onStartEdit,
  onStopEdit,
  onTitleChange,
  onBlockChange,
}: {
  el: LayoutElement;
  slide: DeckSlide;
  editing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onTitleChange: (text: string) => void;
  onBlockChange: (refIndex: number, text: string) => void;
}) {
  if (el.kind === "image") {
    return slide.image_data_url ? (
      <img className="freeform-image" src={slide.image_data_url} alt="" draggable={false} />
    ) : (
      <div className="freeform-image-placeholder">No image</div>
    );
  }

  if (el.kind === "title") {
    return editing ? (
      <textarea
        className="freeform-text-input freeform-title-input"
        autoFocus
        value={slide.title}
        onChange={(e) => onTitleChange(e.target.value)}
        onBlur={onStopEdit}
      />
    ) : (
      <div className="freeform-title-text" onDoubleClick={onStartEdit} title="Double-click to edit">
        {slide.title}
      </div>
    );
  }

  // kind === "block"
  const text = el.refIndex !== undefined ? slide.blocks[el.refIndex]?.text ?? "" : "";
  return editing ? (
    <textarea
      className="freeform-text-input"
      autoFocus
      value={text}
      onChange={(e) => el.refIndex !== undefined && onBlockChange(el.refIndex, e.target.value)}
      onBlur={onStopEdit}
    />
  ) : (
    <div className="freeform-block-text" onDoubleClick={onStartEdit} title="Double-click to edit">
      {text}
    </div>
  );
}
