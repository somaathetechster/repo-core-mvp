import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CANVAS_W, CANVAS_H, clampFrame, snapDelta,
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

type Box = { left: number; top: number; right: number; bottom: number };

type DragState =
  | { mode: "move"; ids: string[]; startX: number; startY: number; origins: Record<string, Frame> }
  | { mode: "resize"; id: string; handle: string; startX: number; startY: number; origin: Frame }
  | { mode: "resize-group"; handle: string; startX: number; startY: number; box: Box; origins: Record<string, Frame> }
  | null;

type Marquee = { startX: number; startY: number; currentX: number; currentY: number } | null;

// Element types that are NOT edited as inline text. Everything else carries a
// `text` field and drops into contentEditable, so this is the single source of
// truth for "is this a text element" used by the pointer/text tool logic.
const NON_TEXT_TYPES = new Set(["asset", "shape", "rule", "image", "logo", "portrait", "chart", "table"]);
function isTextEl(el: SlideElement): boolean {
  return el.text !== undefined && !NON_TEXT_TYPES.has(el.type);
}

export interface CanvasProps {
  slide: ElementSlide;
  theme: DeckTheme;
  onChange: (slide: ElementSlide, label?: string) => void;
  renderChart?: (el: SlideElement) => ReactNode;
  /** Read-only mode is used for thumbnails and preview. */
  interactive?: boolean;
  /**
   * "pointer": clicks select and drag moves; text is edited only by
   * double-clicking a single selection. "text": clicking a text element drops
   * straight into editing. Defaults to pointer so a group drag never turns
   * into a stray text edit.
   */
  toolMode?: "pointer" | "text";
  /** Asks the parent to switch back to the pointer tool (text tool is
   *  one-shot: after a click on empty canvas or a non-text element it reverts). */
  onRequestPointerMode?: () => void;
  /**
   * Fixed container width in pixels. Passed for thumbnails, where the wrapper
   * may not have a reliable clientWidth when the canvas first mounts, which
   * would otherwise scale the canvas to 0 and render nothing.
   */
  containerWidth?: number;
  margin?: number;
  onSelect?: (id: string | null) => void;
  selectedId?: string | null;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>, activeId: string | null) => void;
  guidesEnabled?: boolean;
}

export default function SlideCanvas({
  slide, theme, onChange, renderChart,
  interactive = true, containerWidth, margin = 80,
  onSelect, selectedId: controlledSelection,
  selectedIds: controlledSelections, onSelectionChange,
  guidesEnabled = true,
  toolMode = "pointer", onRequestPointerMode,
}: CanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [internalSelection, setInternalSelection] = useState<string | null>(null);
  const [internalSelections, setInternalSelections] = useState<Set<string>>(new Set());
  // Which element is currently open for inline text editing. Kept separate
  // from selection: an element can be selected (for dragging) without its text
  // being editable, which is exactly what stops a multi-select drag from
  // landing inside a contentEditable.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const [marquee, setMarquee] = useState<Marquee>(null);
  const [guides, setGuides] = useState<{ axis: "x" | "y"; at: number }[]>([]);
  // The window pointer handlers are created once per drag/marquee session, so
  // reading marquee through a ref keeps the latest value available inside them
  // rather than the value captured when the handler was created.
  const marqueeRef = useRef<Marquee>(marquee);
  useEffect(() => { marqueeRef.current = marquee; }, [marquee]);

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
    if (id) {
      if (additive && next.has(id)) next.delete(id); // shift-click toggles off
      else next.add(id);
    }
    setSelection(next, next.has(id ?? "") ? id : [...next].at(-1) ?? null);
  }, [selectedIds, setSelection]);

  // All element ids in the same group as `id` (itself if ungrouped). Grouped
  // elements select and drag as one unit.
  const groupMembers = useCallback((id: string): string[] => {
    const el = slide.elements.find((e) => e.id === id);
    if (!el?.groupId) return [id];
    return slide.elements.filter((e) => e.groupId === el.groupId).map((e) => e.id);
  }, [slide]);

  const canvasPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale,
    };
  }, [scale]);

  // Switching slides ends any in-progress text edit; the editing id refers to
  // an element that is no longer on screen otherwise.
  useEffect(() => { setEditingId(null); }, [slide.id]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setScale((containerWidth ?? el.clientWidth) / CANVAS_W);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerWidth]);

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
    if (!drag && !marquee) return;

    function onMove(ev: PointerEvent) {
      if (marqueeRef.current) {
        const point = canvasPoint(ev.clientX, ev.clientY);
        setMarquee((prev) => (prev ? { ...prev, currentX: point.x, currentY: point.y } : null));
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
        const boundDelta = (nextDx: number, nextDy: number) => {
          const bounds = drag!.ids.reduce((box, id) => {
            const origin = origins[id];
            return {
              left: Math.min(box.left, origin.x + nextDx),
              top: Math.min(box.top, origin.y + nextDy),
              right: Math.max(box.right, origin.x + nextDx + origin.w),
              bottom: Math.max(box.bottom, origin.y + nextDy + origin.h),
            };
          }, {
            left: Number.POSITIVE_INFINITY,
            top: Number.POSITIVE_INFINITY,
            right: Number.NEGATIVE_INFINITY,
            bottom: Number.NEGATIVE_INFINITY,
          });
          return {
            dx: nextDx + (bounds.left < 0 ? -bounds.left : bounds.right > CANVAS_W ? CANVAS_W - bounds.right : 0),
            dy: nextDy + (bounds.top < 0 ? -bounds.top : bounds.bottom > CANVAS_H ? CANVAS_H - bounds.bottom : 0),
          };
        };
        const bounded = boundDelta(dx, dy);
        const siblings = slide.elements.filter((item) => !drag!.ids.includes(item.id));
        const snapped = guidesEnabled
          ? snapDelta(moved.map(({ id, frame }) => ({ id, frame: { ...frame, x: frame.x - dx + bounded.dx, y: frame.y - dy + bounded.dy } })), siblings, 4)
          : { dx: 0, dy: 0, guides: [] };
        const finalDelta = boundDelta(bounded.dx + snapped.dx, bounded.dy + snapped.dy);
        setGuides(guidesEnabled ? snapped.guides : []);
        onChange({
          ...slide,
          customized: true,
          elements: slide.elements.map((item) => {
            const origin = origins[item.id];
            return origin
              ? { ...item, frame: { ...origin, x: origin.x + finalDelta.dx, y: origin.y + finalDelta.dy } }
              : item;
          }),
        }, `move:${drag!.ids.join(",")}`);
      } else if (drag!.mode === "resize") {
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
      } else {
        // resize-group: scale every member's frame relative to the selection
        // box, so a group (or multi-selection) resizes as one unit.
        const h = drag!.handle;
        const b = drag!.box;
        let left = b.left, top = b.top, right = b.right, bottom = b.bottom;
        if (h.includes("e")) right = b.right + dx;
        if (h.includes("s")) bottom = b.bottom + dy;
        if (h.includes("w")) left = b.left + dx;
        if (h.includes("n")) top = b.top + dy;
        const oldW = b.right - b.left || 1;
        const oldH = b.bottom - b.top || 1;
        const newW = Math.max(40, right - left);
        const newH = Math.max(40, bottom - top);
        const sx = newW / oldW;
        const sy = newH / oldH;
        onChange({
          ...slide,
          customized: true,
          elements: slide.elements.map((item) => {
            const origin = drag!.origins[item.id];
            if (!origin) return item;
            return {
              ...item,
              frame: {
                ...origin,
                x: left + (origin.x - b.left) * sx,
                y: top + (origin.y - b.top) * sy,
                w: Math.max(24, origin.w * sx),
                h: Math.max(20, origin.h * sy),
              },
            };
          }),
        }, "resize-group");
      }
    }

    function onUp() {
      const m = marqueeRef.current;
      if (m) {
        const left = Math.min(m.startX, m.currentX);
        const right = Math.max(m.startX, m.currentX);
        const top = Math.min(m.startY, m.currentY);
        const bottom = Math.max(m.startY, m.currentY);
        const isClick = right - left < 4 && bottom - top < 4;
        if (isClick) {
          select(null);
        } else {
          const hits = slide.elements.filter((el) =>
            !el.locked
            && el.frame.x < right && el.frame.x + el.frame.w > left
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
  }, [drag, marquee, scale, slide, margin, updateElement, onChange, canvasPoint, select, setSelection, guidesEnabled]);

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
        case "Escape": setSelection(new Set(), null); setEditingId(null); return;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interactive, selectedId, selectedIds, slide, onChange, setSelection]);

  // "ink"/"accent" resolve against the theme; "paper" (or unset) uses the
  // deck paper; anything else is a literal colour the user picked for this
  // slide.
  const background =
    slide.background === "ink" ? theme.ink
      : slide.background === "accent" ? theme.accent
        : slide.background && slide.background !== "paper" ? slide.background
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
            setEditingId(null);
            // Clicking empty canvas with the text tool reverts to pointer.
            if (toolMode === "text") onRequestPointerMode?.();
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
                if (target.isContentEditable) return; // typing inside the open editor
                e.stopPropagation();

                // Locked elements are inert on the canvas: no select, no drag,
                // no text edit. They can only be changed from the layers panel.
                if (el.locked) return;

                // Text tool: a click on a text element drops straight into
                // editing (Figma's T behaviour).
                if (toolMode === "text" && isTextEl(el)) {
                  setSelection(new Set([el.id]), el.id);
                  setEditingId(el.id);
                  return; // no drag: the user is about to type
                }
                // Text tool on a non-text element falls back to the pointer.
                if (toolMode === "text") onRequestPointerMode?.();

                // Selection state updates asynchronously, so compute what the
                // selection will be after this click and drive the drag from
                // that rather than from the stale current selectedIds.
                //
                // Grabbing an element that is already part of a multi-selection
                // keeps the whole selection and drags it as a group, instead of
                // collapsing to the one clicked. That is what makes "select
                // several, then drag" actually move all of them.
                const inGroup = selectedIds.has(el.id) && selectedIds.size > 1;
                // Clicking any member of a group selects the whole group, so it
                // drags as one unit.
                const clickedGroup = groupMembers(el.id);
                let nextIds: Set<string>;
                if (e.shiftKey) {
                  nextIds = new Set([...selectedIds, ...clickedGroup]);
                  setSelection(nextIds, el.id);
                } else if (inGroup) {
                  nextIds = new Set(selectedIds); // keep the current selection and drag it
                } else {
                  nextIds = new Set(clickedGroup);
                  setSelection(nextIds, el.id);
                }
                // Selecting a different element ends any in-progress text edit,
                // so a group drag moves rather than editing.
                setEditingId((prev) => (prev === el.id ? prev : null));
                const ids = [...nextIds]
                  .filter((id) => !slide.elements.find((item) => item.id === id)?.locked);
                const origins = Object.fromEntries(
                  slide.elements.filter((item) => ids.includes(item.id)).map((item) => [item.id, item.frame]),
                ) as Record<string, Frame>;
                setDrag({ mode: "move", ids, startX: e.clientX, startY: e.clientY, origins });
              }}
              onDoubleClick={(e) => {
                if (!interactive || el.locked) return;
                e.stopPropagation();
                // Double-click isolates a single element — even one inside a
                // group or multi-selection — so it can be edited on its own.
                setSelection(new Set([el.id]), el.id);
                if (isTextEl(el)) setEditingId(el.id);
              }}
            >
              <div style={{ position: "absolute", inset: 0 }}>
                <ElementView
                  element={{ ...el, frame: { ...el.frame, x: 0, y: 0 } }}
                  theme={theme}
                  renderChart={renderChart}
                  editable={interactive && editingId === el.id}
                  onTextChange={(id, text) => {
                    updateElement(id, { text }, `text:${id}`);
                    // Blur commits the edit and closes the editor.
                    setEditingId((prev) => (prev === id ? null : prev));
                  }}
                />
              </div>

              {el.locked && (
                <span className="cv-lock-badge" aria-hidden="true">🔒</span>
              )}

              {interactive && isSelected && !el.locked && selectedIds.size <= 1 && (
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
          >
            {/* Resize the whole selection/group as one unit. */}
            {interactive && selectedIds.size > 1 && ["nw", "ne", "sw", "se", "n", "s", "e", "w"].map((h) => (
              <span
                key={h}
                className={`cv-handle cv-group-handle cv-handle-${h}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const origins = Object.fromEntries(
                    selectedElements.filter((el) => !el.locked).map((el) => [el.id, el.frame]),
                  ) as Record<string, Frame>;
                  setDrag({
                    mode: "resize-group",
                    handle: h,
                    startX: e.clientX,
                    startY: e.clientY,
                    box: selectionBounds,
                    origins,
                  });
                }}
              />
            ))}
          </div>
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
