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
        <div className="decks-home-title">
          Your decks{decks && <span>({decks.length})</span>}
        </div>
        <button className="decks-home-new" onClick={() => setShowWizard(true)}>
          ＋ New deck
        </button>
      </div>

      {error && <p className="p-error">{error}</p>}

      {decks === null ? (
        <div className="decks-home-loading">
          <div className="decks-spinner" /><span>Loading your decks…</span>
        </div>
      ) : decks.length === 0 ? (
        <div className="decks-home-empty-state">
          <div className="decks-empty-icon">✦</div>
          <div className="decks-empty-title">No decks yet</div>
          <div className="decks-empty-sub">Generate your first pitch deck from your GitHub evidence and company profile.</div>
          <button className="decks-home-new" onClick={() => setShowWizard(true)}>Generate first deck →</button>
        </div>
      ) : (
        <div className="decks-home-grid">
          {decks.map((d) => {
            const ago = d.updated_at ? Math.floor((Date.now()-new Date(d.updated_at).getTime())/86400000) : null;
            const relAgo = ago===null?"":ago===0?"today":ago===1?"yesterday":`${ago}d ago`;
            const initials = d.name.split(" ").map((w: string)=>w[0]).join("").toUpperCase().slice(0,2);
            return (
              <div className="deck-card" key={d.id} onClick={() => setOpenDeckId(d.id)}>
                {/* Preview thumbnail */}
                <div className="deck-card-preview">
                  <div className="deck-card-preview-inner">
                    <div className="deck-card-preview-title">{d.name}</div>
                  </div>
                  <div className="deck-card-preview-badge">{d.slide_count} slides</div>
                </div>
                {/* Card body */}
                <div className="deck-card-body">
                  <div className="deck-card-header-row">
                    <div className="deck-card-icon">{initials}</div>
                    <div>
                      <div className="deck-card-name">{d.name}</div>
                      <div className="deck-card-eyebrow">{relAgo ? `Edited ${relAgo}` : "—"}</div>
                    </div>
                  </div>
                  <div className="deck-card-review-hint">
                    <span className="deck-card-review-dot" />
                    Open deck → Review tab for pitch score
                  </div>
                  <div className="deck-card-actions" onClick={e => e.stopPropagation()}>
                    <button className="deck-card-btn primary" onClick={() => setOpenDeckId(d.id)}>Open</button>
                    <DownloadMenu deckId={d.id} />
                    <button className="deck-card-btn danger" onClick={() => handleDelete(d.id)}>Delete</button>
                  </div>
                </div>
              </div>
            );
          })}
          {/* New deck card */}
          <div className="deck-card deck-card-new" onClick={() => setShowWizard(true)}>
            <div className="deck-card-new-inner">
              <div className="deck-card-new-plus">+</div>
              <div className="deck-card-new-label">New deck</div>
              <div className="deck-card-new-sub">Generate from your profile and code evidence</div>
            </div>
          </div>
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
          <span className="wizard-section-label">Company profile</span>
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
          <span className="wizard-section-label">Repos to include</span>
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
