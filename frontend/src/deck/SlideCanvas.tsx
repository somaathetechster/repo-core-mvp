import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CANVAS_W, CANVAS_H, clampFrame,
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
  | { mode: "move"; ids: string[]; startX: number; startY: number; origins: Record<string, Frame> }
  | { mode: "resize"; id: string; handle: string; startX: number; startY: number; origin: Frame }
  | null;

type Marquee = { startX: number; startY: number; currentX: number; currentY: number } | null;

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
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>, activeId: string | null) => void;
}

export default function SlideCanvas({
  slide, theme, onChange, renderChart,
  interactive = true, margin = 80,
  onSelect, selectedId: controlledSelection,
  selectedIds: controlledSelections, onSelectionChange,
}: CanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [internalSelection, setInternalSelection] = useState<string | null>(null);
  const [internalSelections, setInternalSelections] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState>(null);
  const [marquee, setMarquee] = useState<Marquee>(null);
  const [guides, setGuides] = useState<{ axis: "x" | "y"; at: number }[]>([]);

  const selectedId = controlledSelection !== undefined ? controlledSelection : internalSelection;
  const selectedIds = controlledSelections ?? internalSelections;
  const setSelection = useCallback((ids: Set<string>, activeId: string | null) => {
    if (onSelectionChange) onSelectionChange(ids, activeId);
    else {
      setInternalSelections(ids);
      setInternalSelection(activeId);
      onSelect?.(activeId);
    }
  }, [onSelect, onSelectionChange]);
  const select = useCallback((id: string | null, additive = false) => {
    const next = additive ? new Set(selectedIds) : new Set<string>();
    if (id) next.add(id);
    setSelection(next, id);
  }, [selectedIds, setSelection]);

  const canvasPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale,
    };
  }, [scale]);

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
      if (marquee) {
        const point = canvasPoint(ev.clientX, ev.clientY);
        setMarquee({ ...marquee, currentX: point.x, currentY: point.y });
        return;
      }
      const dx = (ev.clientX - drag!.startX) / scale;
      const dy = (ev.clientY - drag!.startY) / scale;

      if (drag!.mode === "move") {
        const origins = drag!.origins;
        const moved = drag!.ids.map((id) => {
          const origin = origins[id];
          return { id, frame: { ...origin, x: origin.x + dx, y: origin.y + dy } };
        });
        const bounds = moved.reduce((box, item) => ({
          left: Math.min(box.left, item.frame.x),
          top: Math.min(box.top, item.frame.y),
          right: Math.max(box.right, item.frame.x + item.frame.w),
          bottom: Math.max(box.bottom, item.frame.y + item.frame.h),
        }), {
          left: Number.POSITIVE_INFINITY,
          top: Number.POSITIVE_INFINITY,
          right: Number.NEGATIVE_INFINITY,
          bottom: Number.NEGATIVE_INFINITY,
        });
        const boundedDx = dx + (bounds.left < 0 ? -bounds.left : bounds.right > CANVAS_W ? CANVAS_W - bounds.right : 0);
        const boundedDy = dy + (bounds.top < 0 ? -bounds.top : bounds.bottom > CANVAS_H ? CANVAS_H - bounds.bottom : 0);
        onChange({
          ...slide,
          customized: true,
          elements: slide.elements.map((item) => {
            const origin = origins[item.id];
            return origin
              ? { ...item, frame: { ...origin, x: origin.x + boundedDx, y: origin.y + boundedDy } }
              : item;
          }),
        }, `move:${drag!.ids.join(",")}`);
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
      if (marquee) {
        const left = Math.min(marquee.startX, marquee.currentX);
        const right = Math.max(marquee.startX, marquee.currentX);
        const top = Math.min(marquee.startY, marquee.currentY);
        const bottom = Math.max(marquee.startY, marquee.currentY);
        const isClick = right - left < 4 && bottom - top < 4;
        if (isClick) {
          select(null);
        } else {
          const hits = slide.elements.filter((el) =>
            el.frame.x < right && el.frame.x + el.frame.w > left
            && el.frame.y < bottom && el.frame.y + el.frame.h > top,
          ).map((el) => el.id);
          setSelection(new Set(hits), hits[hits.length - 1] ?? null);
        }
        setMarquee(null);
        return;
      }
      setDrag(null);
      setGuides([]);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, marquee, scale, slide, margin, updateElement, onChange, canvasPoint, select, setSelection]);

  // Keyboard nudging: arrow keys move by 1px, shift by 10. Precise
  // positioning by dragging alone is genuinely hard at small scales.
  useEffect(() => {
    if (!interactive || !selectedIds.size) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      const ids = [...selectedIds];
      const activeId = selectedId && selectedIds.has(selectedId) ? selectedId : ids[ids.length - 1];
      if (!activeId) return;
      const step = e.shiftKey ? 10 : 1;
      let handled = true;
      switch (e.key) {
        case "ArrowLeft":
        case "ArrowRight":
        case "ArrowUp":
        case "ArrowDown": {
          const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
          onChange({
            ...slide,
            customized: true,
            elements: slide.elements.map((item) => selectedIds.has(item.id)
              ? { ...item, frame: clampFrame({ ...item.frame, x: item.frame.x + dx, y: item.frame.y + dy }) }
              : item),
          }, `nudge:${ids.join(",")}`);
          break;
        }
        case "Delete":
        case "Backspace":
          onChange({ ...slide, customized: true, elements: slide.elements.filter((x) => !selectedIds.has(x.id)) }, "delete-selection");
          setSelection(new Set(), null);
          return;
        case "Escape": setSelection(new Set(), null); return;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interactive, selectedId, selectedIds, slide, onChange, setSelection]);

  const background =
    slide.background === "ink" ? theme.ink
      : slide.background === "accent" ? theme.accent
        : theme.paper;

  const sorted = [...slide.elements].sort((a, b) => (a.frame.z ?? 10) - (b.frame.z ?? 10));
  const selectedElements = slide.elements.filter((el) => selectedIds.has(el.id));
  const selectionBounds = selectedElements.length ? selectedElements.reduce((bounds, el) => ({
    left: Math.min(bounds.left, el.frame.x),
    top: Math.min(bounds.top, el.frame.y),
    right: Math.max(bounds.right, el.frame.x + el.frame.w),
    bottom: Math.max(bounds.bottom, el.frame.y + el.frame.h),
  }), {
    left: selectedElements[0].frame.x,
    top: selectedElements[0].frame.y,
    right: selectedElements[0].frame.x + selectedElements[0].frame.w,
    bottom: selectedElements[0].frame.y + selectedElements[0].frame.h,
  }) : null;

  return (
    <div ref={wrapRef} className="cv-wrap" style={{ height: CANVAS_H * scale }}>
      <div
        ref={canvasRef}
        className="cv-canvas"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: `scale(${scale})`, transformOrigin: "top left",
          background,
        }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget && interactive) {
            const point = canvasPoint(e.clientX, e.clientY);
            setMarquee({ startX: point.x, startY: point.y, currentX: point.x, currentY: point.y });
          }
        }}
      >
        {sorted.map((el) => {
          const isSelected = selectedIds.has(el.id);
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
                select(el.id, e.shiftKey);
                if (el.locked) return;
                const ids = (selectedIds.has(el.id) ? [...selectedIds] : [el.id])
                  .filter((id) => !slide.elements.find((item) => item.id === id)?.locked);
                const origins = Object.fromEntries(
                  slide.elements.filter((item) => ids.includes(item.id)).map((item) => [item.id, item.frame]),
                ) as Record<string, Frame>;
                setDrag({ mode: "move", ids, startX: e.clientX, startY: e.clientY, origins });
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

        {selectionBounds && (
          <div
            className="cv-selection-box"
            style={{
              left: selectionBounds.left,
              top: selectionBounds.top,
              width: selectionBounds.right - selectionBounds.left,
              height: selectionBounds.bottom - selectionBounds.top,
            }}
          />
        )}

        {marquee && (
          <div
            className="cv-marquee"
            style={{
              left: Math.min(marquee.startX, marquee.currentX),
              top: Math.min(marquee.startY, marquee.currentY),
              width: Math.abs(marquee.currentX - marquee.startX),
              height: Math.abs(marquee.currentY - marquee.startY),
            }}
          />
        )}

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
