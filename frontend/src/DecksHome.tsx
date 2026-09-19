import { useEffect, useState } from "react";
import { listDecks, createDeck, deleteDeck, type DeckSummary, type AnalyzeResult } from "./api";
import DeckEditor from "./DeckEditor";
import { DownloadMenu } from "./DeckViewer";
import "./theme.css";
import "./decks-home.css";

interface DecksHomeProps {
  analyzedRepos: AnalyzeResult[];
}

export default function DecksHome({ analyzedRepos }: DecksHomeProps) {
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [openDeckId, setOpenDeckId] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDecks() {
    try {
      setDecks(await listDecks());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your decks.");
    }
  }

  useEffect(() => {
    loadDecks();
  }, []);

  // The Data Studio dispatches this after stashing a chart, so the deck
  // opens straight to the placement prompt instead of the founder having to
  // navigate back and find it.
  useEffect(() => {
    function onOpenDeck(e: Event) {
      const id = (e as CustomEvent).detail?.deckId;
      if (id) setOpenDeckId(id);
    }
    window.addEventListener("provisio:open-deck", onOpenDeck);
    return () => window.removeEventListener("provisio:open-deck", onOpenDeck);
  }, []);

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this deck? This can't be undone.")) return;
    try {
      await deleteDeck(id);
      await loadDecks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete this deck.");
    }
  }

  if (openDeckId) {
    return (
      <DeckEditor
        deckId={openDeckId}
        analyzedRepos={analyzedRepos}
        onBack={() => {
          setOpenDeckId(null);
          loadDecks();
        }}
      />
    );
  }

  return (
    <div className="decks-home">
      <div className="decks-home-header">
        <div>
          <h1 className="dash-title">Your decks</h1>
          <p className="dash-subtitle">Every deck you've built. Each can pull from a different set of repos and its own profile.</p>
        </div>
        <button className="p-btn p-btn-primary" onClick={() => setShowWizard(true)}>
          + New deck
        </button>
      </div>

      {error && <p className="p-error">{error}</p>}

      {decks === null ? (
        <p className="decks-home-loading">Loading...</p>
      ) : decks.length === 0 ? (
        <p className="decks-home-empty">No decks yet. Create your first one.</p>
      ) : (
        <div className="decks-home-grid">
          {decks.map((d) => (
            <div className="deck-card" key={d.id}>
              <h3>{d.name}</h3>
              <p className="deck-card-meta">
                {d.slide_count} slide{d.slide_count === 1 ? "" : "s"}
                {d.updated_at && ` \u00b7 Updated ${new Date(d.updated_at).toLocaleDateString()}`}
              </p>
              <div className="deck-card-actions">
                <button className="p-btn p-btn-primary" onClick={() => setOpenDeckId(d.id)}>
                  Edit
                </button>
                <DownloadMenu deckId={d.id} />
                <button className="p-btn p-btn-ghost deck-card-delete" onClick={() => handleDelete(d.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showWizard && (
        <NewDeckWizard
          analyzedRepos={analyzedRepos}
          onClose={() => setShowWizard(false)}
          onCreated={(id) => {
            setShowWizard(false);
            setOpenDeckId(id);
          }}
        />
      )}
    </div>
  );
}

function NewDeckWizard({
  analyzedRepos,
  onClose,
  onCreated,
}: {
  analyzedRepos: AnalyzeResult[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [useSharedProfile, setUseSharedProfile] = useState(true);
  const [selectedRepoNames, setSelectedRepoNames] = useState<Set<string>>(
    new Set(analyzedRepos.map((r) => String(r.summary.full_name)))
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleRepo(fullName: string) {
    setSelectedRepoNames((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  }

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const selectedSummaries = analyzedRepos
        .filter((r) => selectedRepoNames.has(String(r.summary.full_name)))
        .map((r) => r.summary);
      const deck = await createDeck({
        name: name.trim() || "Untitled deck",
        useSharedProfile,
        repoSummaries: selectedSummaries,
      });
      onCreated(deck.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the deck.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="wizard-overlay" onClick={onClose}>
      <div className="wizard-modal" onClick={(e) => e.stopPropagation()}>
        <h2>New deck</h2>

        <label className="profile-field">
          <span>Deck name</span>
          <input
            className="p-input"
            type="text"
            placeholder="e.g. YC application, Acme Ventures pitch"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>

        <div className="wizard-section">
          <span className="profile-field-label">Company profile</span>
          <label className="wizard-radio">
            <input type="radio" checked={useSharedProfile} onChange={() => setUseSharedProfile(true)} />
            Start from my saved company profile, then edit independently for this deck
          </label>
          <label className="wizard-radio">
            <input type="radio" checked={!useSharedProfile} onChange={() => setUseSharedProfile(false)} />
            Start blank for this deck
          </label>
        </div>

        <div className="wizard-section">
          <span className="profile-field-label">Repos to include</span>
          {analyzedRepos.length === 0 ? (
            <p className="wizard-note">
              No repos analyzed yet this session. You can still create the deck and add repo evidence later from
              the Evidence tab.
            </p>
          ) : (
            <div className="wizard-repo-list">
              {analyzedRepos.map((r) => {
                const fullName = String(r.summary.full_name);
                return (
                  <label className="wizard-checkbox" key={fullName}>
                    <input
                      type="checkbox"
                      checked={selectedRepoNames.has(fullName)}
                      onChange={() => toggleRepo(fullName)}
                    />
                    {fullName}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {error && <p className="p-error">{error}</p>}

        <div className="wizard-actions">
          <button className="p-btn p-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="p-btn p-btn-primary" onClick={handleCreate} disabled={creating}>
            {creating ? "Creating..." : "Create deck"}
          </button>
        </div>
      </div>
    </div>
  );
}
