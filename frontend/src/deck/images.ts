import { compressImage } from "../fileUtils";

/**
 * Image handling for slides.
 *
 * The previous behaviour was a bare `objectFit: cover`, which crops from the
 * centre. That is wrong most of the time: a product screenshot's meaningful
 * area is usually the top, a portrait's is the face, a wide diagram's is a
 * specific region. Centre-cropping silently cuts the subject out and the
 * founder has no way to fix it short of re-editing the file elsewhere.
 *
 * So an image element carries a focal point and a zoom, and the renderer
 * derives object-position from them. Nothing is destructive: the original
 * data URL is untouched and the crop is presentation only, so it can be
 * changed at any time and re-derived at export.
 */

export interface ImageCrop {
  /** Focal point as proportions of the image, 0–1. Default is centre. */
  focusX: number;
  focusY: number;
  /** 1 = fit the frame exactly. Above 1 zooms in around the focal point. */
  zoom: number;
}

export const DEFAULT_CROP: ImageCrop = { focusX: 0.5, focusY: 0.5, zoom: 1 };

export type ImageTreatment =
  | "none"
  | "grayscale"
  | "duotone"
  | "soft"
  | "high-contrast"
  | "muted";

export const TREATMENTS: { id: ImageTreatment; name: string; note: string }[] = [
  { id: "none", name: "As uploaded", note: "No processing." },
  { id: "grayscale", name: "Greyscale", note: "Removes colour so the image doesn't fight the palette." },
  { id: "duotone", name: "Duotone", note: "Hard black and white. Strong, graphic, works for portraits." },
  { id: "soft", name: "Soft", note: "Slightly lifted and desaturated. Recedes behind text." },
  { id: "high-contrast", name: "Punchy", note: "More contrast and saturation. For product shots." },
  { id: "muted", name: "Muted", note: "Low saturation, low contrast. For background imagery." },
];

/** CSS filter for a treatment. Applied at render and reproduced at export. */
export function treatmentFilter(treatment: ImageTreatment | undefined): string | undefined {
  switch (treatment) {
    case "grayscale": return "grayscale(1)";
    case "duotone": return "grayscale(1) contrast(1.45) brightness(1.05)";
    case "soft": return "saturate(0.7) brightness(1.06) contrast(0.94)";
    case "high-contrast": return "contrast(1.18) saturate(1.15)";
    case "muted": return "saturate(0.45) contrast(0.9) brightness(1.04)";
    default: return undefined;
  }
}

/**
 * Converts a focal point into CSS object-position.
 *
 * object-position takes the percentage of the *overflow* to shift, not of
 * the image, so a focal point at 0.5 maps to 50% and the ends map cleanly
 * to 0% and 100%. Passing the raw focal proportion through works because
 * of that correspondence, which is why this looks deceptively simple.
 */
export function objectPosition(crop: ImageCrop | undefined): string {
  const c = crop ?? DEFAULT_CROP;
  return `${Math.round(c.focusX * 100)}% ${Math.round(c.focusY * 100)}%`;
}

/** Transform for zoom, applied inside a clipping frame. */
export function zoomTransform(crop: ImageCrop | undefined): string | undefined {
  const z = crop?.zoom ?? 1;
  return z === 1 ? undefined : `scale(${z})`;
}

/* ------------------------------------------------------------------ */
/* Tags: where an image belongs in a deck                              */
/* ------------------------------------------------------------------ */

export type ImageTag =
  | "logo"
  | "product"
  | "team"
  | "customer"
  | "diagram"
  | "background"
  | "press"
  | "partner"
  | "other";

export const IMAGE_TAGS: { id: ImageTag; name: string; placement: string }[] = [
  { id: "logo", name: "Logo", placement: "Appears in the corner of every slide and on the cover." },
  { id: "product", name: "Product", placement: "Solution and product slides, and any split layout." },
  { id: "team", name: "Team photo", placement: "Matched to a team member by name." },
  { id: "customer", name: "Customer or user", placement: "Problem and traction slides." },
  { id: "diagram", name: "Diagram or architecture", placement: "Technology and solution slides." },
  { id: "background", name: "Background", placement: "Full-bleed covers and section breaks." },
  { id: "press", name: "Press or award", placement: "Traction slides." },
  { id: "partner", name: "Partner logo", placement: "Partner rows and traction slides." },
  { id: "other", name: "Other", placement: "Not placed automatically; drag it where you want." },
];

export interface BrandImage {
  id: string;
  data_url: string;
  tag: ImageTag;
  /** Optional caption or alt text the founder supplied. */
  label?: string;
  crop?: ImageCrop;
  treatment?: ImageTreatment;
  /** Natural dimensions, measured on upload, used to preserve aspect ratio. */
  width?: number;
  height?: number;
}

/**
 * Suggests which slide kinds an image suits, from its tag.
 *
 * This drives automatic placement during generation. It is a suggestion:
 * the founder can drag any image anywhere, and an image that has been
 * hand-placed is never moved by a regeneration.
 */
export function slideKindsForTag(tag: ImageTag): string[] {
  switch (tag) {
    case "product": return ["solution", "product", "technology"];
    case "customer": return ["problem", "traction"];
    case "diagram": return ["technology", "solution"];
    case "background": return ["cover", "custom"];
    case "press": return ["traction"];
    case "partner": return ["traction", "business_model"];
    case "team": return ["team"];
    default: return [];
  }
}

/**
 * Measures an image file and returns a brand image record.
 *
 * Dimensions matter because a 3:1 banner and a 1:1 headshot need different
 * frames; placing both into an identical box is a large part of why
 * auto-placed imagery usually looks wrong.
 */
export async function readImageFile(file: File): Promise<{ data_url: string; width: number; height: number }> {
  const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    img.onload = () => {
      cleanup();
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      cleanup();
      reject(new Error("That file doesn't appear to be an image."));
    };
    img.src = url;
  });
  return { data_url: await compressImage(file), width, height };
}

/**
 * Downscales an image before it is stored.
 *
 * Deck data is persisted as JSON with images inline as data URLs, so a few
 * unscaled phone photos can push a deck into the megabytes and make every
 * save slow. Slides are 1280px wide, so anything beyond about 1600px is
 * invisible detail that costs real time on every read and write.
 */
export async function downscale(dataUrl: string, maxEdge = 1600, quality = 0.85): Promise<string> {
  const img = await loadImage(dataUrl);
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (longest <= maxEdge) return dataUrl;

  const scale = maxEdge / longest;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // PNGs with transparency must stay PNG; everything else compresses better
  // as JPEG, and logos are the main case where transparency matters.
  const isPng = dataUrl.startsWith("data:image/png");
  return canvas.toDataURL(isPng ? "image/png" : "image/jpeg", quality);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't load image."));
    img.src = src;
  });
}

/**
 * Bakes crop, zoom, and treatment into a new image.
 *
 * Used at export, where CSS filters and object-position don't exist. The
 * result is exactly what the editor showed, which is the whole point: a
 * deck that exports differently from how it previewed is not trustworthy.
 */
export async function renderCropped(
  dataUrl: string,
  frameW: number,
  frameH: number,
  crop: ImageCrop | undefined,
  treatment: ImageTreatment | undefined,
): Promise<string> {
  const img = await loadImage(dataUrl);
  const c = crop ?? DEFAULT_CROP;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(frameW);
  canvas.height = Math.round(frameH);
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;

  const filter = treatmentFilter(treatment);
  if (filter) ctx.filter = filter;

  // Cover fit: scale so the image fills the frame, then offset by the focal
  // point across whatever overflows.
  const frameRatio = frameW / frameH;
  const imgRatio = img.naturalWidth / img.naturalHeight;
  let drawW: number, drawH: number;
  if (imgRatio > frameRatio) {
    drawH = frameH * c.zoom;
    drawW = drawH * imgRatio;
  } else {
    drawW = frameW * c.zoom;
    drawH = drawW / imgRatio;
  }

  const dx = -(drawW - frameW) * c.focusX;
  const dy = -(drawH - frameH) * c.focusY;
  ctx.drawImage(img, dx, dy, drawW, drawH);

  return canvas.toDataURL("image/jpeg", 0.9);
}
