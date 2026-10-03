import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import SlideCanvas from "./deck/SlideCanvas";
import { blankSlide } from "./deck/migrate";
import { resolveColor } from "./deck/ElementView";
import { searchLibrary, instantiate, LIBRARY_INDUSTRIES, normaliseIndustry, type LibraryItem } from "./deck/library";
import {
  buildTheme, loadFontPairing, contrastRatio, FONT_PAIRINGS,
  type ThemeSettings,
} from "./deck/theme";
import {
  CANVAS_W, CANVAS_H, makeElement,
  type ElementSlide, type SlideElement,
} from "./deck/elements";
import { elementId } from "./deck/elements";
import { COMPOSERS } from "./deck/composers";
import { planVariants, type LayoutVariant } from "./deck/variants";
import ImageLibrary from "./ImageLibrary";
import { DEFAULT_CROP, type BrandImage } from "./deck/images";
import { ASSET_CATEGORIES, searchAssets, assetToSvg, type AssetCategory } from "./deck/assets";
import WordCount from "./WordCount";
import "./deck-studio.css";

const SCHEME_PRESETS: { id: string; name: string; ink: string; paper: string; accent: string }[] = [
  { id: "ink-gold", name: "Ink and gold", ink: "#161412", paper: "#faf8f3", accent: "#b8860b" },
  { id: "graphite", name: "Graphite", ink: "#1c1c1e", paper: "#f5f5f7", accent: "#5b6470" },
  { id: "pine", name: "Pine", ink: "#12211d", paper: "#f4f7f4", accent: "#2d6a4f" },
  { id: "oxblood", name: "Oxblood", ink: "#1a1214", paper: "#faf6f5", accent: "#8c2f39" },
  { id: "cobalt", name: "Cobalt", ink: "#0f1621", paper: "#f4f7fb", accent: "#1d4ed8" },
  { id: "sand", name: "Sand", ink: "#2b2519", paper: "#f7f2e7", accent: "#b07d3a" },
  { id: "mono", name: "Monochrome", ink: "#0a0a0a", paper: "#ffffff", accent: "#0a0a0a" },
  { id: "signal", name: "Signal", ink: "#0d0d0d", paper: "#fafafa", accent: "#d64933" },
];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const BG_PRESETS: { label: string; value: string }[] = [
  { label: "Cream", value: "#F8F5EE" },
  { label: "White", value: "#FFFFFF" },
  { label: "Near-black", value: "#12100E" },
  { label: "Slate", value: "#1C2533" },
  { label: "Forest", value: "#1B2E22" },
  { label: "Burgundy", value: "#2A1218" },
];
const LAYOUT_VARIANTS: LayoutVariant[] = [
  "statement", "lead-and-points", "numbered-rows", "grid", "split-image",
  "image-led", "metric-hero", "two-column", "quote", "data",
];

function HexColorControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const safeValue = HEX_COLOR.test(value) ? value : "#000000";
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  return (
    <span className="dst-hex-control">
      <input type="color" value={safeValue} onChange={(e) => { setDraft(e.target.value); onChange(e.target.value); }} />
      <input
        className="p-input"
        value={draft}
        maxLength={7}
        aria-label="Hex colour"
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          if (HEX_COLOR.test(next)) onChange(next);
        }}
      />
    </span>
  );
}

type Panel = "template" | "theme" | "library" | "assets" | "images" | "layers" | "element";

export interface DeckStudioProps {
  slides: ElementSlide[];
  current: number;
  themeSettings: ThemeSettings;
  templateId: string;
  industry?: string | null;
  images?: BrandImage[];
  onImagesChange?: (images: BrandImage[]) => void;
  onSlidesChange: (slides: ElementSlide[], label?: string) => void;
  onThemeChange: (settings: ThemeSettings) => void;
  onTemplateChange: (templateId: string) => void;
  onCurrentChange: (index: number) => void;
  renderChart?: (el: SlideElement) => ReactNode;
  guidesEnabled?: boolean;
}

export default function DeckStudio({
  slides, current, themeSettings, templateId, industry,
  images = [], onImagesChange,
  onSlidesChange, onThemeChange, onTemplateChange, onCurrentChange,
  renderChart, guidesEnabled = true,
}: DeckStudioProps) {
  const [panel, setPanel] = useState<Panel>("template");
  const [toolMode, setToolMode] = useState<"pointer" | "text">("pointer");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [slideVariants, setSlideVariants] = useState<Record<string, LayoutVariant>>({});
  const [query, setQuery] = useState("");
  const [assetQuery, setAssetQuery] = useState("");
  const [industryFilter, setIndustryFilter] = useState<string | null>(() => normaliseIndustry(industry));
  const [assetCat, setAssetCat] = useState<AssetCategory | "all">("all");

  const theme = useMemo(() => buildTheme(themeSettings), [themeSettings]);



  useEffect(() => {
    loadFontPairing(themeSettings.fontPairing);
  }, [themeSettings.fontPairing]);

  // V selects the pointer tool, T the text tool — the standard shortcuts,
  // skipped while typing so they don't fight a text field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "v") setToolMode("pointer");
      else if (key === "t") setToolMode("text");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const slide = slides[current];
  const selected = slide?.elements.find((e) => e.id === selectedId) ?? null;

  useEffect(() => {
    if (selected) setPanel("element");
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateSlide(next: ElementSlide, label = "edit") {
    onSlidesChange(slides.map((s, i) => (i === current ? next : s)), label);
  }

  function addElements(els: SlideElement[]) {
    updateSlide({ ...slide, customized: true, elements: [...slide.elements, ...els] }, "add-element");
    if (els.length === 1) {
      setSelectedId(els[0].id);
      setSelectedIds(new Set([els[0].id]));
    }
  }

  /**
   * Places an image, sized from its own aspect ratio rather than dropped
   * into a fixed box. A 3:1 banner and a 1:1 headshot forced into the same
   * frame is a large part of why auto-placed imagery looks wrong.
   */
  function insertImage(img: BrandImage, at?: { x: number; y: number }) {
    const ratio = img.width && img.height ? img.width / img.height : 1.5;
    const targetW = Math.min(560, ratio >= 1 ? 560 : 360);
    const targetH = Math.round(targetW / ratio);
    const x = at?.x ?? Math.round((CANVAS_W - targetW) / 2);
    const y = at?.y ?? Math.round((CANVAS_H - targetH) / 2);

    const el = makeElement(
      "image",
      { x, y, w: targetW, h: Math.min(targetH, 560), z: 25 },
      {
        objectFit: "cover",
        focusX: img.crop?.focusX ?? DEFAULT_CROP.focusX,
        focusY: img.crop?.focusY ?? DEFAULT_CROP.focusY,
        zoom: img.crop?.zoom ?? DEFAULT_CROP.zoom,
        treatment: img.treatment ?? "none",
      },
      { src: img.data_url },
    );
    addElements([el]);
  }

  function patchSelected(patch: Partial<SlideElement>) {
    if (!selected) return;
    updateSlide({
      ...slide,
      customized: true,
      elements: slide.elements.map((e) => (e.id === selected.id ? { ...e, ...patch } : e)),
    });
  }

  // ---- Group / ungroup / align / distribute ------------------------------
  // All of these go through updateSlide, so they land on the undo history
  // (useHistory pushes the before-state) like every other edit.

  function groupSelected() {
    const ids = [...selectedIds];
    if (ids.length < 2) return;
    const groupId = `grp-${Date.now().toString(36)}`;
    updateSlide(
      { ...slide, customized: true, elements: slide.elements.map((e) => (selectedIds.has(e.id) ? { ...e, groupId } : e)) },
      "group",
    );
  }

  function ungroupSelected() {
    updateSlide(
      { ...slide, customized: true, elements: slide.elements.map((e) => (selectedIds.has(e.id) ? { ...e, groupId: null } : e)) },
      "ungroup",
    );
  }

  type AlignOp = "left" | "hcenter" | "right" | "top" | "vmiddle" | "bottom";
  function alignSelected(op: AlignOp) {
    const sel = slide.elements.filter((e) => selectedIds.has(e.id));
    if (sel.length < 1) return;
    // One element aligns to the canvas; several align to their shared bounds.
    const single = sel.length === 1;
    const left = single ? 0 : Math.min(...sel.map((e) => e.frame.x));
    const right = single ? CANVAS_W : Math.max(...sel.map((e) => e.frame.x + e.frame.w));
    const top = single ? 0 : Math.min(...sel.map((e) => e.frame.y));
    const bottom = single ? CANVAS_H : Math.max(...sel.map((e) => e.frame.y + e.frame.h));
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const place = (e: SlideElement): SlideElement => {
      const f = { ...e.frame };
      if (op === "left") f.x = left;
      else if (op === "right") f.x = right - f.w;
      else if (op === "hcenter") f.x = cx - f.w / 2;
      else if (op === "top") f.y = top;
      else if (op === "bottom") f.y = bottom - f.h;
      else if (op === "vmiddle") f.y = cy - f.h / 2;
      return { ...e, frame: f };
    };
    updateSlide(
      { ...slide, customized: true, elements: slide.elements.map((e) => (selectedIds.has(e.id) ? place(e) : e)) },
      `align-${op}`,
    );
  }

  function distributeSelected(axis: "h" | "v") {
    const sel = slide.elements.filter((e) => selectedIds.has(e.id));
    if (sel.length < 3) return;
    const sorted = [...sel].sort((a, b) => (axis === "h" ? a.frame.x - b.frame.x : a.frame.y - b.frame.y));
    const sizeOf = (e: SlideElement) => (axis === "h" ? e.frame.w : e.frame.h);
    const startOf = (e: SlideElement) => (axis === "h" ? e.frame.x : e.frame.y);
    const start = startOf(sorted[0]);
    const last = sorted[sorted.length - 1];
    const end = startOf(last) + sizeOf(last);
    const totalSize = sorted.reduce((sum, e) => sum + sizeOf(e), 0);
    const gap = (end - start - totalSize) / (sorted.length - 1);
    const posById = new Map<string, number>();
    let cursor = start;
    for (const e of sorted) { posById.set(e.id, cursor); cursor += sizeOf(e) + gap; }
    updateSlide(
      {
        ...slide,
        customized: true,
        elements: slide.elements.map((e) =>
          posById.has(e.id)
            ? { ...e, frame: axis === "h" ? { ...e.frame, x: posById.get(e.id)! } : { ...e.frame, y: posById.get(e.id)! } }
            : e,
        ),
      },
      `distribute-${axis}`,
    );
  }

  const selectedList = slide ? slide.elements.filter((e) => selectedIds.has(e.id)) : [];
  const selGroupIds = new Set(selectedList.map((e) => e.groupId ?? null));
  const isOneGroup = selectedList.length >= 2 && selGroupIds.size === 1 && !selGroupIds.has(null);
  const canGroup = selectedList.length >= 2 && !isOneGroup;

  function reorderLayers(sourceId: string, targetId: string) {
    const order = [...slide.elements].sort((a, b) => (b.frame.z ?? 10) - (a.frame.z ?? 10));
    const sourceIndex = order.findIndex((item) => item.id === sourceId);
    const targetIndex = order.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const [source] = order.splice(sourceIndex, 1);
    order.splice(targetIndex, 0, source);
    const zById = new Map(order.map((item, index) => [item.id, (order.length - index) * 10]));
    updateSlide({
      ...slide,
      customized: true,
      elements: slide.elements.map((item) => ({ ...item, frame: { ...item.frame, z: zById.get(item.id) ?? item.frame.z } })),
    }, "reorder-layers");
  }

  const plannedVariants = useMemo(() => planVariants(slides.map((item) => ({
    kind: item.kind,
    paragraphs: item.elements.filter((el) => el.text).map((el) => ({ text: el.text ?? "" })),
    image: item.elements.find((el) => ["image", "portrait", "logo"].includes(el.type))?.src,
    chart: item.elements.find((el) => el.type === "chart")?.chart,
  }))), [slides]);
  const currentVariant = slideVariants[slide?.id ?? ""] ?? plannedVariants[current] ?? "lead-and-points";

  function customizeLayout(variant: LayoutVariant) {
    if (!slide) return;
    const frameFor = (item: SlideElement, index: number) => {
      const image = ["image", "portrait", "logo"].includes(item.type);
      const text = item.text !== undefined;
      if (variant === "statement") return index === 0 ? { ...item.frame, x: 110, y: 190, w: 1060, h: 190 } : { ...item.frame, x: 110, y: 430 + index * 42, w: 1060, h: 34 };
      if (variant === "lead-and-points") return index === 0 ? { ...item.frame, x: 110, y: 150, w: 620, h: 250 } : { ...item.frame, x: 790, y: 150 + (index - 1) * 105, w: 370, h: 80 };
      if (variant === "numbered-rows") return { ...item.frame, x: 120, y: 135 + index * 92, w: 980, h: 68 };
      if (variant === "grid") return { ...item.frame, x: 110 + (index % 3) * 365, y: 160 + Math.floor(index / 3) * 210, w: 320, h: 170 };
      if (variant === "split-image") return image ? { ...item.frame, x: 700, y: 110, w: 470, h: 500 } : { ...item.frame, x: 110, y: 150 + index * 80, w: 500, h: text ? 70 : item.frame.h };
      if (variant === "image-led") return image ? { ...item.frame, x: 100, y: 90, w: 1080, h: 500 } : { ...item.frame, x: 120, y: 610, w: 1040, h: 50 };
      if (variant === "metric-hero") return index === 0 ? { ...item.frame, x: 120, y: 180, w: 1040, h: 250 } : { ...item.frame, x: 140, y: 470 + (index - 1) * 50, w: 1000, h: 40 };
      if (variant === "two-column") return { ...item.frame, x: 110 + (index % 2) * 560, y: 150 + Math.floor(index / 2) * 150, w: 500, h: 120 };
      if (variant === "quote") return index === 0 ? { ...item.frame, x: 170, y: 190, w: 940, h: 220 } : { ...item.frame, x: 740, y: 450, w: 350, h: 60 };
      return { ...item.frame, x: 150, y: 150 + index * 75, w: 900, h: item.type === "chart" ? 390 : 55 };
    };
    let freeIndex = 0;
    const elements = slide.elements.map((item) => {
      if (item.locked) return item;
      const next = { ...item, frame: frameFor(item, freeIndex) };
      freeIndex += 1;
      return next;
    });
    setSlideVariants((prev) => ({ ...prev, [slide.id]: variant }));
    updateSlide({ ...slide, customized: true, elements }, "customize-layout");
  }

  // --- Filmstrip: drag-to-reorder and insert-at-position ---------------
  // Native HTML5 drag events only. dragSrcIndex holds the slide being
  // dragged; dragOverIndex drives the gold insertion indicator.
  const dragSrcIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [bgCustomOpen, setBgCustomOpen] = useState(false);

  function moveSlide(from: number, to: number) {
    const next = [...slides];
    const [moved] = next.splice(from, 1);
    // `to` is the final zero-based position, which makes the same operation
    // usable by both the drag target and the per-slide move buttons.
    const insertAt = Math.min(to, next.length);
    if (insertAt === from) return; // dropped in its own position
    next.splice(insertAt, 0, moved);
    onSlidesChange(next, "reorder-slides");
    onCurrentChange(insertAt); // keep the editor on the dragged slide
  }

  function insertSlideAt(index: number) {
    const requested = window.prompt("Name this slide", "New slide");
    if (requested === null) return;
    const fresh = blankSlide(templateId, requested.trim() || "New slide");
    const next = [...slides];
    next.splice(index, 0, fresh);
    onSlidesChange(next, "insert-slide");
    onCurrentChange(index); // open the editor on the new slide
    setSelectedId(null);
    setSelectedIds(new Set());
  }

  function duplicateSlide(index: number) {
    const source = slides[index];
    if (!source) return;
    const requested = window.prompt("Name the duplicated slide", `${source.title || "Slide"} copy`);
    if (requested === null) return;
    const idMap = new Map(source.elements.map((el) => [el.id, elementId(el.type)]));
    const copy: ElementSlide = {
      ...source,
      id: elementId("slide"),
      title: requested.trim() || `${source.title || "Slide"} copy`,
      elements: source.elements.map((el) => ({
        ...el,
        id: idMap.get(el.id)!,
        attachedTo: el.attachedTo ? (idMap.get(el.attachedTo) ?? null) : el.attachedTo,
      })),
    };
    const next = [...slides];
    next.splice(index + 1, 0, copy);
    onSlidesChange(next, "duplicate-slide");
    onCurrentChange(index + 1);
    setSelectedId(null);
    setSelectedIds(new Set());
  }

  function moveSlideBy(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= slides.length) return;
    moveSlide(index, target);
  }

  function renameCurrentSlide(title: string) {
    if (!slide) return;
    const nextTitle = title;
    const oldTitle = slide.title.trim().toLowerCase();
    const titleTypes = new Set(["heading", "statement", "eyebrow", "quote", "text"]);
    const elements = slide.elements.map((el) => {
      const text = el.text?.trim().toLowerCase();
      const matchesTitle = text === oldTitle;
      return matchesTitle && titleTypes.has(el.type)
        ? { ...el, text: nextTitle }
        : el;
    });
    updateSlide({ ...slide, title: nextTitle, elements }, "rename-slide");
  }

  const insertButton = (at: number) => (
    <button
      key={`ins-${at}`}
      className="dst-insert-btn"
      title="Insert a slide here"
      aria-label={`Insert a slide at position ${at + 1}`}
      onClick={() => insertSlideAt(at)}
    >
      +
    </button>
  );

  const contrast = contrastRatio(themeSettings.ink, themeSettings.paper);
  const accentContrast = contrastRatio(themeSettings.accent, themeSettings.paper);

  if (!slide) return <p className="dst-empty">No slides yet.</p>;

  const slideBg = typeof slide.background === "string" ? slide.background : "";
  const bgIsCustom = HEX_COLOR.test(slideBg) && !BG_PRESETS.some((p) => p.value.toUpperCase() === slideBg.toUpperCase());

  return (
    <div className="dst">
      <div className="dst-stage">
        <div className="dst-canvas-area">
        <div className="dst-toolmode" role="group" aria-label="Canvas tool">
          <button
            className={`dst-tool ${toolMode === "pointer" ? "is-active" : ""}`}
            onClick={() => setToolMode("pointer")}
            title="Move — select and drag (V)"
            aria-pressed={toolMode === "pointer"}
          >
            <span aria-hidden="true">↖</span> Pointer
          </button>
          <button
            className={`dst-tool ${toolMode === "text" ? "is-active" : ""}`}
            onClick={() => setToolMode("text")}
            title="Text — click a text element to edit it (T)"
            aria-pressed={toolMode === "text"}
          >
            <span aria-hidden="true">T</span> Text
          </button>
        </div>

        {selectedIds.size >= 1 && (
          <div className="dst-arrange" role="toolbar" aria-label="Arrange elements">
            {canGroup && (
              <button className="dst-arrange-btn" title="Group" aria-label="Group" onClick={groupSelected}>
                <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                  <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" fill="none" stroke="currentColor" strokeDasharray="2.5 2" />
                  <rect x="3.5" y="3.5" width="4" height="4" fill="currentColor" />
                  <rect x="8.5" y="8.5" width="4" height="4" fill="currentColor" />
                </svg>
              </button>
            )}
            {isOneGroup && (
              <button className="dst-arrange-btn" title="Ungroup" aria-label="Ungroup" onClick={ungroupSelected}>
                <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                  <rect x="2" y="2" width="4.5" height="4.5" fill="none" stroke="currentColor" />
                  <rect x="9.5" y="9.5" width="4.5" height="4.5" fill="none" stroke="currentColor" />
                </svg>
              </button>
            )}
            {(canGroup || isOneGroup) && <span className="dst-arrange-sep" />}

            <button className="dst-arrange-btn" title="Align left" aria-label="Align left" onClick={() => alignSelected("left")}>
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <line x1="2" y1="1.5" x2="2" y2="14.5" stroke="currentColor" />
                <rect x="3.5" y="3" width="9" height="3" fill="currentColor" />
                <rect x="3.5" y="10" width="6" height="3" fill="currentColor" />
              </svg>
            </button>
            <button className="dst-arrange-btn" title="Align centre" aria-label="Align centre" onClick={() => alignSelected("hcenter")}>
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <line x1="8" y1="1.5" x2="8" y2="14.5" stroke="currentColor" />
                <rect x="3.5" y="3" width="9" height="3" fill="currentColor" />
                <rect x="5" y="10" width="6" height="3" fill="currentColor" />
              </svg>
            </button>
            <button className="dst-arrange-btn" title="Align right" aria-label="Align right" onClick={() => alignSelected("right")}>
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <line x1="14" y1="1.5" x2="14" y2="14.5" stroke="currentColor" />
                <rect x="3.5" y="3" width="9" height="3" fill="currentColor" />
                <rect x="6.5" y="10" width="6" height="3" fill="currentColor" />
              </svg>
            </button>
            <button className="dst-arrange-btn" title="Align top" aria-label="Align top" onClick={() => alignSelected("top")}>
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <line x1="1.5" y1="2" x2="14.5" y2="2" stroke="currentColor" />
                <rect x="3" y="3.5" width="3" height="9" fill="currentColor" />
                <rect x="10" y="3.5" width="3" height="6" fill="currentColor" />
              </svg>
            </button>
            <button className="dst-arrange-btn" title="Align middle" aria-label="Align middle" onClick={() => alignSelected("vmiddle")}>
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <line x1="1.5" y1="8" x2="14.5" y2="8" stroke="currentColor" />
                <rect x="3" y="3.5" width="3" height="9" fill="currentColor" />
                <rect x="10" y="5" width="3" height="6" fill="currentColor" />
              </svg>
            </button>
            <button className="dst-arrange-btn" title="Align bottom" aria-label="Align bottom" onClick={() => alignSelected("bottom")}>
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <line x1="1.5" y1="14" x2="14.5" y2="14" stroke="currentColor" />
                <rect x="3" y="3.5" width="3" height="9" fill="currentColor" />
                <rect x="10" y="6.5" width="3" height="6" fill="currentColor" />
              </svg>
            </button>

            {selectedIds.size >= 3 && (
              <>
                <span className="dst-arrange-sep" />
                <button className="dst-arrange-btn" title="Distribute horizontally" aria-label="Distribute horizontally" onClick={() => distributeSelected("h")}>
                  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                    <rect x="1" y="4" width="3" height="8" fill="currentColor" />
                    <rect x="6.5" y="4" width="3" height="8" fill="currentColor" />
                    <rect x="12" y="4" width="3" height="8" fill="currentColor" />
                  </svg>
                </button>
                <button className="dst-arrange-btn" title="Distribute vertically" aria-label="Distribute vertically" onClick={() => distributeSelected("v")}>
                  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                    <rect x="4" y="1" width="8" height="3" fill="currentColor" />
                    <rect x="4" y="6.5" width="8" height="3" fill="currentColor" />
                    <rect x="4" y="12" width="8" height="3" fill="currentColor" />
                  </svg>
                </button>
              </>
            )}
          </div>
        )}

        <div
          className="dst-canvas-hold"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("application/x-provisio-image")) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(e) => {
            const id = e.dataTransfer.getData("application/x-provisio-image");
            if (!id) return;
            e.preventDefault();
            const img = images.find((i) => i.id === id);
            if (!img) return;
            // Convert the drop point from screen space into canvas space so
            // the image lands where it was released, not at a default spot.
            const rect = e.currentTarget.getBoundingClientRect();
            const scale = rect.width / CANVAS_W;
            // Centre the image on the drop point. insertImage sizes the image
            // from its own aspect ratio, so mirror that here to offset by half
            // the real dimensions rather than an arbitrary constant.
            const ratio = img.width && img.height ? img.width / img.height : 1.5;
            const targetW = Math.min(560, ratio >= 1 ? 560 : 360);
            const targetH = Math.min(Math.round(targetW / ratio), 560);
            insertImage(img, {
              x: Math.round((e.clientX - rect.left) / scale) - targetW / 2,
              y: Math.round((e.clientY - rect.top) / scale) - targetH / 2,
            });
          }}
        >
          <SlideCanvas
            slide={slide}
            theme={theme}
            onChange={updateSlide}
            renderChart={renderChart}
            selectedId={selectedId}
            selectedIds={selectedIds}
            guidesEnabled={guidesEnabled}
            toolMode={toolMode}
            onRequestPointerMode={() => setToolMode("pointer")}
            onSelectionChange={(ids, activeId) => {
              setSelectedIds(ids);
              setSelectedId(activeId);
            }}
          />
        </div>

        </div>
        <div className="dst-filmstrip">
          {slides.map((s, i) => (
            <Fragment key={s.id}>
              {insertButton(i)}
              <div
                className={`dst-thumb ${i === current ? "is-active" : ""} ${dragOverIndex === i ? "dst-thumb-drag-over" : ""}`}
                draggable
                onDragStart={(e) => {
                  dragSrcIndex.current = i;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(i)); // Firefox needs data set
                }}
                onDragOver={(e) => {
                  if (dragSrcIndex.current === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverIndex(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = dragSrcIndex.current;
                  if (from !== null) moveSlide(from, i);
                  dragSrcIndex.current = null;
                  setDragOverIndex(null);
                }}
                onDragEnd={() => { dragSrcIndex.current = null; setDragOverIndex(null); }}
                onClick={() => { onCurrentChange(i); setSelectedId(null); setSelectedIds(new Set()); }}
              >
                <span className="dst-thumb-num">{i + 1}</span>
                <span className="dst-thumb-title">{s.title}</span>
                {s.customized && <span className="dst-thumb-dot" title="Hand-edited" />}
                <span className="dst-thumb-actions" onClick={(e) => e.stopPropagation()}>
                  <button type="button" title="Move left" aria-label={`Move slide ${i + 1} left`} disabled={i === 0} onClick={() => moveSlideBy(i, -1)}>←</button>
                  <button type="button" title="Move right" aria-label={`Move slide ${i + 1} right`} disabled={i === slides.length - 1} onClick={() => moveSlideBy(i, 1)}>→</button>
                  <button type="button" title="Duplicate slide" aria-label={`Duplicate slide ${i + 1}`} onClick={() => duplicateSlide(i)}>⧉</button>
                </span>
              </div>
            </Fragment>
          ))}
          {insertButton(slides.length)}
        </div>
      </div>

      <aside className="dst-panel">
        <nav className="dst-tabs">
          {(["template", "theme", "assets", "library", "images", "layers", "element"] as Panel[]).map((p) => (
            <button
              key={p}
              className={`dst-tab ${panel === p ? "is-active" : ""}`}
              onClick={() => setPanel(p)}
              disabled={p === "element" && !selected}
            >
              {p === "element" ? "Selection" : p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </nav>

        {panel === "template" && (
          <section className="dst-section">
            <label className="dst-field">
              <span>Slide name</span>
              <input
                className="p-input"
                value={slide.title}
                placeholder="Name this slide"
                onChange={(e) => renameCurrentSlide(e.target.value)}
              />
            </label>
            <p className="dst-hint">
              Each template arranges every slide differently: different grid, different anchor points,
              different amount of the canvas used. Switching recomposes slides you haven't hand-edited.
            </p>
            {Object.keys(COMPOSERS).map((id) => (
              <button
                key={id}
                className={`dst-option ${templateId === id ? "is-active" : ""}`}
                onClick={() => onTemplateChange(id)}
              >
                <strong>{id[0].toUpperCase() + id.slice(1)}</strong>
              </button>
            ))}
            <div className="dst-custom-layout">
              <h4>Customize layout</h4>
              <p className="dst-hint">Current slide: <strong>{currentVariant}</strong>. Recompose this slide only.</p>
              <div className="dst-variant-list">
                {LAYOUT_VARIANTS.map((variant) => (
                  <button
                    key={variant}
                    className={`dst-option ${currentVariant === variant ? "is-active" : ""}`}
                    onClick={() => customizeLayout(variant)}
                  >
                    {variant.replaceAll("-", " ")}
                  </button>
                ))}
              </div>
            </div>
            <p className="dst-warn">
              {slides.filter((s) => s.customized).length > 0
                ? `${slides.filter((s) => s.customized).length} slide(s) you've hand-edited keep their layout.`
                : "No slides have been hand-edited, so all of them will recompose."}
            </p>
          </section>
        )}

        {panel === "theme" && (
          <section className="dst-section">
            <h4>Colour</h4>
            <div className="dst-schemes">
              {SCHEME_PRESETS.map((s) => (
                <button
                  key={s.id}
                  className="dst-scheme"
                  onClick={() => onThemeChange({ ...themeSettings, ink: s.ink, paper: s.paper, accent: s.accent })}
                  title={s.name}
                >
                  <span style={{ background: s.ink }} />
                  <span style={{ background: s.accent }} />
                  <span style={{ background: s.paper, border: "1px solid rgba(0,0,0,.15)" }} />
                </button>
              ))}
            </div>

            <div className="dst-colors">
              {(["ink", "accent", "paper"] as const).map((k) => (
                <label key={k} className="dst-color">
                  <span>{k}</span>
                  <HexColorControl
                    value={themeSettings[k]}
                    onChange={(value) => onThemeChange({ ...themeSettings, [k]: value })}
                  />
                </label>
              ))}
            </div>

            {/* A deck nobody can read is worse than a plain one, so the
                editor says so rather than letting it happen silently. */}
            {contrast < 7 && (
              <p className="dst-warn">
                Text contrast is {contrast.toFixed(1)}:1. Below about 7:1, body text gets hard to read
                on a projector.
              </p>
            )}
            {accentContrast < 3 && (
              <p className="dst-warn">
                The accent is low contrast against the background ({accentContrast.toFixed(1)}:1) and
                will disappear in small labels.
              </p>
            )}

            <h4>Type</h4>
            {Object.entries(FONT_PAIRINGS).map(([id, p]) => (
              <button
                key={id}
                className={`dst-option ${themeSettings.fontPairing === id ? "is-active" : ""}`}
                onClick={() => onThemeChange({ ...themeSettings, fontPairing: id })}
              >
                <strong style={{ fontFamily: p.display }}>{p.name}</strong>
                <em>{p.note}</em>
              </button>
            ))}

            {/* Slide background colour — applies to the current slide, so a
                dark statement page can sit inside a light deck. Writes
                slide.background, which is what SlideCanvas actually reads. */}
            <h4>Slide background</h4>
            <div className="dst-field">
              <div className="dst-bg-swatches">
                {BG_PRESETS.map(({ label, value }) => (
                  <button key={value}
                    className={`dst-bg-swatch ${slideBg.toUpperCase() === value.toUpperCase() ? 'is-active' : ''}`}
                    style={{ background: value }}
                    title={label}
                    onClick={() => { setBgCustomOpen(false); updateSlide({ ...slide, background: value }, "slide-background"); }}
                  />
                ))}
                <button
                  className={`dst-bg-swatch ${bgIsCustom ? 'is-active' : ''}`}
                  style={{ background: 'linear-gradient(135deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f)' }}
                  title="Custom"
                  onClick={() => {
                    setBgCustomOpen(true);
                    if (!HEX_COLOR.test(slideBg)) updateSlide({ ...slide, background: '#F8F5EE' }, "slide-background");
                  }}
                />
              </div>
              {(bgCustomOpen || bgIsCustom) && (
                <HexColorControl
                  value={HEX_COLOR.test(slideBg) ? slideBg : '#F8F5EE'}
                  onChange={(value) => updateSlide({ ...slide, background: value }, "slide-background")}
                />
              )}
            </div>

            <h4>Scale</h4>
            <label className="dst-slider">
              <input
                type="range" min={0.85} max={1.25} step={0.05}
                value={themeSettings.typeScale}
                onChange={(e) => onThemeChange({ ...themeSettings, typeScale: parseFloat(e.target.value) })}
              />
              <span>{Math.round(themeSettings.typeScale * 100)}%</span>
            </label>
          </section>
        )}

        {panel === "library" && (
          <section className="dst-section">
            <input
              className="p-input dst-search"
              placeholder="Search: metrics, risk, roadmap, quote…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="dst-ind-chips">
              <button
                className={industryFilter === null ? "is-active" : ""}
                onClick={() => setIndustryFilter(null)}
              >
                All
              </button>
              {LIBRARY_INDUSTRIES.map((ind) => (
                <button
                  key={ind.id}
                  className={industryFilter === ind.id ? "is-active" : ""}
                  onClick={() => setIndustryFilter(industryFilter === ind.id ? null : ind.id)}
                >
                  {ind.label}
                </button>
              ))}
            </div>
            <div className="dst-library">
              {searchLibrary(query, industryFilter).map((item: LibraryItem) => (
                <button
                  key={item.id}
                  className="dst-lib-item"
                  onClick={() => addElements(instantiate(item, { x: 140, y: 240 }))}
                >
                  <strong>{item.name}</strong>
                  <em>{item.description}</em>
                </button>
              ))}
              {searchLibrary(query, industryFilter).length === 0 && (
                <p className="dst-hint">Nothing matches that. Try a broader word.</p>
              )}
            </div>
          </section>
        )}

        {panel === "assets" && (
          <section className="dst-section">
            <input
              className="p-input dst-search"
              placeholder="Search shapes, icons, arrows…"
              value={assetQuery}
              onChange={(e) => setAssetQuery(e.target.value)}
            />
            <div className="dst-asset-cats">
              {ASSET_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  className={assetCat === cat.id ? "is-active" : ""}
                  onClick={() => setAssetCat(cat.id)}
                >
                  {cat.name}
                </button>
              ))}
            </div>
            <div className="dst-assets">
              {searchAssets(assetQuery, assetCat).map((a) => (
                <button
                  key={a.id}
                  className="dst-asset"
                  title={a.name}
                  onClick={() => addElements([
                    makeElement(
                      "asset",
                      {
                        x: Math.round((CANVAS_W - a.size.w) / 2),
                        y: Math.round((CANVAS_H - a.size.h) / 2),
                        w: a.size.w, h: a.size.h, z: 22,
                      },
                      { color: "accent", assetId: a.id, assetStyle: a.defaultStyle ?? "solid" },
                    ),
                  ])}
                  dangerouslySetInnerHTML={{ __html: assetToSvg(a, "#b8860b", a.defaultStyle ?? "solid") }}
                />
              ))}
            </div>
            <p className="dst-hint">
              Assets are vector, so they scale cleanly and recolour with your theme. Select one on
              the slide to change its colour or switch between solid and outline.
            </p>
          </section>
        )}

        {panel === "images" && (
          <section className="dst-section">
            <p className="dst-hint">
              Drag an image onto the slide to place it exactly, or click to drop it in the middle.
              Adjust sets the focal point so cropping keeps the subject in frame.
            </p>
            <ImageLibrary
              images={images}
              onChange={(next) => onImagesChange?.(next)}
              onInsert={(img) => insertImage(img)}
            />
          </section>
        )}

        {panel === "layers" && (
          <section className="dst-section dst-layers">
            <p className="dst-hint">Higher layers appear above lower layers. Drag to reorder.</p>
            {[...slide.elements]
              .sort((a, b) => (b.frame.z ?? 10) - (a.frame.z ?? 10))
              .map((el) => (
                <div
                  key={el.id}
                  className={`dst-layer-row ${selectedIds.has(el.id) ? "is-selected" : ""}`}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", el.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); reorderLayers(e.dataTransfer.getData("text/plain"), el.id); }}
                  onClick={() => { setSelectedIds(new Set([el.id])); setSelectedId(el.id); }}
                >
                  <span className="dst-layer-grip" aria-hidden="true">⋮⋮</span>
                  <span className="dst-layer-icon" aria-hidden="true">
                    {el.type === "image" || el.type === "portrait" || el.type === "logo" ? "▧" : el.type === "shape" ? "◇" : "T"}
                  </span>
                  <span className="dst-layer-name">{el.text?.trim().slice(0, 28) || el.type}</span>
                  <button
                    className="dst-layer-action"
                    title={el.hidden ? "Show element" : "Hide element"}
                    onClick={(e) => { e.stopPropagation(); updateSlide({ ...slide, customized: true, elements: slide.elements.map((item) => item.id === el.id ? { ...item, hidden: !item.hidden } : item) }, "toggle-visibility"); }}
                  >
                    {el.hidden ? "◌" : "◉"}
                  </button>
                  <button
                    className="dst-layer-action"
                    title={el.locked ? "Unlock element" : "Lock element"}
                    onClick={(e) => { e.stopPropagation(); updateSlide({ ...slide, customized: true, elements: slide.elements.map((item) => item.id === el.id ? { ...item, locked: !item.locked } : item) }, "toggle-lock"); }}
                  >
                    {el.locked ? "🔒" : "⌑"}
                  </button>
                </div>
              ))}
          </section>
        )}

        {panel === "element" && selected && (
          <section className="dst-section">
            <label className="dst-field">
              <span>Slide name</span>
              <input
                className="p-input"
                value={slide.title}
                placeholder="Name this slide"
                onChange={(e) => renameCurrentSlide(e.target.value)}
              />
            </label>
            <h4>{selected.type}</h4>

            {selected.text !== undefined && (
              <label className="dst-field">
                <span>Text</span>
                <textarea
                  className="p-input" rows={4}
                  value={selected.text}
                  onChange={(e) => patchSelected({ text: e.target.value })}
                />
                <WordCount text={selected.text} />
              </label>
            )}

            <div className="dst-grid2">
              <label className="dst-field">
                <span>Size</span>
                <input
                  className="p-input" type="number"
                  value={selected.style.fontSize ?? 18}
                  onChange={(e) => patchSelected({ style: { ...selected.style, fontSize: parseFloat(e.target.value) } })}
                />
              </label>
              <label className="dst-field">
                <span>Weight</span>
                <select
                  className="p-input"
                  value={selected.style.fontWeight ?? 400}
                  onChange={(e) => patchSelected({ style: { ...selected.style, fontWeight: parseInt(e.target.value) } })}
                >
                  {[300, 400, 500, 600, 700, 800].map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </label>
            </div>

            <label className="dst-field">
              <span>Colour role</span>
              <select
                className="p-input"
                value={selected.style.color ?? "ink"}
                onChange={(e) => patchSelected({ style: { ...selected.style, color: e.target.value as never } })}
              >
                {["ink", "accent", "muted", "inverse", "paper"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>

            <label className="dst-field">
              <span>Colour</span>
              <HexColorControl
                value={resolveColor(selected.style.color, theme)}
                onChange={(value) => patchSelected({ style: { ...selected.style, color: value } })}
              />
            </label>

            <label className="dst-field">
              <span>Font</span>
              <select
                className="p-input"
                value={selected.style.fontFamily ?? "body"}
                onChange={(e) => patchSelected({ style: { ...selected.style, fontFamily: e.target.value as never } })}
              >
                {["display", "body", "label"].map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>

            <label className="dst-field">
              <span>Align</span>
              <div className="dst-btn-row">
                {(["left", "center", "right"] as const).map((a) => (
                  <button
                    key={a}
                    className={selected.style.align === a ? "is-active" : ""}
                    onClick={() => patchSelected({ style: { ...selected.style, align: a } })}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </label>

            <div className="dst-grid2">
              {(["x", "y", "w", "h"] as const).map((k) => (
                <label className="dst-field" key={k}>
                  <span>{k.toUpperCase()}</span>
                  <input
                    className="p-input" type="number"
                    value={Math.round(selected.frame[k])}
                    onChange={(e) => patchSelected({ frame: { ...selected.frame, [k]: parseFloat(e.target.value) } })}
                  />
                </label>
              ))}
            </div>

            {selected.type === "asset" && (
              <>
                <label className="dst-field">
                  <span>Colour</span>
                  <select
                    className="p-input"
                    value={selected.style.color ?? "accent"}
                    onChange={(e) => patchSelected({ style: { ...selected.style, color: e.target.value as never } })}
                  >
                    {["accent", "ink", "muted", "inverse", "paper"].map((cc) => <option key={cc} value={cc}>{cc}</option>)}
                  </select>
                </label>
                <label className="dst-field">
                  <span>Style</span>
                  <div className="dst-btn-row">
                    {(["solid", "outline"] as const).map((v) => (
                      <button
                        key={v}
                        className={(selected.style.assetStyle ?? "solid") === v ? "is-active" : ""}
                        onClick={() => patchSelected({ style: { ...selected.style, assetStyle: v } })}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </label>
              </>
            )}

            {(selected.type === "image" || selected.type === "portrait" || selected.type === "logo") && (
              <>
                <label className="dst-field">
                  <span>Opacity · {Math.round((selected.opacity ?? 1) * 100)}%</span>
                  <input
                    type="range" min={0} max={1} step={0.01}
                    value={selected.opacity ?? 1}
                    onChange={(e) => patchSelected({ opacity: parseFloat(e.target.value) })}
                  />
                </label>
                <label className="dst-field">
                  <span>Focal point X</span>
                  <input
                    type="range" min={0} max={1} step={0.02}
                    value={selected.style.focusX ?? 0.5}
                    onChange={(e) => patchSelected({ style: { ...selected.style, focusX: parseFloat(e.target.value) } })}
                  />
                </label>
                <label className="dst-field">
                  <span>Focal point Y</span>
                  <input
                    type="range" min={0} max={1} step={0.02}
                    value={selected.style.focusY ?? 0.5}
                    onChange={(e) => patchSelected({ style: { ...selected.style, focusY: parseFloat(e.target.value) } })}
                  />
                </label>
                <label className="dst-field">
                  <span>Zoom</span>
                  <input
                    type="range" min={1} max={2.5} step={0.05}
                    value={selected.style.zoom ?? 1}
                    onChange={(e) => patchSelected({ style: { ...selected.style, zoom: parseFloat(e.target.value) } })}
                  />
                </label>
                <label className="dst-field">
                  <span>Treatment</span>
                  <select
                    className="p-input"
                    value={selected.style.treatment ?? "none"}
                    onChange={(e) => patchSelected({ style: { ...selected.style, treatment: e.target.value } })}
                  >
                    {["none", "grayscale", "duotone", "soft", "high-contrast", "muted"].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label className="dst-field">
                  <span>Fit</span>
                  <select
                    className="p-input"
                    value={selected.style.objectFit ?? "cover"}
                    onChange={(e) => patchSelected({ style: { ...selected.style, objectFit: e.target.value as "cover" | "contain" } })}
                  >
                    <option value="cover">Fill the frame (crops)</option>
                    <option value="contain">Fit inside (no crop)</option>
                  </select>
                </label>
              </>
            )}

            {selected.type === "shape" && (
              <label className="dst-field">
                <span>Opacity · {Math.round((selected.opacity ?? 1) * 100)}%</span>
                <input
                  type="range" min={0} max={1} step={0.01}
                  value={selected.opacity ?? 1}
                  onChange={(e) => patchSelected({ opacity: parseFloat(e.target.value) })}
                />
              </label>
            )}

            <div className="dst-btn-row">
              <button onClick={() => patchSelected({ frame: { ...selected.frame, z: (selected.frame.z ?? 10) + 5 } })}>
                Bring forward
              </button>
              <button onClick={() => patchSelected({ frame: { ...selected.frame, z: Math.max(0, (selected.frame.z ?? 10) - 5) } })}>
                Send back
              </button>
            </div>

            <div className="dst-btn-row">
              <button onClick={() => {
                const copy = { ...selected, id: `${selected.id}-copy-${Date.now()}`, frame: { ...selected.frame, x: selected.frame.x + 24, y: selected.frame.y + 24 } };
                addElements([copy]);
              }}>
                Duplicate
              </button>
              <button
                className="dst-danger"
                onClick={() => {
                  updateSlide({ ...slide, customized: true, elements: slide.elements.filter((e) => e.id !== selected.id) });
                  setSelectedId(null);
                }}
              >
                Delete
              </button>
            </div>

            <p className="dst-hint">
              Arrow keys nudge by 1px, shift-arrow by 10. Elements snap to margins, centre, and each
              other while dragging.
            </p>
          </section>
        )}
      </aside>
    </div>
  );
}

/**
 * Builds a chart element plus its caption, used when data is dropped onto a
 * slide from the Data Studio. The caption is created with the chart rather
 * than left to the user to remember, because a chart without a sentence
 * saying what it means is the most common weak slide in a deck.
 */
export function chartWithCaption(
  chart: { chart_type: string; columns: string[]; rows: string[][] },
  note: string,
  at: { x: number; y: number },
  width = 700,
): SlideElement[] {
  const chartEl = makeElement("chart", { x: at.x, y: at.y, w: width, h: 360, z: 20 }, {}, { chart });
  const caption = makeElement(
    "caption",
    { x: at.x, y: at.y + 374, w: width, h: 60, z: 20 },
    { color: "muted", fontFamily: "body", fontSize: 15, lineHeight: 1.45, borderLeft: 2, borderColor: "accent", padding: 12 },
    { text: note || "What does this show?", attachedTo: chartEl.id },
  );
  return [chartEl, caption];
}

export { CANVAS_W, CANVAS_H };
