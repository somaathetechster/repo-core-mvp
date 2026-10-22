/**
 * Compresses a user-uploaded image before it is stored in application state.
 * Deck and profile images are persisted inline, so keeping the original
 * camera-sized file makes saves unnecessarily large and slow.
 */
export function compressImage(file: File, maxWidth = 1200, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ratio = Math.min(1, maxWidth / img.width);
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        cleanup();
        reject(new Error("Couldn't process that image."));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      cleanup();
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      cleanup();
      reject(new Error("That file doesn't appear to be an image."));
    };
    img.src = url;
  });
}

// Images are stored as base64 in Postgres for now (see the backend model's
// docstring). Keep a sane cap so a single upload can't bloat a row or the
// request body; this is a pragmatic MVP limit, not a hard product decision.
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB

// Samples the image's pixels on a small offscreen canvas and returns the
// single most common color as a hex string. This is a rough heuristic
// (most-frequent-pixel, not true dominant-color clustering), good enough to
// suggest a starting brand color from a logo without pulling in a color
// extraction library. Near-white and near-black pixels are excluded, since
// logos often have a transparent/white background that would otherwise
// dominate the count.
export function extractDominantColor(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 50; // downsample for speed; we only need an estimate
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, size, size);
      let data: Uint8ClampedArray;
      try {
        data = ctx.getImageData(0, 0, size, size).data;
      } catch {
        resolve(null); // canvas tainted by cross-origin data, shouldn't happen for local uploads
        return;
      }

      const counts = new Map<string, number>();
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        if (a < 128) continue; // skip transparent pixels
        const brightness = (r + g + b) / 3;
        if (brightness > 240 || brightness < 15) continue; // skip near-white/black
        // Bucket into steps of 24 to group near-identical colors together
        const key = `${Math.round(r / 24) * 24},${Math.round(g / 24) * 24},${Math.round(b / 24) * 24}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }

      let best: string | null = null;
      let bestCount = 0;
      for (const [key, count] of counts) {
        if (count > bestCount) {
          best = key;
          bestCount = count;
        }
      }
      if (!best) {
        resolve(null);
        return;
      }
      const [r, g, b] = best.split(",").map(Number);
      const hex = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
      resolve(hex);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
