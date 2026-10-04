import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listDecks, createDeck, deleteDeck, renameDeck, listStructures, recommendStructure,
  type DeckSummary, type AnalyzeResult, type DeckStructureInfo,
} from "./api";
import { DownloadMenu } from "./DeckViewer";
import "./theme.css";
import "./decks-home.css";

interface DecksHomeProps {
  analyzedRepos: AnalyzeResult[];
}

export default function DecksHome({ analyzedRepos }: DecksHomeProps) {
  const navigate = useNavigate();
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Inline rename state for the deck cards.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  function startRename(d: DeckSummary) {
    setEditingId(d.id);
    setEditName(d.name);
  }

  async function commitRename(id: string) {
    const name = editName.trim();
    const current = decks?.find((d) => d.id === id);
    setEditingId(null);
    if (!current || !name || name === current.name) return;
    // Optimistic: show the new name immediately, revert on failure.
    setDecks((prev) => prev?.map((d) => (d.id === id ? { ...d, name } : d)) ?? prev);
    setSavingId(id);
    try {
      await renameDeck(id, name);
    } catch (e) {
      setDecks((prev) => prev?.map((d) => (d.id === id ? { ...d, name: current.name } : d)) ?? prev);
      setError(e instanceof Error ? e.message : "Couldn't rename this deck.");
    } finally {
      setSavingId(null);
    }
  }

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

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this deck? This can't be undone.")) return;
    try {
      await deleteDeck(id);
      await loadDecks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete this deck.");
    }
  }

  const openDeck = (id: string) => navigate(`/deck/${id}`);

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
              <div className="deck-card" key={d.id} onClick={() => openDeck(d.id)}>
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
                      {editingId === d.id ? (
                        <input
                          className="deck-card-name-input"
                          value={editName}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setEditName(e.target.value)}
                          onBlur={() => commitRename(d.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                            else if (e.key === "Escape") { setEditingId(null); }
                          }}
                        />
                      ) : (
                        <div
                          className="deck-card-name deck-card-name-editable"
                          title="Click to rename"
                          onClick={(e) => { e.stopPropagation(); startRename(d); }}
                        >
                          {d.name}
                          {savingId === d.id && <span className="deck-card-saving"> · Saving…</span>}
                        </div>
                      )}
                      <div className="deck-card-meta">{relAgo ? `Edited ${relAgo}` : "—"}</div>
                    </div>
                  </div>
                  <div className="deck-card-review-hint">
                    <span className="deck-card-review-dot" />
                    See its pitch score in the Review tab
                  </div>
                  <div className="deck-card-actions" onClick={e => e.stopPropagation()}>
                    <button className="deck-card-btn primary" onClick={() => openDeck(d.id)}>Open</button>
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
            openDeck(id);
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

  // The deck structure: which named shape to generate against. Loaded from the
  // backend so the picker and generation share one source of truth.
  const [structures, setStructures] = useState<DeckStructureInfo[] | null>(null);
  const [structureId, setStructureId] = useState<string>("seed");
  const [recommending, setRecommending] = useState(false);
  const [recommendReason, setRecommendReason] = useState<string | null>(null);

  useEffect(() => {
    listStructures()
      .then((s) => {
        setStructures(s);
        // Default the selection to the first structure that exists, keeping
        // seed if it is present (the baseline).
        if (s.length && !s.some((x) => x.id === "seed")) setStructureId(s[0].id);
      })
      .catch(() => setStructures([]));
  }, []);

  function toggleRepo(fullName: string) {
    setSelectedRepoNames((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  }

  async function handleAutoRecommend() {
    setRecommending(true);
    setError(null);
    try {
      const { structure_id, reason } = await recommendStructure({ useSharedProfile });
      setStructureId(structure_id);
      setRecommendReason(reason);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't recommend a structure.");
    } finally {
      setRecommending(false);
    }
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
        structureId,
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
          <div className="wizard-structure-head">
            <span className="wizard-section-label">Deck structure</span>
            <button
              type="button"
              className="wizard-recommend-btn"
              onClick={handleAutoRecommend}
              disabled={recommending}
            >
              {recommending ? "Thinking…" : "✦ Auto-recommend"}
            </button>
          </div>
          {recommendReason && (
            <p className="wizard-recommend-reason">{recommendReason}</p>
          )}
          {structures === null ? (
            <p className="wizard-note">Loading structures…</p>
          ) : (
            <div className="wizard-structure-grid">
              {structures.map((s) => {
                const selected = s.id === structureId;
                return (
                  <button
                    type="button"
                    key={s.id}
                    className={`structure-card${selected ? " selected" : ""}`}
                    onClick={() => { setStructureId(s.id); setRecommendReason(null); }}
                    aria-pressed={selected}
                  >
                    <div className="structure-card-head">
                      <span className="structure-card-name">{s.name}</span>
                      <span className="structure-card-count">
                        {s.min_slides === s.max_slides
                          ? `${s.max_slides} slides`
                          : `${s.min_slides}–${s.max_slides} slides`}
                      </span>
                    </div>
                    <div className="structure-card-audience">{s.target_audience}</div>
                    <div className="structure-card-desc">{s.description}</div>
                    <ol className="structure-card-roles">
                      {s.roles.map((role) => (
                        <li key={role.key} className={`role-${role.requirement}`}>
                          <span className="structure-role-name">{role.label}</span>
                          <span className="structure-role-purpose">{role.purpose}</span>
                        </li>
                      ))}
                    </ol>
                  </button>
                );
              })}
            </div>
          )}
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
