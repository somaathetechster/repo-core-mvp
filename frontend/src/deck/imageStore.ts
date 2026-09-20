/**
 * Content-addressed image storage.
 *
 * Images were embedded as full data URLs directly on every element that used
 * them, and then a second copy was kept for the library. A five-person team
 * slide therefore carried ten copies of five photos, and the deck grew to
 * several megabytes — large enough that saving failed and the deck list
 * stopped loading at all.
 *
 * Here each distinct image is stored once in a deck-level map keyed by a
 * hash of its contents, and everything else refers to it by that key. The
 * same photo used on three slides costs one copy. Because the key is derived
 * from the bytes, deduplication is automatic: re-uploading the same file
 * produces the same key rather than a second copy.
 */

export type ImageMap = Record<string, string>;

const REF_PREFIX = "ref:";

/**
 * A fast non-cryptographic hash. Collisions only need to be improbable
 * within one deck's handful of images, not cryptographically impossible,
 * and this runs synchronously over a multi-megabyte string without
 * blocking meaningfully.
 */
export function hashImage(dataUrl: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < dataUrl.length; i++) {
    const c = dataUrl.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 13);
  }
  const a = (h1 >>> 0).toString(36);
  const b = (h2 >>> 0).toString(36);
  return `${a}${b}${dataUrl.length.toString(36)}`;
}

export function isRef(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(REF_PREFIX);
}

export function refKey(value: string): string {
  return value.slice(REF_PREFIX.length);
}

export function makeRef(key: string): string {
  return `${REF_PREFIX}${key}`;
}

/** Stores an image and returns the reference to use in its place. */
export function put(map: ImageMap, dataUrl: string): string {
  if (isRef(dataUrl)) return dataUrl;
  const key = hashImage(dataUrl);
  if (!map[key]) map[key] = dataUrl;
  return makeRef(key);
}

/** Resolves a reference back to its data URL, for rendering and export. */
export function resolve(map: ImageMap | undefined, value: string | null | undefined): string | null {
  if (!value) return null;
  if (!isRef(value)) return value;
  return map?.[refKey(value)] ?? null;
}

/* ------------------------------------------------------------------ */

type AnySlide = {
  elements?: { src?: string | null; [k: string]: unknown }[];
  image_data_url?: string | null;
  team_members?: { photo_data_url?: string; [k: string]: unknown }[] | null;
  [k: string]: unknown;
};

/**
 * Walks a deck, moving every inline image into the map and replacing it
 * with a reference. Called once before saving.
 */
export function extractImages(
  slides: AnySlide[],
  libraryImages: { data_url: string; [k: string]: unknown }[],
  existing: ImageMap = {},
): { slides: AnySlide[]; library: { data_url: string; [k: string]: unknown }[]; images: ImageMap } {
  const map: ImageMap = { ...existing };

  const nextSlides = slides.map((slide) => {
    const next: AnySlide = { ...slide };

    if (Array.isArray(slide.elements)) {
      next.elements = slide.elements.map((el) =>
        typeof el.src === "string" && el.src
          ? { ...el, src: put(map, el.src) }
          : el,
      );
    }
    if (typeof slide.image_data_url === "string" && slide.image_data_url) {
      next.image_data_url = put(map, slide.image_data_url);
    }
    if (Array.isArray(slide.team_members)) {
      next.team_members = slide.team_members.map((m) =>
        typeof m.photo_data_url === "string" && m.photo_data_url
          ? { ...m, photo_data_url: put(map, m.photo_data_url) }
          : m,
      );
    }
    return next;
  });

  const nextLibrary = libraryImages.map((img) => ({ ...img, data_url: put(map, img.data_url) }));

  // Drop anything nothing points at any more, so deleting an image actually
  // reclaims its space instead of leaving it in the deck forever.
  const used = new Set<string>();
  const note = (v: unknown) => { if (typeof v === "string" && isRef(v)) used.add(refKey(v)); };
  for (const s of nextSlides) {
    note(s.image_data_url);
    (s.elements ?? []).forEach((e) => note(e.src));
    (s.team_members ?? []).forEach((m) => note(m.photo_data_url));
  }
  nextLibrary.forEach((i) => note(i.data_url));

  const pruned: ImageMap = {};
  for (const key of used) if (map[key]) pruned[key] = map[key];

  return { slides: nextSlides, library: nextLibrary, images: pruned };
}

/**
 * The inverse, called after loading: puts the real data URLs back so the
 * rest of the app never has to know references exist.
 */
export function inlineImages(
  slides: AnySlide[],
  libraryImages: { data_url: string; [k: string]: unknown }[],
  map: ImageMap | undefined,
): { slides: AnySlide[]; library: { data_url: string; [k: string]: unknown }[] } {
  if (!map) return { slides, library: libraryImages };

  const nextSlides = slides.map((slide) => {
    const next: AnySlide = { ...slide };
    if (Array.isArray(slide.elements)) {
      next.elements = slide.elements.map((el) =>
        isRef(el.src as string) ? { ...el, src: resolve(map, el.src as string) } : el,
      );
    }
    if (isRef(slide.image_data_url)) {
      next.image_data_url = resolve(map, slide.image_data_url);
    }
    if (Array.isArray(slide.team_members)) {
      next.team_members = slide.team_members.map((m) =>
        isRef(m.photo_data_url as string)
          ? { ...m, photo_data_url: resolve(map, m.photo_data_url as string) ?? "" }
          : m,
      );
    }
    return next;
  });

  const nextLibrary = libraryImages.map((img) =>
    isRef(img.data_url) ? { ...img, data_url: resolve(map, img.data_url) ?? "" } : img,
  );

  return { slides: nextSlides, library: nextLibrary };
}

/** Rough serialized size, for warning before a save is too large to send. */
export function mapBytes(map: ImageMap | undefined): number {
  if (!map) return 0;
  return Object.values(map).reduce((n, v) => n + v.length, 0);
}
