import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import html2canvas from "html2canvas";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, rectSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { supabase } from "./supabaseClient";
import {
  getDeck,
  saveDeckEditorState,
  regenerateDeck,
  updateDeckProfile,
  type DeckSlide,
  type DeckTheme,
  type CompanyProfile,
  type AnalyzeResult,
} from "./api";
import SlideThumb from "./SlideThumb";
import DesignedSlide from "./DesignedSlide";
import TemplatePicker, { type DeckStyle } from "./TemplatePicker";
import { DEFAULT_TEMPLATE_ID } from "./deck/templates";
import FreeformCanvas from "./FreeformCanvas";
import CompanyProfileForm from "./CompanyProfileForm";
import { defaultLayoutForSlide, type LayoutElement } from "./layoutTypes";
import { ASSETS, assetToSvg } from "./deck/assets";
import SlideCanvas from "./deck/SlideCanvas";
import { buildTheme, loadFontPairing } from "./deck/theme";
import { toElementSlides, type StoredSlide } from "./deck/migrate";
import { inlineImages } from "./deck/imageStore";
import "./theme.css";
import "./deck.css";

interface DeckViewerProps {
  deckId: string;
  analyzedRepos: AnalyzeResult[];
  onBack: () => void;
}

type ViewMode = "single" | "overview" | "profile" | "design";

export default function DeckViewer({ deckId, analyzedRepos, onBack }: DeckViewerProps) {
  const [deckName, setDeckName] = useState("");
  const [slides, setSlides] = useState<DeckSlide[] | null>(null);
  const [theme, setTheme] = useState<DeckTheme | null>(null);
  const [deckProfile, setDeckProfile] = useState<CompanyProfile | null>(null);
  // Template and colour scheme live on the deck's theme so they persist and
  // travel with the deck, rather than being a per-session preference.
  const [style, setStyle] = useState<DeckStyle>({
    templateId: DEFAULT_TEMPLATE_ID,
    schemeId: "template",
  });
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingDeck, setLoadingDeck] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [layouts, setLayouts] = useState<Record<string, LayoutElement[]>>({});
  const [freeformSlideIds, setFreeformSlideIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("single");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    getDeck(deckId)
      .then((d) => {
        setDeckName(d.name);
        setSlides(d.slides);
        setTheme(d.theme);
        setStyle({
          templateId: d.theme?.template_id ?? DEFAULT_TEMPLATE_ID,
          schemeId: d.theme?.scheme_id ?? "template",
        });
        setDeckProfile(d.profile_snapshot as unknown as CompanyProfile);
        setLayouts((d.layouts as Record<string, LayoutElement[]>) ?? {});
        setFreeformSlideIds(new Set(d.freeform_slide_ids ?? []));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load this deck."))
      .finally(() => setLoadingDeck(false));
  }, [deckId]);

  async function handleRegenerate() {
    if (dirty && !window.confirm("Regenerating will replace this deck's slides with fresh ones. Continue?")) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const summaries = analyzedRepos.map((r) => r.summary);
      const updated = await regenerateDeck(deckId, summaries);
      setSlides(updated.slides);
      setTheme(updated.theme);
      setCurrent(0);
      setLayouts({});
      setFreeformSlideIds(new Set());
      setDirty(false);
      setSavedAt(new Date());
      if (updated.slides.length === 0) {
        setError(
          "No deck content yet. Fill in the company profile for this deck and select at least one analyzed repo."
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't regenerate this deck.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!slides || !theme) return;
    setSaving(true);
    setError(null);
    try {
      await saveDeckEditorState(deckId, {
        name: deckName,
        slides,
        theme,
        layouts,
        freeform_slide_ids: Array.from(freeformSlideIds),
      });
      setDirty(false);
      setSavedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the deck.");
    } finally {
      setSaving(false);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!slides) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = slides.findIndex((s) => s.id === active.id);
    const newIndex = slides.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    setSlides(arrayMove(slides, oldIndex, newIndex));
    setDirty(true);
    setCurrent(newIndex);
  }

  function handleSlideChange(index: number, updated: DeckSlide) {
    if (!slides) return;
    setSlides(slides.map((s, i) => (i === index ? updated : s)));
    setDirty(true);
  }

  function handleDeleteSlide(index: number) {
    if (!slides || slides.length <= 1) return;
    if (!window.confirm("Delete this slide?")) return;
    const updated = slides.filter((_, i) => i !== index);
    setSlides(updated);
    setDirty(true);
    setCurrent((c) => Math.min(c, updated.length - 1));
  }

  function toggleFreeform(slideId: string) {
    setFreeformSlideIds((prev) => {
      const next = new Set(prev);
      if (next.has(slideId)) {
        next.delete(slideId);
      } else {
        next.add(slideId);
        if (!layouts[slideId] && slides) {
          const targetSlide = slides.find((s) => s.id === slideId);
          if (targetSlide) {
            setLayouts((l) => ({ ...l, [slideId]: defaultLayoutForSlide(targetSlide) }));
          }
        }
      }
      return next;
    });
    setDirty(true);
  }

  function updateLayout(slideId: string, layout: LayoutElement[]) {
    setLayouts((l) => ({ ...l, [slideId]: layout }));
    setDirty(true);
  }

  if (loadingDeck) {
    return <p className="deck-loading">Loading deck...</p>;
  }

  if (!slides || !theme) {
    return (
      <div className="deck-empty">
        <button className="p-btn p-btn-ghost" onClick={onBack}>
          &lt; Back to decks
        </button>
        <p className="p-error">{error ?? "Couldn't load this deck."}</p>
      </div>
    );
  }

  const slide = slides[current];

  return (
    <div className="deck-editor">
      <div className="deck-toolbar">
        <div className="deck-toolbar-left">
          <button className="p-btn p-btn-ghost" onClick={onBack}>
            &lt; Decks
          </button>
          <input
            className="deck-name-input"
            value={deckName}
            onChange={(e) => {
              setDeckName(e.target.value);
              setDirty(true);
            }}
          />
          <button className="p-btn p-btn-secondary" onClick={handleRegenerate} disabled={loading}>
            {loading ? "Regenerating..." : "Regenerate"}
          </button>
          <button className="p-btn p-btn-primary" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? "Saving..." : dirty ? "Save deck" : "Saved"}
          </button>
          <div className="deck-view-toggle">
            <button
              className={`deck-view-btn ${viewMode === "single" ? "deck-view-btn-active" : ""}`}
              onClick={() => setViewMode("single")}
            >
              Single
            </button>
            <button
              className={`deck-view-btn ${viewMode === "overview" ? "deck-view-btn-active" : ""}`}
              onClick={() => setViewMode("overview")}
            >
              Overview
            </button>
            <button
              className={`deck-view-btn ${viewMode === "design" ? "deck-view-btn-active" : ""}`}
              onClick={() => setViewMode("design")}
            >
              Design
            </button>
            <button
              className={`deck-view-btn ${viewMode === "profile" ? "deck-view-btn-active" : ""}`}
              onClick={() => setViewMode("profile")}
            >
              Profile
            </button>
          </div>
          <DownloadMenu deckId={deckId} />
        </div>
        <span className="deck-position">
          {viewMode === "single" && `Slide ${current + 1} of ${slides.length}`}
          {savedAt && !dirty && <span className="deck-saved-note"> Saved {savedAt.toLocaleTimeString()}</span>}
        </span>
      </div>

      {error && <p className="p-error deck-error">{error}</p>}

      {viewMode === "design" ? (
        <div className="deck-design-view">
          <div className="deck-design-preview">
            <DesignedSlide
              slide={slides[current]}
              theme={theme}
              companyName={deckName}
              pageNumber={current + 1}
              totalPages={slides.length}
              templateId={style.templateId}
              schemeId={style.schemeId}
            />
            <p className="deck-design-note">
              Previewing slide {current + 1}. Changes apply to every slide in this deck.
            </p>
          </div>
          <div className="deck-design-controls">
            <TemplatePicker
              value={style}
              onChange={(next) => {
                setStyle(next);
                setDirty(true);
              }}
              brandPrimary={theme?.primary_color}
            />
          </div>
        </div>
      ) : viewMode === "profile" ? (
        deckProfile && (
          <CompanyProfileForm
            heading="Profile for this deck"
            description="Editing this only affects this deck. It won't change your shared company profile, or any other deck."
            load={async () => deckProfile}
            save={async (p) => {
              await updateDeckProfile(deckId, p);
              setDeckProfile(p);
            }}
          />
        )
      ) : viewMode === "overview" ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={slides.map((s) => s.id)} strategy={rectSortingStrategy}>
            <div className="deck-overview-grid">
              {slides.map((s, i) => (
                <OverviewCard
                  templateId={style.templateId}
                  schemeId={style.schemeId}
                  key={s.id}
                  slide={s}
                  index={i}
                  theme={theme}
                  canDelete={slides.length > 1}
                  onOpen={() => {
                    setCurrent(i);
                    setViewMode("single");
                  }}
                  onDelete={() => handleDeleteSlide(i)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="deck-editor-body">
          <div className="deck-sidebar">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={slides.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                {slides.map((s, i) => (
                  <SlideThumb
                    key={s.id}
                    slide={s}
                    index={i}
                    isActive={i === current}
                    onSelect={() => setCurrent(i)}
                    onDelete={() => handleDeleteSlide(i)}
                    canDelete={slides.length > 1}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>

          <div className="deck-stage-column">
            {slide.type !== "team" && slide.type !== "toc" && slide.type !== "chart" && (
              <div className="deck-freeform-toggle">
                <label>
                  <input
                    type="checkbox"
                    checked={freeformSlideIds.has(slide.id)}
                    onChange={() => toggleFreeform(slide.id)}
                  />
                  Freeform layout (drag and resize elements)
                </label>
              </div>
            )}

            <div className="deck-stage">
              <button
                className="deck-nav deck-nav-prev"
                onClick={() => setCurrent((c) => Math.max(0, c - 1))}
                disabled={current === 0}
                aria-label="Previous slide"
              >
                &lt;
              </button>

              {freeformSlideIds.has(slide.id) ? (
                <FreeformCanvas
                  slide={slide}
                  layout={layouts[slide.id] ?? defaultLayoutForSlide(slide)}
                  theme={theme}
                  onLayoutChange={(l) => updateLayout(slide.id, l)}
                  onSlideChange={(updated) => handleSlideChange(current, updated)}
                />
              ) : (
                <DesignedSlide
                  slide={slide}
                  theme={theme}
                  companyName={deckName}
                  pageNumber={current + 1}
                  totalPages={slides.length}
                  editable
                  templateId={style.templateId}
                  schemeId={style.schemeId}
                  onChange={(updated) => handleSlideChange(current, updated)}
                />
              )}

              <button
                className="deck-nav deck-nav-next"
                onClick={() => setCurrent((c) => Math.min(slides.length - 1, c + 1))}
                disabled={current === slides.length - 1}
                aria-label="Next slide"
              >
                &gt;
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { captureChartImages } from "./chartCapture";

function assetColor(token: string | undefined, theme: DeckTheme): string {
  if (token?.startsWith("#")) return token;
  if (token === "ink") return theme.secondary_color || "#161412";
  if (token === "inverse") return theme.primary_color || "#faf8f3";
  return theme.primary_color || "#b8860b";
}

/** Rasterises library SVGs once for the Python PPTX/PDF exporters. */
async function captureAssetImages(deck: any): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const slides = (deck.slides ?? []) as { elements?: Record<string, unknown>[] }[];
  const theme = (deck.theme ?? {}) as DeckTheme;
  const jobs: Promise<void>[] = [];

  for (const slide of slides) {
    for (const el of slide.elements ?? []) {
      if (el.type !== "asset") continue;
      const style = (el.style ?? {}) as Record<string, string>;
      const asset = ASSETS.find((item) => item.id === style.assetId);
      if (!asset) continue;
      const frame = (el.frame ?? {}) as { w?: number; h?: number };
      const ratio = Math.max(0.1, (frame.w ?? asset.size.w) / Math.max(frame.h ?? asset.size.h, 1));
      const color = assetColor(style.color, theme);
      const assetStyle = (style.assetStyle as "solid" | "outline" | undefined)
        ?? asset.defaultStyle ?? "solid";
      const key = `${asset.id}:${assetStyle}:${style.color ?? "accent"}:${Math.round(ratio * 1000)}`;
      if (out[key]) continue;
      jobs.push(new Promise<void>((resolve) => {
        const image = new Image();
        image.onload = () => {
          const width = 800;
          const height = Math.max(80, Math.round(width / ratio));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, width, height);
            // The SVG itself uses preserveAspectRatio="xMidYMid meet". Give
            // it the exact export frame so the browser performs the same
            // contain calculation as the editor's inline SVG renderer.
            ctx.drawImage(image, 0, 0, width, height);
            out[key] = canvas.toDataURL("image/png");
          }
          resolve();
        };
        image.onerror = () => resolve();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(assetToSvg(asset, color, assetStyle))}`;
      }));
    }
  }
  await Promise.all(jobs);
  return out;
}

/** Captures the actual element canvas so exports match the editor pixel-for-pixel. */
async function captureElementSlideImages(deck: any, chartImages: Record<string, string>): Promise<Record<string, string>> {
  const rawSlides = deck.slides as StoredSlide[];
  if (!rawSlides.some((slide) => Array.isArray(slide.elements) && slide.elements.length > 0)) return {};
  const themeRaw = deck.theme ?? {};
  const restored = inlineImages(
    rawSlides as unknown as { elements?: { src?: string | null }[] }[],
    (themeRaw.library_images ?? []) as { data_url: string }[],
    themeRaw.images,
  );
  const elementSlides = toElementSlides(restored.slides as unknown as StoredSlide[], themeRaw.template_id ?? "editorial", {
    companyName: deck.name,
  });
  const theme = buildTheme({
    ink: themeRaw.secondary_color || "#161412",
    paper: "#faf8f3",
    accent: themeRaw.primary_color || "#b8860b",
    fontPairing: themeRaw.font_pairing || "fraunces-inter",
    typeScale: themeRaw.type_scale || 1,
  });
  loadFontPairing(themeRaw.font_pairing || "fraunces-inter");
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-99999px;top:-99999px;width:1280px;height:720px;";
  document.body.appendChild(container);
  const results: Record<string, string> = {};
  try {
    for (const slide of elementSlides) {
      const chartElements = slide.elements.filter((el) => el.type === "chart");
      if (chartElements.some((el) => !chartImages[el.id])) continue;
      const slideDiv = document.createElement("div");
      slideDiv.style.cssText = "width:1280px;height:720px;background:transparent;";
      container.appendChild(slideDiv);
      const root = createRoot(slideDiv);
      root.render(
        <SlideCanvas
          slide={slide}
          theme={theme}
          interactive={false}
          onChange={() => undefined}
          renderChart={(el) => chartImages[el.id] ? <img src={chartImages[el.id]} alt="" style={{ width: "100%", height: "100%" }} /> : null}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (document.fonts?.ready) await document.fonts.ready;
      try {
        const canvas = await html2canvas(slideDiv, { width: 1280, height: 720, scale: 1, backgroundColor: null });
        results[slide.id] = canvas.toDataURL("image/png");
      } catch {
        // Fall back to the vector exporter for this slide.
      }
      root.unmount();
      container.removeChild(slideDiv);
    }
  } finally {
    document.body.removeChild(container);
  }
  return results;
}

export function DownloadMenu({ deckId }: { deckId: string }) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadStage, setDownloadStage] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleDownload(format: "pptx" | "pdf") {
    setDownloading(true);
    setError(null);
    setOpen(false);
    try {
      // Export always reflects the deck's last SAVED state, not unsaved
      // edits sitting in the editor, so we fetch fresh from the backend
      // rather than reusing whatever slides happen to be in memory here.
      setDownloadStage("Loading deck...");
      const deck = await getDeck(deckId);

      setDownloadStage("Rendering charts...");
      const chartImages = await captureChartImages(deck.slides);
      const assetImages = await captureAssetImages(deck);
      const slideImages = await captureElementSlideImages(deck, chartImages);

      setDownloadStage("Generating file...");
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
      const res = await fetch(`${API_BASE}/decks/${deckId}/export`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ format, chart_images: chartImages, asset_images: assetImages, slide_images: slideImages }),
      });
      if (res.status === 402) {
        // Payment required: hand the plans back so the caller can show the
        // paywall rather than a generic failure message.
        const body = await res.json().catch(() => ({}));
        const detail = body?.detail ?? {};
        const { PaymentRequiredError } = await import("./api");
        throw new PaymentRequiredError(
          detail.message ?? "Exporting requires a plan.",
          detail.plans ?? [],
        );
      }
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+)"/);
      a.download = match ? match[1] : `deck.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't download this deck.");
    } finally {
      setDownloading(false);
      setDownloadStage("");
    }
  }

  return (
    <div className="download-menu-wrap">
      <button className="p-btn p-btn-secondary" onClick={() => setOpen((o) => !o)} disabled={downloading}>
        {downloading ? downloadStage || "Downloading..." : "Download"}
      </button>
      {open && (
        <div className="download-menu">
          <button onClick={() => handleDownload("pptx")}>PowerPoint (.pptx)</button>
          <button onClick={() => handleDownload("pdf")}>PDF</button>
        </div>
      )}
      {error && <span className="p-error download-menu-error">{error}</span>}
    </div>
  );
}

function OverviewCard({
  slide,
  index,
  theme,
  canDelete,
  onOpen,
  onDelete,
  templateId,
  schemeId,
}: {
  slide: DeckSlide;
  index: number;
  theme: DeckTheme | null;
  canDelete: boolean;
  onOpen: () => void;
  onDelete: () => void;
  templateId?: string;
  schemeId?: string;
}) {
  return (
    <div className="overview-card" onClick={onOpen}>
      <div className="overview-card-slide">
        <DesignedSlide
          slide={slide}
          theme={theme}
          pageNumber={index + 1}
          templateId={templateId}
          schemeId={schemeId}
        />
      </div>
      <div className="overview-card-footer">
        <span>
          {index + 1}. {slide.title}
        </span>
        {canDelete && (
          <button
            className="overview-card-delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
