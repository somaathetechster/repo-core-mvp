import { useEffect, useState } from "react";
import { listDecks, getDeck, type DeckSummary, type FullDeck } from "./api";
import "./placement.css";

export interface Placement {
  deck: FullDeck;
  mode: "new_slide" | "existing_slide";
  slideIndex: number | null;   // when adding to an existing slide
  insertAfter: number | null;  // when creating a new slide
  note: string;
}

/**
 * Asks where a chart or table should go, rather than appending it to the
 * end of a deck and hoping that's right.
 *
 * Three decisions, in the order they actually matter: which deck, whether
 * it joins an existing slide or becomes its own, and what it means. The
 * note is the part people skip and shouldn't: a chart on an investor slide
 * without a sentence saying what it shows is asking the reader to do work
 * the founder should have done.
 */
export default function PlacementPicker({
  itemTitle,
  onConfirm,
  onCancel,
}: {
  itemTitle: string;
  onConfirm: (placement: Placement) => void;
  onCancel: () => void;
}) {
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [selectedDeck, setSelectedDeck] = useState<FullDeck | null>(null);
  const [mode, setMode] = useState<"new_slide" | "existing_slide">("new_slide");
  const [position, setPosition] = useState<number>(-1);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listDecks()
      .then((d) => setDecks(d))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your decks."))
      .finally(() => setLoading(false));
  }, []);

  async function chooseDeck(id: string) {
    setLoading(true);
    setError(null);
    try {
      const full = await getDeck(id);
      setSelectedDeck(full);
      setPosition(full.slides.length - 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open that deck.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pp-overlay" onClick={onCancel}>
      <div className="pp-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add "{itemTitle}"</h2>

        {error && <p className="p-error">{error}</p>}
        {loading && <p className="pp-loading">Loading…</p>}

        {!selectedDeck && decks && (
          <>
            <p className="pp-step">Which deck?</p>
            {decks.length === 0 ? (
              <p className="pp-empty">
                You don't have a deck yet. Create one in the Deck tab, then come back.
              </p>
            ) : (
              <div className="pp-decks">
                {decks.map((d) => (
                  <button key={d.id} className="pp-deck" onClick={() => chooseDeck(d.id)}>
                    <span className="pp-deck-name">{d.name}</span>
                    <span className="pp-deck-meta">
                      {d.slide_count} slide{d.slide_count === 1 ? "" : "s"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {selectedDeck && (
          <>
            <button className="pp-back" onClick={() => setSelectedDeck(null)}>
              &lt; Choose a different deck
            </button>

            <p className="pp-step">Where in {selectedDeck.name}?</p>
            <div className="pp-modes">
              <label className={`pp-mode ${mode === "new_slide" ? "is-active" : ""}`}>
                <input
                  type="radio"
                  checked={mode === "new_slide"}
                  onChange={() => setMode("new_slide")}
                />
                <span>
                  <strong>Its own slide</strong>
                  <em>Best when the data is the point of the slide.</em>
                </span>
              </label>
              <label className={`pp-mode ${mode === "existing_slide" ? "is-active" : ""}`}>
                <input
                  type="radio"
                  checked={mode === "existing_slide"}
                  onChange={() => setMode("existing_slide")}
                />
                <span>
                  <strong>Onto an existing slide</strong>
                  <em>Best when it supports an argument already there.</em>
                </span>
              </label>
            </div>

            <p className="pp-step">
              {mode === "new_slide" ? "Insert after which slide?" : "Which slide?"}
            </p>
            <div className="pp-slides">
              {selectedDeck.slides.map((s, i) => (
                <button
                  key={s.id}
                  className={`pp-slide ${position === i ? "is-active" : ""}`}
                  onClick={() => setPosition(i)}
                >
                  <span className="pp-slide-num">{i + 1}</span>
                  <span className="pp-slide-title">{s.title}</span>
                </button>
              ))}
            </div>

            <label className="pp-note">
              <span>What does this show? (appears under the chart)</span>
              <textarea
                className="p-input"
                rows={2}
                placeholder="e.g. Fiat withdrawals are 45% of volume, which is why payout reliability is the core engineering problem."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>

            <div className="pp-actions">
              <button className="p-btn p-btn-secondary" onClick={onCancel}>Cancel</button>
              <button
                className="p-btn p-btn-primary"
                onClick={() =>
                  onConfirm({
                    deck: selectedDeck,
                    mode,
                    slideIndex: mode === "existing_slide" ? position : null,
                    insertAfter: mode === "new_slide" ? position : null,
                    note: note.trim(),
                  })
                }
              >
                Add to deck
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
