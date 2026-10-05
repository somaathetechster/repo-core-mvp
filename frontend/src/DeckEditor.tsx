import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  getDeck, saveDeckEditorState, regenerateDeck, updateDeckProfile, renameDeck,
  type DeckTheme, type CompanyProfile, type AnalyzeResult, type FullDeck,
} from "./api";
import DeckStudio from "./DeckStudio";
import CompanyProfileForm from "./CompanyProfileForm";
import ChartRenderer, { type ColumnMeta } from "./viz/ChartRenderer";
import {
  toElementSlide, toElementSlides, toStoredSlides, blankSlide, resetToTemplate, syncContentsSlides, type StoredSlide,
} from "./deck/migrate";
import { compose } from "./deck/composers";
import { loadFontPairing, FONT_PAIRINGS, type ThemeSettings } from "./deck/theme";
import { useHistory } from "./deck/useHistory";
import { chartWithCaption } from "./DeckStudio";
import type { ElementSlide, SlideElement } from "./deck/elements";
import type { BrandImage } from "./deck/images";
import { extractImages, inlineImages, mapBytes, type ImageMap } from "./deck/imageStore";
import { DEFAULT_TEMPLATE_ID, getTemplate, ensureFonts, type DeckTemplate } from "./deck/templates";
import "./theme.css";
import "./deck.css";

type View = "studio" | "profile";

const DEFAULT_THEME: ThemeSettings = {
  ink: "#161412",
  paper: "#faf8f3",
  accent: "#b8860b",
  fontPairing: "fraunces-inter",
  typeScale: 1,
};

/** The primary (first quoted) family in a CSS font stack, lower-cased. */
function primaryFamily(fontStack: string): string {
  const quoted = /"([^"]+)"/.exec(fontStack);
  return (quoted ? quoted[1] : fontStack.split(",")[0]).trim().toLowerCase();
}

/**
 * The font-pairing id whose display face matches a template's declared display
 * font. The composers render type through the theme's `fonts`, which come from
 * the pairing — so switching the pairing to the one that shares the template's
 * display family is what makes, say, Brutus actually render in Archivo rather
 * than keeping the previous template's face. Falls back to the current pairing
 * when nothing matches.
 */
function pairingForTemplate(template: DeckTemplate, fallback: string): string {
  const target = primaryFamily(template.fonts.display);
  for (const [id, pairing] of Object.entries(FONT_PAIRINGS)) {
    if (primaryFamily(pairing.display) === target) return id;
  }
  return fallback;
}

/**
 * One undo/redo entry covers the whole editable surface: the slides *and* the
 * theme (colour, font, type scale) and the active template. They live in one
 * history snapshot so undo after a theme or template change reverts it,
 * instead of the stack being thrown away (template) or the change going
 * unrecorded (colour/font).
 */
interface EditorState {
  slides: ElementSlide[];
  themeSettings: ThemeSettings;
  templateId: string;
}

/**
 * Listens for data dropped from the Data Studio.
 *
 * The Data Studio posts a payload through this channel rather than the two
 * views sharing state, because they're separate tabs: the founder builds a
 * chart in one place and wants it in a deck in another, possibly minutes
 * later. The payload is stashed and claimed when the deck editor opens.
 */
const PENDING_KEY = "provisio:pending-chart";

export interface PendingChart {
  chart: { chart_type: string; columns: string[]; rows: string[][] };
  title: string;
  note: string;
}

export function stashChartForDeck(payload: PendingChart) {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload));
}

/** "Saved · just now" / "Saved · 3 min ago" for the editor's sync indicator. */
function savedLabel(savedAt: number | null, now: number): string {
  if (savedAt == null) return "Not saved yet";
  const sec = Math.max(0, Math.floor((now - savedAt) / 1000));
  if (sec < 45) return "Saved · just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `Saved · ${min} min ago`;
  const hr = Math.round(min / 60);
  return `Saved · ${hr} hr ago`;
}

function claimPendingChart(): PendingChart | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(PENDING_KEY);
  try {
    return JSON.parse(raw) as PendingChart;
  } catch {
    return null;
  }
}

export default function DeckEditor({
  deckId,
  analyzedRepos,
  onBack,
  initialSlide,
}: {
  deckId: string;
  analyzedRepos: AnalyzeResult[];
  onBack: () => void;
  /** Slide to open on (from the ?slide= hint when deep-linked). */
  initialSlide?: number;
}) {
  const [view, setView] = useState<View>("studio");
  const [deckName, setDeckName] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleSaving, setTitleSaving] = useState(false);
  // The last name successfully persisted, so an empty/failed edit can revert.
  const lastSavedName = useRef("");
  const [stored, setStored] = useState<StoredSlide[]>([]);
  const history = useHistory<EditorState>({
    slides: [], themeSettings: DEFAULT_THEME, templateId: DEFAULT_TEMPLATE_ID,
  });
  const { slides, themeSettings, templateId } = history.state;
  // Update only the slides field, leaving theme/template untouched. `label`
  // coalesces rapid edits (one drag = one undo), same as before.
  const setSlides = useCallback(
    (next: ElementSlide[] | ((prev: ElementSlide[]) => ElementSlide[]), label = "edit") =>
      history.set(
        (prev) => ({
          ...prev,
          slides: syncContentsSlides(
            typeof next === "function"
              ? (next as (p: ElementSlide[]) => ElementSlide[])(prev.slides)
              : next,
            templateId,
            { companyName: deckName },
            prev.slides,
          ),
        }),
        label,
      ),
    [history.set, templateId, deckName],
  );
  // Theme/font/colour changes push a history entry (label "theme" coalesces a
  // slider sweep into one undo) rather than clearing the stack.
  const setThemeSettings = useCallback(
    (next: ThemeSettings) => history.set((prev) => ({ ...prev, themeSettings: next }), "theme"),
    [history.set],
  );
  const [deckTheme, setDeckTheme] = useState<DeckTheme | null>(null);
  const [deckProfile, setDeckProfile] = useState<CompanyProfile | null>(null);
  // The image library lives on the deck so it survives a reload. Adding an
  // image previously called an undefined handler and was silently discarded.
  const [images, setImages] = useState<BrandImage[]>([]);
  // Every distinct image in the deck, stored once and referenced by hash.
  const imageMapRef = useRef<ImageMap>({});
  const [current, setCurrent] = useState(() =>
    initialSlide != null && Number.isFinite(initialSlide) ? initialSlide : 0,
  );
  const [dirty, setDirty] = useState(false);
  // Every local edit bumps `editSeq`; a completed save records the seq it
  // persisted in `savedSeq`. The deck is dirty whenever those differ. This is
  // what stops the autosave race: edits made *while a save is in flight* bump
  // editSeq past the value that save persists, so `dirty` stays true and a
  // follow-up save runs instead of the completing save flipping the UI to
  // "Saved" and dropping them.
  const editSeq = useRef(0);
  const savedSeq = useRef(0);
  const savingRef = useRef(false);
  const markDirty = useCallback(() => { editSeq.current += 1; setDirty(true); }, []);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dropPrompt, setDropPrompt] = useState<PendingChart | null>(null);
  const [guidesEnabled, setGuidesEnabled] = useState(() => localStorage.getItem("provisio:guides") !== "off");
  const loadedRef = useRef(false);

  // The ONLY source of truth for preserving a slide's layout across a template
  // switch: a slide id lands here when — and only when — the user genuinely
  // hand-edits it this session (drag, resize, text edit, add/delete element).
  // It is deliberately NOT tied to the `customized` flag, which can be set by
  // recomposition or load; this set is never populated by those paths.
  const userEditedSlides = useRef<Set<string>>(new Set());
  const [applyingTemplate, setApplyingTemplate] = useState(false);

  // ── Auto-sync ──────────────────────────────────────────────────────────
  // The server `updated_at` for the version we currently hold. The 30s poll
  // compares the server's against this to notice a newer version appearing
  // underneath us (an edit from another tab, device, or a regenerate).
  const syncedUpdatedAt = useRef<string | null>(null);
  // When we last pulled/pushed a version in sync with the server (for the
  // toolbar's "Saved · N min ago" indicator). `syncTick` just forces that
  // relative label to re-render every 30s.
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [syncTick, setSyncTick] = useState(0);
  // A newer server version exists but we have unsaved local edits, so we
  // can't silently replace them — the user decides (save or discard).
  const [syncConflict, setSyncConflict] = useState(false);
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  }

  // Persist the deck title via PATCH (its own save, separate from the slide
  // autosave). Reverts to the last saved name on an empty or failed edit.
  async function commitDeckName() {
    setEditingTitle(false);
    const name = deckName.trim();
    if (!name || name === lastSavedName.current) {
      setDeckName(lastSavedName.current);
      return;
    }
    setTitleSaving(true);
    try {
      await renameDeck(deckId, name);
      lastSavedName.current = name;
      setDeckName(name);
    } catch (e) {
      setDeckName(lastSavedName.current);
      setError(e instanceof Error ? e.message : "Couldn't rename this deck.");
    } finally {
      setTitleSaving(false);
    }
  }

  /* ---------------- load ---------------- */

  // Apply a freshly-fetched deck into editor state. Used both for the initial
  // open and for a silent re-sync when a newer server version appears. It
  // resets the undo history to the server version, so it must only run when
  // there are no unsaved local edits to lose.
  const applyDeck = useCallback((d: FullDeck, opts?: { claimChart?: boolean }) => {
    const tpl = d.theme?.template_id ?? DEFAULT_TEMPLATE_ID;
    const settings: ThemeSettings = {
      ink: d.theme?.secondary_color || DEFAULT_THEME.ink,
      paper: DEFAULT_THEME.paper,
      accent: d.theme?.primary_color || DEFAULT_THEME.accent,
      fontPairing: d.theme?.font_pairing ?? DEFAULT_THEME.fontPairing,
      typeScale: d.theme?.type_scale ?? 1,
    };
    const themeRaw = (d.theme ?? {}) as unknown as Record<string, unknown>;
    const imageMap = (themeRaw.images as ImageMap) ?? {};
    imageMapRef.current = imageMap;

    const savedLibrary = (themeRaw.library_images as BrandImage[]) ?? [];
    const restored = inlineImages(
      d.slides as unknown as never[],
      savedLibrary as unknown as { data_url: string }[],
      imageMap,
    );
    const rawStoredSlides = restored.slides as unknown as StoredSlide[];
    // Normalize the TOC snapshot on load without rebuilding a customized
    // contents page. This repairs older decks while preserving any text
    // or layout the user added directly to the TOC.
    const tocEntries = rawStoredSlides
      .filter((slide) => slide.id !== "toc" && slide.type !== "toc" && slide.kind !== "contents")
      .map((slide) => ({ title: slide.title.trim() || "Untitled slide" }));
    const storedSlides = rawStoredSlides.map((slide) =>
      slide.id === "toc" || slide.type === "toc" || slide.kind === "contents"
        ? { ...slide, toc_entries: tocEntries }
        : slide,
    );
    setDeckName(d.name);
    lastSavedName.current = d.name;
    setDeckTheme(d.theme);
    setStored(storedSlides);
    history.reset({
      slides: toElementSlides(storedSlides, tpl, { companyName: d.name }),
      themeSettings: settings,
      templateId: tpl,
    });
    setDeckProfile(d.profile_snapshot as unknown as CompanyProfile);

    // Seed the library from images already saved on the deck, falling
    // back to whatever the company profile carries so a founder who
    // uploaded images there sees them here without re-adding them.
    const saved = restored.library as unknown as BrandImage[];
    if (saved?.length) {
      setImages(saved);
    } else {
      const profileImages =
        ((d.profile_snapshot as unknown as Record<string, unknown>)?.company_image_data_urls as
          { data_url: string; tag?: string }[] | undefined) ?? [];
      const logo = (d.profile_snapshot as unknown as Record<string, unknown>)?.logo_data_url as string | undefined;
      const seeded: BrandImage[] = [
        ...(logo ? [{ id: "logo", data_url: logo, tag: "logo" as const, label: "Logo" }] : []),
        ...profileImages.map((im, i) => ({
          id: `profile-${i}`,
          data_url: im.data_url,
          tag: (im.tag as BrandImage["tag"]) ?? "other",
          label: im.tag ?? `Image ${i + 1}`,
        })),
      ];
      setImages(seeded);
    }
    loadedRef.current = true;
    // This version is now in sync with the server.
    syncedUpdatedAt.current = d.updated_at ?? null;
    setLastSyncedAt(Date.now());
    setDirty(false);
    editSeq.current = savedSeq.current;
    setSyncConflict(false);

    // A chart waiting from the Data Studio is offered as soon as the
    // deck opens, with a choice of where it should go.
    if (opts?.claimChart) {
      const pending = claimPendingChart();
      if (pending) setDropPrompt(pending);
    }
  }, [history]);

  useEffect(() => {
    let cancelled = false;
    getDeck(deckId)
      .then((d) => { if (!cancelled) applyDeck(d, { claimChart: true }); })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't open this deck."));
    return () => { cancelled = true; };
  }, [deckId, applyDeck]);

  /* ---------------- auto-sync poll ---------------- */

  // Poll the server every 30s for a newer version. If one exists and we have
  // no unsaved edits, reload it silently and flash a small toast. If we do
  // have unsaved edits, raise a banner and let the user decide rather than
  // clobbering their work.
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!loadedRef.current) return;
      try {
        const d = await getDeck(deckId);
        const serverUpdated = d.updated_at;
        if (!serverUpdated || !syncedUpdatedAt.current) {
          // No basis for comparison yet — just record what we saw.
          if (serverUpdated && !syncedUpdatedAt.current) syncedUpdatedAt.current = serverUpdated;
          return;
        }
        if (serverUpdated <= syncedUpdatedAt.current) return; // nothing newer
        if (dirtyRef.current || savingRef.current) {
          setSyncConflict(true);
        } else {
          applyDeck(d);
          flash("Deck updated");
        }
      } catch {
        // A failed poll is not worth surfacing; try again next tick.
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [deckId, applyDeck]);

  // Re-render the "Saved · N ago" label every 30s so it stays current.
  useEffect(() => {
    const t = setInterval(() => setSyncTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  /* ---------------- save ---------------- */

  const save = useCallback(async () => {
    // Never re-enter: a save already in flight owns the write. Overlapping
    // saves could land out of order and resurrect stale slides.
    if (!loadedRef.current || savingRef.current) return;
    // Snapshot the edit counter this save is about to persist. Anything edited
    // after this point leaves the deck dirty so it gets saved next.
    const seqAtStart = editSeq.current;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    let persisted = false;
    try {
      const nextStored = toStoredSlides(slides, stored);

      // Pull every inline image out into the shared map before sending. A
      // deck that keeps its photos inline grows past what the API will
      // accept, which is how saving started failing silently.
      const packed = extractImages(
        nextStored as unknown as never[],
        images as unknown as { data_url: string }[],
        {},
      );
      imageMapRef.current = packed.images;

      const bytes = mapBytes(packed.images) + JSON.stringify(packed.slides).length;
      if (bytes > 8_000_000) {
        setError(
          `This deck is about ${(bytes / 1_000_000).toFixed(1)}MB, which is too large to save. ` +
          `Remove a few images from the Images panel, or use smaller files.`,
        );
        return; // `finally` clears the saving flags; persisted stays false.
      }

      const result = await saveDeckEditorState(deckId, {
        slides: packed.slides as never,
        theme: {
          ...(deckTheme ?? {}),
          primary_color: themeSettings.accent,
          secondary_color: themeSettings.ink,
          font_style: deckTheme?.font_style ?? "serif",
          template_id: templateId,
          font_pairing: themeSettings.fontPairing,
          type_scale: themeSettings.typeScale,
          library_images: packed.library,
          images: packed.images,
        } as never,
        layouts: {},
        freeform_slide_ids: [],
      });
      setStored(nextStored);
      savedSeq.current = seqAtStart;
      persisted = true;
      // Our write is now the server's current version, so advance the sync
      // marker to its new updated_at (clearing any stale conflict) — otherwise
      // the next poll would see "newer on server" and try to resync our own
      // save back over us.
      if (result?.updated_at) syncedUpdatedAt.current = result.updated_at;
      setLastSyncedAt(Date.now());
      setSyncConflict(false);
      // Only clear dirty if nothing was edited while this save was running.
      // Otherwise leave it dirty so the newer edits are saved next.
      if (editSeq.current === seqAtStart) setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      savingRef.current = false;
      setSaving(false);
      // Edits arrived while this save was in flight: run the latest save so
      // they aren't lost. Uses the ref to reach the newest closure (with the
      // newest slides), not this now-stale one. Only after a save that
      // actually persisted, so a failed or size-blocked save doesn't spin.
      if (persisted && loadedRef.current && editSeq.current !== savedSeq.current) {
        setTimeout(() => saveRef.current(), 0);
      }
    }
  }, [slides, stored, deckId, deckTheme, themeSettings, templateId, images]);

  // Always points at the most recent `save`, so a follow-up triggered from
  // inside a stale save still persists the current slides.
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);

  // Discard local edits and take the server's newer version (the conflict
  // banner's "discard" action).
  const discardAndSync = useCallback(async () => {
    try {
      const d = await getDeck(deckId);
      applyDeck(d);
      flash("Synced to the latest version.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sync the latest version.");
    }
  }, [deckId, applyDeck]);

  // Autosave on a delay: losing hand-positioned layout work to a closed tab
  // would be worse than an occasional redundant write. Keyed on editSeq (not
  // just the dirty boolean) so each edit reschedules against the latest state.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => { saveRef.current(); }, 2200);
    return () => clearTimeout(t);
  }, [dirty, save]);

  // Cmd/Ctrl-Z and Shift-Cmd/Ctrl-Z, skipped while typing so they don't
  // fight the browser's own undo inside a text field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      if (e.shiftKey ? !history.canRedo : !history.canUndo) return;
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
      markDirty();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history]);

  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      if (dirty) { e.preventDefault(); e.returnValue = ""; }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /* ---------------- template switching ---------------- */

  function applyTemplate(nextId: string) {
    if (nextId === templateId || applyingTemplate) return;

    // Only slides the user genuinely hand-edited this session are preserved;
    // the cover is never preserved (it must always match the active template).
    const edited = userEditedSlides.current;
    const isCover = (s: ElementSlide, i: number) => i === 0 || s.kind === "cover";
    const preservedIds = new Set(
      slides.filter((s, i) => edited.has(s.id) && !isCover(s, i)).map((s) => s.id),
    );
    if (preservedIds.size > 0 && !window.confirm(
      `Changing the template keeps your ${preservedIds.size} hand-edited slide${preservedIds.size === 1 ? "" : "s"} ` +
      "but updates their colours, and recomposes the rest. You can undo this. Continue?",
    )) return;

    setApplyingTemplate(true);
    // The template's fonts must be ready BEFORE recompose, not after, or the
    // new layout paints in fallback type and reflows a frame later. Load the
    // NEW template's own declared faces (e.g. Archivo 900 for Brutus, Playfair
    // for Obsidian) — not the current theme pairing — and switch the theme's
    // font pairing to the one that shares this template's display family, so
    // the composed slides actually render in the template's typeface.
    const nextTemplate = getTemplate(nextId);
    const nextPairing = pairingForTemplate(nextTemplate, themeSettings.fontPairing);
    ensureFonts(nextTemplate);
    loadFontPairing(nextPairing);

    const nextStored = toStoredSlides(slides, stored);
    // BUG 1: force `customized: false` on every slide the user did NOT hand-edit
    // (and on the cover), so they fully recompose instead of being frozen by a
    // stale customized flag.
    const normalizedStored = nextStored.map((st) =>
      preservedIds.has(st.id) ? st : { ...st, customized: false },
    );
    setStored(normalizedStored);

    // Recompose is synchronous; defer it one frame so the "Applying…" state
    // paints first and the switch doesn't flash.
    requestAnimationFrame(() => {
      history.set((prev) => {
        const total = normalizedStored.length;
        const byId = new Map(prev.slides.map((s) => [s.id, s]));
        const rebuilt: ElementSlide[] = normalizedStored.map((st, i) => {
          const ctx = { companyName: deckName, pageNumber: i + 1, totalPages: total };
          // BUG 2 & 3: compose this slide fresh in the new template with its
          // stored background stripped, so the COMPOSER's background wins — the
          // cover's dark panel, Gallery's ink cover / paper interiors, etc.,
          // are never overridden by a background left over from the old template.
          const fresh = toElementSlide(
            { ...st, customized: false, elements: undefined, background: null }, nextId, ctx,
          );
          if (preservedIds.has(st.id)) {
            // Keep the user's hand-positioned elements, but adopt the new
            // template's background colour for the slide.
            const existing = byId.get(st.id);
            return existing ? { ...existing, background: fresh.background } : fresh;
          }
          return fresh;
        });
        return {
          ...prev,
          templateId: nextId,
          // Adopt the template's natural font pairing as part of the same undo
          // step, so the editor repaints in the right typeface on switch.
          themeSettings: { ...prev.themeSettings, fontPairing: nextPairing },
          slides: syncContentsSlides(rebuilt, nextId, { companyName: deckName }),
        };
      }, "template");
      markDirty();
      flash(
        preservedIds.size > 0
          ? `Switched template. ${preservedIds.size} hand-edited slide${preservedIds.size === 1 ? "" : "s"} kept their layout.`
          : "Switched template.",
      );
      // Minimum visible duration so the state doesn't flash on a fast machine.
      setTimeout(() => setApplyingTemplate(false), 150);
    });
  }

  /* ---------------- chart drop ---------------- */

  function placeChart(pending: PendingChart, mode: "new" | "current") {
    const els = chartWithCaption(pending.chart, pending.note, { x: 140, y: 190 }, 780);
    if (mode === "current") {
      // Adding an element to an existing slide is a genuine hand-edit.
      if (slides[current]?.id) userEditedSlides.current.add(slides[current].id);
      setSlides((prev) =>
        prev.map((s, i) =>
          i === current ? { ...s, customized: true, elements: [...s.elements, ...els] } : s,
        ),
      );
      flash(`Added to slide ${current + 1}. Drag it into place.`);
    } else {
      // Compose a real data slide through the active template rather than
      // assembling one by filtering a blank slide's elements. Templates use
      // different element types for their titles (Statement uses a
      // statement/eyebrow pair, not a heading), so type-filtering silently
      // dropped the title on some templates.
      const composed = compose(templateId, {
        kind: "data",
        title: pending.title,
        paragraphs: pending.note ? [{ text: pending.note }] : [],
        chart: pending.chart,
        companyName: deckName,
        pageNumber: current + 2,
        totalPages: slides.length + 1,
      });
      const withChart: ElementSlide = { ...composed, customized: false };
      setSlides((prev) => {
        const next = [...prev];
        next.splice(current + 1, 0, withChart);
        return next;
      });
      setCurrent((c) => c + 1);
      flash("Added as a new slide. Drag the chart and its note into place.");
    }
    setDropPrompt(null);
    markDirty();
  }

  /* ---------------- chart rendering inside slides ---------------- */

  const renderChart = useCallback((el: SlideElement) => {
    if (!el.chart) return null;
    const columns: ColumnMeta[] = el.chart.columns.map((name, i) => ({
      name,
      type: i === 0 ? "category" : "decimal",
      role: i === 0 ? "categorical" : "measure",
    }));
    const [first, ...rest] = el.chart.columns;
    const encoding =
      el.chart.chart_type === "line" ? { x: first, y: rest.slice(0, 3) }
        : el.chart.chart_type === "pie" ? { dimension: first, measure: rest[0] }
          : el.chart.chart_type === "bar" ? { dimension: first, measure: rest[0], sort: "desc" }
            : { columns: el.chart.columns };
    return (
      <ChartRenderer
        spec={{ chart_type: el.chart.chart_type, title: "", reason: "", encoding }}
        columns={columns}
        rows={el.chart.rows}
        showTitle={false}
      />
    );
  }, []);

  /* ---------------- actions ---------------- */

  async function regenerate() {
    if (!window.confirm("Regenerate rewrites every slide's content. Hand-positioned layouts will be lost. Continue?")) return;
    setBusy("Regenerating");
    setError(null);
    try {
      const d = await regenerateDeck(deckId, analyzedRepos as unknown as Record<string, unknown>[]);
      const storedSlides = d.slides as unknown as StoredSlide[];
      setStored(storedSlides);
      // Regeneration is a normal history entry, so it can be undone just like
      // a text, slide, theme, or template change.
      history.set((prev) => ({
        ...prev,
        slides: syncContentsSlides(toElementSlides(storedSlides, templateId, { companyName: d.name }), templateId, { companyName: d.name }),
      }), "regenerate");
      markDirty();
      setCurrent(0);
      flash("Regenerated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't regenerate.");
    } finally {
      setBusy(null);
    }
  }

  function resetSlideToTemplate() {
    const target = slides[current];
    if (!target?.customized) return;
    const storedMatch = stored.find((x) => x.id === target.id);
    const fresh = resetToTemplate(target, storedMatch, templateId, {
      companyName: deckName,
      pageNumber: current + 1,
      totalPages: slides.length,
    });
    setSlides((prev) => prev.map((s, i) => (i === current ? fresh : s)), "reset-template");
    // Reset is the explicit undo of a hand-edit, so this slide is no longer
    // user-edited and should follow the template again on the next switch.
    userEditedSlides.current.delete(target.id);
    markDirty();
    flash("Slide reset to the template. Undo if that wasn't what you wanted.");
  }

  function addSlide() {
    const requested = window.prompt("Name this slide", "New slide");
    if (requested === null) return;
    const fresh = blankSlide(templateId, requested.trim() || "New slide");
    setSlides((prev) => {
      const next = [...prev];
      next.splice(current + 1, 0, fresh);
      return next;
    });
    setCurrent((c) => c + 1);
    markDirty();
  }

  function deleteSlide() {
    if (slides.length <= 1) return;
    if (!window.confirm(`Delete slide ${current + 1}?`)) return;
    userEditedSlides.current.delete(slides[current]?.id);
    setSlides((prev) => prev.filter((_, i) => i !== current));
    setCurrent((c) => Math.max(0, c - 1));
    markDirty();
  }

  // The editor fills from wherever it starts down to the bottom of the
  // window. The app's top bar wraps at different widths, so a hardcoded
  // offset is wrong somewhere; measuring is right everywhere.
  const editorRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const el = editorRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.height = `${Math.max(520, window.innerHeight - top)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  });

  if (error && slides.length === 0) {
    return (
      <div className="deck-editor">
        <button className="p-btn p-btn-ghost" onClick={onBack}>&lt; Decks</button>
        <p className="p-error">{error}</p>
      </div>
    );
  }

  if (slides.length === 0) return <p className="deck-loading">Opening deck…</p>;

  return (
    <div className="deck-editor" ref={editorRef}>
      <div className="deck-editor-toolbar-wrap">
        <header className="deck-toolbar">
          <div className="deck-toolbar-left">
            <button className="p-btn p-btn-ghost" onClick={onBack}>&lt; Decks</button>
          {editingTitle ? (
            <input
              className="p-input deck-name-input"
              value={deckName}
              autoFocus
              onChange={(e) => setDeckName(e.target.value)}
              onBlur={commitDeckName}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                else if (e.key === "Escape") { setDeckName(lastSavedName.current); setEditingTitle(false); }
              }}
            />
          ) : (
            <button
              className="deck-name-title"
              title="Click to rename"
              onClick={() => setEditingTitle(true)}
            >
              {deckName || "Untitled deck"}
              {titleSaving && <span className="deck-name-saving"> · Saving…</span>}
            </button>
          )}
        </div>

        <div className="deck-toolbar-right">
          <div className="deck-view-toggle">
            <button
              className={`deck-view-btn ${view === "studio" ? "deck-view-btn-active" : ""}`}
              onClick={() => setView("studio")}
            >
              Design
            </button>
            <button
              className={`deck-view-btn ${view === "profile" ? "deck-view-btn-active" : ""}`}
              onClick={() => setView("profile")}
            >
              Content
            </button>
          </div>
          <button
            className="p-btn p-btn-ghost"
            onClick={() => { history.undo(); markDirty(); }}
            disabled={!history.canUndo}
            title="Undo (Cmd/Ctrl+Z)"
          >
            Undo
          </button>
          <button
            className="p-btn p-btn-ghost"
            onClick={() => { history.redo(); markDirty(); }}
            disabled={!history.canRedo}
            title="Redo (Shift+Cmd/Ctrl+Z)"
          >
            Redo
          </button>
          <button
            className="p-btn p-btn-ghost"
            onClick={resetSlideToTemplate}
            disabled={!slides[current]?.customized}
            title="Discard hand-positioning on this slide and re-apply the template"
          >
            Reset layout
          </button>
          <button
            className="p-btn p-btn-ghost"
            onClick={() => setGuidesEnabled((enabled) => {
              const next = !enabled;
              localStorage.setItem("provisio:guides", next ? "on" : "off");
              return next;
            })}
            title="Toggle alignment guides and snapping"
          >
            Guides {guidesEnabled ? "On" : "Off"}
          </button>
          <button className="p-btn p-btn-ghost" onClick={addSlide}>+ Slide</button>
          <button className="p-btn p-btn-ghost" onClick={deleteSlide} disabled={slides.length <= 1}>
            Delete slide
          </button>
          <button className="p-btn p-btn-ghost" onClick={regenerate} disabled={!!busy}>
            {busy ?? "Regenerate"}
          </button>
          <span
            className="deck-last-synced"
            title={lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : undefined}
            data-tick={syncTick}
          >
            {saving ? "Saving…" : dirty ? "Unsaved changes" : savedLabel(lastSyncedAt, Date.now())}
          </span>
          <button className="p-btn p-btn-secondary" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        </div>
        </header>
      </div>
      <div className="deck-editor-content">

      {syncConflict && (
        <div className="deck-sync-banner" role="alert">
          <span>A newer version exists. Save your changes or discard to sync.</span>
          <div className="deck-sync-banner-actions">
            <button className="p-btn p-btn-secondary" onClick={save} disabled={saving}>
              Save my changes
            </button>
            <button className="p-btn p-btn-ghost" onClick={discardAndSync}>
              Discard &amp; sync
            </button>
          </div>
        </div>
      )}

      {error && <p className="p-error">{error}</p>}
      {notice && <p className="deck-notice">{notice}</p>}
      {applyingTemplate && <p className="deck-notice deck-applying">Applying template…</p>}

      {dropPrompt && (
        <div className="deck-drop-prompt">
          <div>
            <strong>"{dropPrompt.title}" is ready to place.</strong>
            <span>It'll arrive with a note box beneath it that you can edit and drag anywhere.</span>
          </div>
          <div className="deck-drop-actions">
            <button className="p-btn p-btn-secondary" onClick={() => placeChart(dropPrompt, "current")}>
              Onto slide {current + 1}
            </button>
            <button className="p-btn p-btn-primary" onClick={() => placeChart(dropPrompt, "new")}>
              As a new slide
            </button>
            <button className="p-btn p-btn-ghost" onClick={() => setDropPrompt(null)}>Not now</button>
          </div>
        </div>
      )}

      {view === "studio" ? (
        <DeckStudio
          slides={slides}
          current={current}
          themeSettings={themeSettings}
          templateId={templateId}
          industry={deckProfile?.industry ?? null}
          images={images}
          onImagesChange={(next) => { setImages(next); markDirty(); }}
          renderChart={renderChart}
          onSlidesChange={(next, label) => {
            setSlides(next, label ?? "edit");
            markDirty();
            // Record a genuine hand-edit so this slide's layout is preserved
            // across template switches. Slide-array operations (reorder /
            // insert / duplicate) are not element edits, so they don't count.
            const structural = label === "reorder-slides" || label === "insert-slide" || label === "duplicate-slide";
            const id = slides[current]?.id;
            if (!structural && id) userEditedSlides.current.add(id);
          }}
          onThemeChange={(next) => { setThemeSettings(next); markDirty(); }}
          onTemplateChange={applyTemplate}
          onCurrentChange={setCurrent}
          guidesEnabled={guidesEnabled}
        />
      ) : (
        deckProfile && (
          <CompanyProfileForm
            heading="Content for this deck"
            description="Editing this only affects this deck. Regenerate afterwards to rewrite the slides from it."
            load={async () => deckProfile}
            save={async (p) => { await updateDeckProfile(deckId, p); setDeckProfile(p); }}
          />
        )
      )}
      </div>{/* deck-editor-content */}
    </div>
  );
}
