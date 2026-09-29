import { useEffect, useMemo, useState, type ReactNode } from "react";
import SlideCanvas from "./deck/SlideCanvas";
import { searchLibrary, instantiate, LIBRARY_INDUSTRIES, normaliseIndustry, type LibraryItem } from "./deck/library";
import {
  buildTheme, loadFontPairing, contrastRatio, FONT_PAIRINGS,
  type ThemeSettings,
} from "./deck/theme";
import {
  CANVAS_W, CANVAS_H, makeElement,
  type ElementSlide, type SlideElement,
} from "./deck/elements";
import { COMPOSERS } from "./deck/composers";
import ImageLibrary from "./ImageLibrary";
import { DEFAULT_CROP, type BrandImage } from "./deck/images";
import { ASSET_CATEGORIES, searchAssets, assetToSvg, type AssetCategory } from "./deck/assets";
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

type Panel = "template" | "theme" | "library" | "assets" | "images" | "element";

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
}

export default function DeckStudio({
  slides, current, themeSettings, templateId, industry,
  images = [], onImagesChange,
  onSlidesChange, onThemeChange, onTemplateChange, onCurrentChange,
  renderChart,
}: DeckStudioProps) {
  const [panel, setPanel] = useState<Panel>("template");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [assetQuery, setAssetQuery] = useState("");
  const [industryFilter, setIndustryFilter] = useState<string | null>(() => normaliseIndustry(industry));
  const [assetCat, setAssetCat] = useState<AssetCategory | "all">("all");

  const theme = useMemo(() => buildTheme(themeSettings), [themeSettings]);



  useEffect(() => {
    loadFontPairing(themeSettings.fontPairing);
  }, [themeSettings.fontPairing]);

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

  const contrast = contrastRatio(themeSettings.ink, themeSettings.paper);
  const accentContrast = contrastRatio(themeSettings.accent, themeSettings.paper);

  if (!slide) return <p className="dst-empty">No slides yet.</p>;

  return (
    <div className="dst">
      <div className="dst-stage">
        <div className="dst-canvas-area"><div
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
            insertImage(img, {
              x: Math.round((e.clientX - rect.left) / scale) - 120,
              y: Math.round((e.clientY - rect.top) / scale) - 80,
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
            onSelectionChange={(ids, activeId) => {
              setSelectedIds(ids);
              setSelectedId(activeId);
            }}
          />
        </div>

        </div>
        <div className="dst-filmstrip">
          {slides.map((s, i) => (
            <button
              key={s.id}
              className={`dst-thumb ${i === current ? "is-active" : ""}`}
              onClick={() => { onCurrentChange(i); setSelectedId(null); setSelectedIds(new Set()); }}
            >
              <span className="dst-thumb-num">{i + 1}</span>
              <span className="dst-thumb-title">{s.title}</span>
              {s.customized && <span className="dst-thumb-dot" title="Hand-edited" />}
            </button>
          ))}
        </div>
      </div>

      <aside className="dst-panel">
        <nav className="dst-tabs">
          {(["template", "theme", "assets", "library", "images", "element"] as Panel[]).map((p) => (
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
                  <input
                    type="color"
                    value={themeSettings[k]}
                    onChange={(e) => onThemeChange({ ...themeSettings, [k]: e.target.value })}
                  />
                  <code>{themeSettings[k]}</code>
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

            <h4>Scale</h4>
            {/* Page background colour */}
            <div className="dst-field">
              <span style={{fontSize:'0.76rem',color:'var(--text-dim)'}}>Page background</span>
              <div className="dst-bg-swatches">
                {[
                  { label:'Cream', value:'#F8F5EE' },
                  { label:'White', value:'#FFFFFF' },
                  { label:'Near-black', value:'#12100E' },
                  { label:'Slate', value:'#1C2533' },
                  { label:'Forest', value:'#1B2E22' },
                  { label:'Burgundy', value:'#2A1218' },
                  { label:'Custom', value:'custom' },
                ].map(({label,value}) => (
                  <button key={value}
                    className={`dst-bg-swatch ${(themeSettings as any).pageBackground === value ? 'is-active' : ''}`}
                    style={{background: value === 'custom' ? 'linear-gradient(135deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f)' : value}}
                    title={label}
                    onClick={() => onThemeChange({...themeSettings, pageBackground: value} as any)}
                  />
                ))}
              </div>
              {(themeSettings as any).pageBackground === 'custom' && (
                <input type="color" className="p-input"
                  value={(themeSettings as any).pageBackgroundCustom ?? '#F8F5EE'}
                  onChange={e => onThemeChange({...themeSettings, pageBackground:'custom', pageBackgroundCustom: e.target.value} as any)}
                />
              )}
            </div>

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

        {panel === "element" && selected && (
          <section className="dst-section">
            <h4>{selected.type}</h4>

            {selected.text !== undefined && (
              <label className="dst-field">
                <span>Text</span>
                <textarea
                  className="p-input" rows={4}
                  value={selected.text}
                  onChange={(e) => patchSelected({ text: e.target.value })}
                />
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
