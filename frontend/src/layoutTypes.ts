import type { DeckSlide } from "./api";

// Freeform layout is entirely frontend state, not persisted to the backend
// yet (same caveat as the rest of the deck editor: it lives only in this
// browser tab until deck persistence/export is built). One LayoutElement
// per editable piece of a slide: the title, each text block, and the image
// if present.
export interface LayoutElement {
  id: string;
  kind: "title" | "block" | "image";
  refIndex?: number; // index into slide.blocks, only set for kind === "block"
  x: number;
  y: number;
  width: number;
  height: number;
}

export const STAGE_WIDTH = 960;
export const STAGE_HEIGHT = 540;

/**
 * Generates a reasonable starting layout matching how the slide currently
 * renders in the normal (non-freeform) stacked view, so switching into
 * freeform mode doesn't dump the user onto a blank canvas.
 */
export function defaultLayoutForSlide(slide: DeckSlide): LayoutElement[] {
  const elements: LayoutElement[] = [];
  let y = 48;

  elements.push({ id: "title", kind: "title", x: 48, y, width: STAGE_WIDTH - 96, height: 70 });
  y += 90;

  if (slide.image_data_url && slide.type !== "cover") {
    elements.push({ id: "image", kind: "image", x: 48, y, width: STAGE_WIDTH - 96, height: 180 });
    y += 200;
  }

  slide.blocks.forEach((_, i) => {
    elements.push({
      id: `block-${i}`,
      kind: "block",
      refIndex: i,
      x: 48,
      y,
      width: STAGE_WIDTH - 96,
      height: 90,
    });
    y += 100;
  });

  if (slide.type === "cover" && slide.image_data_url) {
    // Cover logo sits above the title in the stacked view; give freeform a
    // sensible equivalent rather than reusing the generic image slot above.
    elements.unshift({ id: "image", kind: "image", x: STAGE_WIDTH / 2 - 60, y: 40, width: 120, height: 120 });
    elements[1].y = 180; // push title down below the logo
  }

  return elements;
}
