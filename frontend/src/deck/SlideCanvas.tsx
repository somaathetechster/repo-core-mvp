import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CANVAS_W, CANVAS_H, clampFrame, snapFrame,
  type SlideElement, type ElementSlide, type Frame,
} from "./elements";
import ElementView from "./ElementView";
import type { DeckTheme } from "./theme";
import "./canvas.css";

/**
 * The editable slide canvas.
 *
 * Every element is draggable and resizable, and text is editable in place.
 * Snapping is not a nicety here: hand-positioned elements that are two
 * pixels off alignment are exactly what makes a deck look homemade, so
 * frames snap to the margin, the canvas centre, and to sibling edges, with
 * guides drawn while dragging.
 *
 * The canvas is a fixed 1280x720 scaled to fit, so a slide composed here is
 * identical at any zoom and in export.
 */

type DragState =
  | { mode: "move"; id: string; startX: number; startY: number; origin: Frame }
  | { mode: "resize"; id: string; handle: string; startX: number; startY: number; origin: Frame }
  | null;

export interface CanvasProps {
  slide: ElementSlide;
  theme: DeckTheme;
  onChange: (slide: ElementSlide, label?: string) => void;
  renderChart?: (el: SlideElement) => ReactNode;
  /** Read-only mode is used for thumbnails and preview. */
  interactive?: boolean;
  margin?: number;
  onSelect?: (id: string | null) => void;
  selectedId?: string | null;
}

export default function SlideCanvas({
  slide, theme, onChange, renderChart,
  interactive = true, margin = 80,
  onSelect, selectedId: controlledSelection,
}: CanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [internalSelection, setInternalSelection] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const [guides, setGuides] = useState<{ axis: "x" | "y"; at: number }[]>([]);

  const selectedId = controlledSelection !== undefined ? controlledSelection : internalSelection;
  const select = useCallback((id: string | null) => {
    if (onSelect) onSelect(id);
    else setInternalSelection(id);
  }, [onSelect]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / CANVAS_W);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const updateElement = useCallback((id: string, patch: Partial<SlideElement>, label = "edit") => {
    onChange({
      ...slide,
      customized: true,
      elements: slide.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }, label);
  }, [slide, onChange]);

  // Pointer maths runs in canvas space, so a drag feels 1:1 regardless of
  // how the canvas is currently scaled to fit its container.
  useEffect(() => {
    if (!drag) return;

    function onMove(ev: PointerEvent) {
      const dx = (ev.clientX - drag!.startX) / scale;
      const dy = (ev.clientY - drag!.startY) / scale;
      const siblings = slide.elements.filter((e) => e.id !== drag!.id);

      if (drag!.mode === "move") {
        const moved = { ...drag!.origin, x: drag!.origin.x + dx, y: drag!.origin.y + dy };
        const snapped = snapFrame(clampFrame(moved), siblings, margin);
        setGuides(snapped.guides);
        updateElement(drag!.id, { frame: snapped.frame }, `move:${drag!.id}`);
      } else {
        const h = drag!.handle;
        let { x, y, w, hgt } = {
          x: drag!.origin.x, y: drag!.origin.y,
          w: drag!.origin.w, hgt: drag!.origin.h,
        };
        if (h.includes("e")) w = drag!.origin.w + dx;
        if (h.includes("s")) hgt = drag!.origin.h + dy;
        if (h.includes("w")) { x = drag!.origin.x + dx; w = drag!.origin.w - dx; }
        if (h.includes("n")) { y = drag!.origin.y + dy; hgt = drag!.origin.h - dy; }
        updateElement(drag!.id, { frame: clampFrame({ ...drag!.origin, x, y, w, h: hgt }) }, `resize:${drag!.id}`);
      }
    }

    function onUp() {
      setDrag(null);
      setGuides([]);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, scale, slide.elements, margin, updateElement]);

  // Keyboard nudging: arrow keys move by 1px, shift by 10. Precise
  // positioning by dragging alone is genuinely hard at small scales.
  useEffect(() => {
    if (!interactive || !selectedId) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      const activeId = selectedId;
      if (!activeId) return;
      const el = slide.elements.find((x) => x.id === activeId);
      if (!el) return;
      const step = e.shiftKey ? 10 : 1;
      let handled = true;
      const f = { ...el.frame };
      switch (e.key) {
        case "ArrowLeft": f.x -= step; break;
        case "ArrowRight": f.x += step; break;
        case "ArrowUp": f.y -= step; break;
        case "ArrowDown": f.y += step; break;
        case "Delete":
        case "Backspace":
          onChange({ ...slide, customized: true, elements: slide.elements.filter((x) => x.id !== activeId) });
          select(null);
          return;
        case "Escape": select(null); return;
        default: handled = false;
      }
      if (handled) {
        e.preventDefault();
        updateElement(activeId, { frame: clampFrame(f) }, `nudge:${activeId}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interactive, selectedId, slide, updateElement, onChange, select]);

  const background =
    slide.background === "ink" ? theme.ink
      : slide.background === "accent" ? theme.accent
        : theme.paper;

  const sorted = [...slide.elements].sort((a, b) => (a.frame.z ?? 10) - (b.frame.z ?? 10));

  return (
    <div ref={wrapRef} className="cv-wrap" style={{ height: CANVAS_H * scale }}>
      <div
        className="cv-canvas"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: `scale(${scale})`, transformOrigin: "top left",
          background,
        }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) select(null);
        }}
      >
        {sorted.map((el) => {
          const isSelected = selectedId === el.id;
          return (
            <div
              key={el.id}
              className={`cv-el ${isSelected ? "is-selected" : ""} ${el.locked ? "is-locked" : ""}`}
              style={{
                position: "absolute",
                left: el.frame.x, top: el.frame.y,
                width: el.frame.w, height: el.frame.h,
                zIndex: el.frame.z ?? 10,
              }}
              onPointerDown={(e) => {
                if (!interactive) return;
                const target = e.target as HTMLElement;
                if (target.isContentEditable) return;
                e.stopPropagation();
                select(el.id);
                if (el.locked) return;
                setDrag({ mode: "move", id: el.id, startX: e.clientX, startY: e.clientY, origin: el.frame });
              }}
            >
              <div style={{ position: "absolute", inset: 0 }}>
                <ElementView
                  element={{ ...el, frame: { ...el.frame, x: 0, y: 0 } }}
                  theme={theme}
                  renderChart={renderChart}
                  editable={interactive && isSelected}
                  onTextChange={(id, text) => updateElement(id, { text }, `text:${id}`)}
                />
              </div>

              {interactive && isSelected && !el.locked && (
                <>
                  {["nw", "ne", "sw", "se", "n", "s", "e", "w"].map((h) => (
                    <span
                      key={h}
                      className={`cv-handle cv-handle-${h}`}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setDrag({ mode: "resize", id: el.id, handle: h, startX: e.clientX, startY: e.clientY, origin: el.frame });
                      }}
                    />
                  ))}
                </>
              )}
            </div>
          );
        })}

        {guides.map((g, i) => (
          <div
            key={i}
            className="cv-guide"
            style={
              g.axis === "x"
                ? { left: g.at, top: 0, width: 1, height: CANVAS_H }
                : { top: g.at, left: 0, height: 1, width: CANVAS_W }
            }
          />
        ))}
      </div>
    </div>
  );
}
