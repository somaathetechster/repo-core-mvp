import { useRef, useState } from "react";
import {
  IMAGE_TAGS, TREATMENTS, DEFAULT_CROP, readImageFile, downscale,
  treatmentFilter, objectPosition,
  type BrandImage, type ImageTag, type ImageTreatment,
} from "./deck/images";
import "./image-library.css";

/**
 * The image library.
 *
 * Images were previously upload-and-forget: tagged in the profile form,
 * never visible in the deck editor, never placeable. Here they live beside
 * the canvas, are dragged onto slides, and carry a crop and a treatment
 * that the founder controls, because the default centre-crop is wrong for
 * most real images.
 */
export default function ImageLibrary({
  images,
  onChange,
  onInsert,
}: {
  images: BrandImage[];
  onChange: (images: BrandImage[]) => void;
  /** Places an image on the current slide. */
  onInsert: (image: BrandImage) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState<ImageTag | "all">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const shown = filter === "all" ? images : images.filter((i) => i.tag === filter);
  const active = images.find((i) => i.id === editing) ?? null;

  async function addFiles(files: FileList) {
    setBusy(true);
    setError(null);
    try {
      const added: BrandImage[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const { data_url, width, height } = await readImageFile(file);
        // Downscale on the way in: deck data is JSON with images inline,
        // so full-size phone photos make every save slow.
        const scaled = await downscale(data_url);
        added.push({
          id: `img-${Date.now()}-${added.length}`,
          data_url: scaled,
          tag: guessTag(file.name, width, height),
          label: file.name.replace(/\.[^.]+$/, ""),
          crop: { ...DEFAULT_CROP },
          treatment: "none",
          width,
          height,
        });
      }
      if (added.length === 0) setError("No images found in that selection.");
      else onChange([...images, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add those images.");
    } finally {
      setBusy(false);
    }
  }

  function patch(id: string, changes: Partial<BrandImage>) {
    onChange(images.map((i) => (i.id === id ? { ...i, ...changes } : i)));
  }

  return (
    <div className="il">
      <div className="il-actions">
        <button className="p-btn p-btn-secondary il-add" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "Adding…" : "+ Add images"}
        </button>
        <input
          ref={fileRef} type="file" accept="image/*" multiple hidden
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
      </div>

      {error && <p className="p-error">{error}</p>}

      <div className="il-filters">
        <button className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>
          All ({images.length})
        </button>
        {IMAGE_TAGS.filter((t) => images.some((i) => i.tag === t.id)).map((t) => (
          <button key={t.id} className={filter === t.id ? "is-active" : ""} onClick={() => setFilter(t.id)}>
            {t.name}
          </button>
        ))}
      </div>

      {images.length === 0 && (
        <p className="il-empty">
          No images yet. Product screenshots, team photos, and diagrams do more for a deck than any
          layout choice, so this is worth filling.
        </p>
      )}

      <div className="il-grid">
        {shown.map((img) => (
          <div
            key={img.id}
            className={`il-item ${editing === img.id ? "is-editing" : ""}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-provisio-image", img.id);
              e.dataTransfer.effectAllowed = "copy";
            }}
          >
            <button className="il-thumb" onClick={() => onInsert(img)} title="Click to place on this slide, or drag onto the canvas">
              <img
                src={img.data_url}
                alt={img.label ?? ""}
                style={{
                  objectPosition: objectPosition(img.crop),
                  filter: treatmentFilter(img.treatment),
                }}
              />
            </button>
            <div className="il-meta">
              <span className="il-tag">{IMAGE_TAGS.find((t) => t.id === img.tag)?.name}</span>
              <button className="il-edit" onClick={() => setEditing(editing === img.id ? null : img.id)}>
                {editing === img.id ? "Close" : "Adjust"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {active && (
        <div className="il-editor">
          <h4>{active.label || "Image"}</h4>

          <CropPreview
            image={active}
            onFocus={(focusX, focusY) =>
              patch(active.id, { crop: { ...(active.crop ?? DEFAULT_CROP), focusX, focusY } })
            }
          />
          <p className="il-hint">Click the preview to set what stays in frame when the image is cropped.</p>

          <label className="il-field">
            <span>Zoom</span>
            <input
              type="range" min={1} max={2.5} step={0.05}
              value={active.crop?.zoom ?? 1}
              onChange={(e) =>
                patch(active.id, { crop: { ...(active.crop ?? DEFAULT_CROP), zoom: parseFloat(e.target.value) } })
              }
            />
            <em>{Math.round((active.crop?.zoom ?? 1) * 100)}%</em>
          </label>

          <label className="il-field il-field-stack">
            <span>Treatment</span>
            <div className="il-treatments">
              {TREATMENTS.map((t) => (
                <button
                  key={t.id}
                  className={(active.treatment ?? "none") === t.id ? "is-active" : ""}
                  onClick={() => patch(active.id, { treatment: t.id as ImageTreatment })}
                  title={t.note}
                >
                  <img src={active.data_url} alt="" style={{ filter: treatmentFilter(t.id) }} />
                  <em>{t.name}</em>
                </button>
              ))}
            </div>
          </label>

          <label className="il-field il-field-stack">
            <span>Where this belongs</span>
            <select
              className="p-input"
              value={active.tag}
              onChange={(e) => patch(active.id, { tag: e.target.value as ImageTag })}
            >
              {IMAGE_TAGS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <em className="il-placement">{IMAGE_TAGS.find((t) => t.id === active.tag)?.placement}</em>
          </label>

          <label className="il-field il-field-stack">
            <span>Label</span>
            <input
              className="p-input"
              value={active.label ?? ""}
              onChange={(e) => patch(active.id, { label: e.target.value })}
            />
          </label>

          <div className="il-editor-actions">
            <button className="p-btn p-btn-secondary" onClick={() => onInsert(active)}>
              Place on this slide
            </button>
            <button
              className="il-delete"
              onClick={() => {
                if (!window.confirm("Remove this image from your library?")) return;
                onChange(images.filter((i) => i.id !== active.id));
                setEditing(null);
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Click-to-set focal point, shown over the real image. */
function CropPreview({
  image, onFocus,
}: {
  image: BrandImage;
  onFocus: (x: number, y: number) => void;
}) {
  const crop = image.crop ?? DEFAULT_CROP;
  return (
    <div
      className="il-crop"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onFocus(
          Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
          Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
        );
      }}
    >
      <img src={image.data_url} alt="" style={{ filter: treatmentFilter(image.treatment) }} />
      <span
        className="il-focus"
        style={{ left: `${crop.focusX * 100}%`, top: `${crop.focusY * 100}%` }}
      />
    </div>
  );
}

/**
 * Guesses a tag from the filename and shape, so a bulk upload isn't
 * twenty dropdowns. Wrong guesses are one click to fix; no guess at all
 * means the founder does the work every time.
 */
function guessTag(filename: string, width: number, height: number): ImageTag {
  const n = filename.toLowerCase();
  if (/logo|mark|wordmark|brand/.test(n)) return "logo";
  if (/team|founder|headshot|portrait|staff|ceo|cto/.test(n)) return "team";
  if (/screen|product|app|ui|dashboard|mockup/.test(n)) return "product";
  if (/diagram|arch|flow|system|chart/.test(n)) return "diagram";
  if (/press|award|feature|news/.test(n)) return "press";
  if (/partner|client|customer/.test(n)) return "partner";
  const ratio = width / height;
  // A near-square small image is usually a headshot or a logo; a very wide
  // one is usually a banner or screenshot.
  if (ratio > 2.2) return "background";
  if (ratio > 0.9 && ratio < 1.15 && width < 800) return "team";
  return "product";
}
