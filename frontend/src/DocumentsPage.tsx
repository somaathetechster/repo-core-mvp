import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listDocuments, createDocument, deleteDocument, generateDocument,
  DOC_TYPE_OPTIONS, type DocumentSummary, type DocType,
} from "./api";
import "./theme.css";
import "./decks-home.css";

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  DOC_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

function relAgo(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`;
}

export default function DocumentsPage() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setDocs(await listDocuments());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your documents.");
    }
  }

  useEffect(() => { load(); }, []);

  const openDoc = (id: string) => navigate(`/documents/${id}`);

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this document? This can't be undone.")) return;
    try {
      await deleteDocument(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete this document.");
    }
  }

  return (
    <div className="decks-home">
      <div className="decks-home-header">
        <div className="decks-home-title">
          Your documents{docs && <span>({docs.length})</span>}
        </div>
        <button className="decks-home-new" onClick={() => setShowModal(true)}>
          ＋ New Document
        </button>
      </div>

      {error && <p className="p-error">{error}</p>}

      {docs === null ? (
        <div className="decks-home-loading">
          <div className="decks-spinner" /><span>Loading your documents…</span>
        </div>
      ) : docs.length === 0 ? (
        <div className="decks-home-empty-state">
          <div className="decks-empty-icon">✦</div>
          <div className="decks-empty-title">No documents yet</div>
          <div className="decks-empty-sub">Create your first — a proposal, business plan, or investment memo, written from your company profile.</div>
          <button className="decks-home-new" onClick={() => setShowModal(true)}>Create your first →</button>
        </div>
      ) : (
        <div className="decks-home-grid">
          {docs.map((d) => {
            const initials = d.title.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
            return (
              <div className="deck-card" key={d.id} onClick={() => openDoc(d.id)}>
                <div className="deck-card-preview">
                  <div className="deck-card-preview-inner">
                    <div className="deck-card-preview-title">{d.title}</div>
                  </div>
                  <div className="deck-card-preview-badge">{TYPE_LABEL[d.doc_type] ?? d.doc_type}</div>
                </div>
                <div className="deck-card-body">
                  <div className="deck-card-header-row">
                    <div className="deck-card-icon">{initials || "D"}</div>
                    <div>
                      <div className="deck-card-name">{d.title}</div>
                      <div className="deck-card-meta">
                        {relAgo(d.updated_at) === "—" ? "—" : `Edited ${relAgo(d.updated_at)}`}
                        {d.status !== "draft" && <span style={{ marginLeft: 8, textTransform: "capitalize", color: "var(--gold, #b8860b)" }}>· {d.status}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="deck-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="deck-card-btn primary" onClick={() => openDoc(d.id)}>Open</button>
                    <button className="deck-card-btn danger" onClick={() => handleDelete(d.id)}>Delete</button>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="deck-card deck-card-new" onClick={() => setShowModal(true)}>
            <div className="deck-card-new-inner">
              <div className="deck-card-new-plus">+</div>
              <div className="deck-card-new-label">New Document</div>
              <div className="deck-card-new-sub">Generate from your company profile</div>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <NewDocumentModal
          onClose={() => setShowModal(false)}
          onCreated={(id) => { setShowModal(false); openDoc(id); }}
        />
      )}
    </div>
  );
}

function NewDocumentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [docType, setDocType] = useState<DocType>("proposal");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    setBusy("Creating…");
    try {
      const doc = await createDocument(title.trim() || "Untitled Document", docType);
      setBusy("Generating…");
      try {
        await generateDocument(doc.id, docType, brief.trim() || undefined);
      } catch (e) {
        // The document exists; generation failed. Open it anyway so the user
        // can edit or retry from the editor rather than losing the document.
        setError(e instanceof Error ? e.message : "Created, but generation failed. Opening it anyway.");
      }
      onCreated(doc.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the document.");
      setBusy(null);
    }
  }

  return (
    <div className="wizard-overlay" onClick={onClose}>
      <div className="wizard-modal" onClick={(e) => e.stopPropagation()}>
        <h2>New document</h2>

        <label className="profile-field">
          <span>Document type</span>
          <select
            className="p-input"
            value={docType}
            onChange={(e) => setDocType(e.target.value as DocType)}
          >
            {DOC_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        <label className="profile-field">
          <span>Title</span>
          <input
            className="p-input"
            type="text"
            placeholder="e.g. Series A proposal, Q3 board report"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </label>

        <label className="profile-field">
          <span>Brief / instructions (optional)</span>
          <textarea
            className="p-input"
            rows={4}
            placeholder="Anything specific this document should emphasise or address."
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            style={{ resize: "vertical" }}
          />
        </label>

        {error && <p className="p-error">{error}</p>}

        <div className="wizard-actions">
          <button className="p-btn p-btn-secondary" onClick={onClose} disabled={!!busy}>
            Cancel
          </button>
          <button className="p-btn p-btn-primary" onClick={handleCreate} disabled={!!busy}>
            {busy ?? "Create & Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}
