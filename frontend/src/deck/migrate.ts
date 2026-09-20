/**
 * Migration between the legacy document-shaped slide and the element model.
 *
 * Existing decks are stored as {title, blocks[], image, chart}. They have to
 * keep opening, so this converts them into element slides on load by running
 * them through the active template's composer, and converts back on save so
 * the backend, the exporter, and the table of contents keep working while
 * the rest of the system catches up.
 *
 * The round trip is deliberately lossy in one direction only: hand-positioned
 * element slides carry their full layout in `elements`, and the legacy fields
 * are kept alongside as a readable summary rather than the source of truth.
 */
import { compose, type SlideContentInput } from "./composers";
import {
  inferKind, elementId,
  type ElementSlide, type LegacySlide, type SlideElement, type SlideKind,
} from "./elements";

export interface StoredSlide extends LegacySlide {
  /** Present once a slide has been through the element system. */
  elements?: SlideElement[];
  kind?: SlideKind;
  background?: "paper" | "ink" | "accent" | null;
  customized?: boolean;
}

/**
 * Turns a stored slide into an element slide.
 *
 * If the slide already carries elements and the user has hand-edited it, its
 * layout is preserved exactly. Otherwise it is recomposed with the current
 * template, which is what makes template switching actually restructure a
 * deck rather than only restyling it.
 */
export function toElementSlide(
  stored: StoredSlide,
  templateId: string,
  context: {
    logo?: string | null;
    companyName?: string;
    pageNumber?: number;
    totalPages?: number;
  } = {},
): ElementSlide {
  if (stored.customized && stored.elements && stored.elements.length > 0) {
    return {
      id: stored.id,
      kind: stored.kind ?? inferKind(stored),
      title: stored.title,
      elements: stored.elements,
      background: stored.background ?? "paper",
      customized: true,
    };
  }

  const content: SlideContentInput = {
    kind: stored.kind ?? inferKind(stored),
    title: stored.title,
    paragraphs: (stored.blocks ?? []).map((b) => ({ text: b.text, source: b.source })),
    image: stored.image_data_url,
    chart: stored.chart ?? null,
    team: stored.team_members,
    contents: stored.toc_entries,
    logo: context.logo ?? null,
    companyName: context.companyName,
    pageNumber: context.pageNumber,
    totalPages: context.totalPages,
  };

  const composed = compose(templateId, content);
  // Keep the original id so slide ordering, selection, and deck references
  // survive a recompose.
  return { ...composed, id: stored.id };
}

export function toElementSlides(
  stored: StoredSlide[],
  templateId: string,
  context: { logo?: string | null; companyName?: string } = {},
): ElementSlide[] {
  return stored.map((s, i) =>
    toElementSlide(s, templateId, {
      ...context,
      pageNumber: i + 1,
      totalPages: stored.length,
    }),
  );
}

/**
 * Converts back for storage. The legacy fields are regenerated from the
 * elements so anything still reading them (export, the contents page,
 * regeneration) sees current content.
 */
export function toStoredSlide(slide: ElementSlide, previous?: StoredSlide): StoredSlide {
  // Content is the source of truth, not the rendered elements.
  //
  // This previously rebuilt `blocks` by collecting every text element on the
  // slide, which destroyed the deck on every template switch: a team slide's
  // member names became paragraphs, and a Dossier then rendered them as
  // findings rows. Worse, it compounded, absorbing the template's own labels
  // ("VERDICT", "#") as the founder's content after two or three switches.
  //
  // A slide that has not been hand-edited carries its original content
  // through untouched. Only a slide the user actually edited derives its
  // blocks from elements, and even then template chrome is excluded.
  const chartElement = slide.elements.find((e) => e.type === "chart" && e.chart);
  const imageElement = slide.elements.find((e) => e.type === "image" && e.src && !e.locked);

  const base: StoredSlide = {
    id: slide.id,
    type: previous?.type ?? legacyTypeFor(slide.kind),
    title: slide.title,
    blocks: previous?.blocks ?? [],
    image_data_url: imageElement?.src ?? previous?.image_data_url ?? null,
    // Structured content belongs to the slide, never to the rendering. It is
    // carried through every switch so a template that displays it differently
    // cannot consume it.
    team_members: previous?.team_members ?? null,
    toc_entries: previous?.toc_entries ?? null,
    chart: chartElement?.chart
      ? {
          chart_type: chartElement.chart.chart_type,
          columns: chartElement.chart.columns,
          rows: chartElement.chart.rows,
        }
      : previous?.chart,
    elements: slide.elements,
    kind: slide.kind,
    background: slide.background ?? "paper",
    customized: slide.customized ?? false,
  };

  if (!slide.customized) return base;

  // Hand-edited: the elements now hold the truth, so derive blocks from the
  // ones that carry content. Locked chrome, labels, and anything that merely
  // repeats the slide title are excluded so they cannot become paragraphs.
  const CONTENT_TYPES = ["text", "statement", "quote", "list", "metric", "caption"];
  const titleLower = (slide.title ?? "").trim().toLowerCase();

  const derived = slide.elements
    .filter((e) => CONTENT_TYPES.includes(e.type))
    .filter((e) => !e.locked)
    .filter((e) => {
      const t = (e.text ?? "").trim();
      if (!t) return false;
      if (t.toLowerCase() === titleLower) return false;
      // An all-caps short run is a template label, not prose.
      if (t.length < 28 && t === t.toUpperCase() && /[A-Z]/.test(t)) return false;
      return true;
    })
    .map((e) => ({ text: e.text ?? "", source: e.source ?? "" }));

  return { ...base, blocks: derived.length > 0 ? derived : base.blocks };
}

export function toStoredSlides(slides: ElementSlide[], previous: StoredSlide[]): StoredSlide[] {
  const byId = new Map(previous.map((p) => [p.id, p]));
  return slides.map((s) => toStoredSlide(s, byId.get(s.id)));
}

function legacyTypeFor(kind: SlideKind): string {
  switch (kind) {
    case "cover": return "cover";
    case "contents": return "toc";
    case "team": return "team";
    case "data": return "chart";
    default: return "text";
  }
}

/**
 * Re-composes a slide from its content, discarding hand-positioning.
 *
 * Customization was previously a one-way door: once a slide was touched it
 * never followed the template again, with no way back. That's wrong, so
 * this is the reverse operation the editor's "reset to template" uses.
 */
export function resetToTemplate(
  slide: ElementSlide,
  stored: StoredSlide | undefined,
  templateId: string,
  context: { logo?: string | null; companyName?: string; pageNumber?: number; totalPages?: number } = {},
): ElementSlide {
  const base: StoredSlide = stored
    ? { ...stored, customized: false, elements: undefined }
    : { ...toStoredSlide(slide), customized: false, elements: undefined };
  return toElementSlide(base, templateId, context);
}

/** Builds an empty slide, used by "add slide" in the editor. */
export function blankSlide(templateId: string, title = "New slide"): ElementSlide {
  const composed = compose(templateId, {
    kind: "custom",
    title,
    paragraphs: [{ text: "Add your text here." }],
  });
  return { ...composed, id: elementId("slide") };
}
