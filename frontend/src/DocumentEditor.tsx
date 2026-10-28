import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDocument, updateDocument, generateDocument, exportDocument, getCompanyProfile,
  DOC_TYPE_OPTIONS,
  type FullDocument, type DocSection, type Letterhead, type DocType,
} from "./api";
import { compressImage, MAX_IMAGE_BYTES } from "./fileUtils";
import "./theme.css";
import "./document-editor.css";

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  DOC_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

const DEFAULT_ACCENT = "#b8860b";

/** The letterhead actually rendered: the custom one, or the profile fallback. */
function effectiveLetterhead(custom: Letterhead | null, fallback: Letterhead): Letterhead {
  return custom ?? fallback;
}

export default function DocumentEditor({
  docId,
  onBack,
}: {
  docId: string;
  onBack: () => void;
}) {
  const [doc, setDoc] = useState<FullDocument | null>(null);
  const [title, setTitle] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [docType, setDocType] = useState<DocType>("general");
  const [sections, setSections] = useState<DocSection[]>([]);
  const [letterhead, setLetterhead] = useState<Letterhead | null>(null);
  const [profileLetterhead, setProfileLetterhead] = useState<Letterhead>({
    logo_url: "", company_name: "", address: "", tagline: "", primary_color: "",
  });
  const [selected, setSelected] = useState(0);
  const [rightTab, setRightTab] = useState<"sections" | "letterhead">("sections");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dragIndex = useRef<number | null>(null);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  }

  const applyDoc = useCallback((d: FullDocument) => {
    setDoc(d);
    setTitle(d.title);
    setDocType(d.doc_type);
    setSections(d.content?.sections ?? []);
    setLetterhead(d.letterhead ?? null);
    setSelected(0);
    setDirty(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getDocument(docId)
      .then((d) => { if (!cancelled) applyDoc(d); })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't open this document."));
    getCompanyProfile()
      .then((p) => {
        if (cancelled) return;
        setProfileLetterhead({
          logo_url: p.logo_data_url || "",
          company_name: p.company_name || "",
          address: p.address || "",
          tagline: p.tagline || "",
          primary_color: p.brand_primary_color || "",
        });
      })
      .catch(() => { /* non-critical: the default letterhead just stays blank */ });
    return () => { cancelled = true; };
  }, [docId, applyDoc]);

  const markDirty = useCallback(() => setDirty(true), []);

  /* ---------------- save ---------------- */

  const save = useCallback(async () => {
    if (!doc) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateDocument(docId, {
        title: title.trim() || "Untitled Document",
        content: { sections },
        letterhead,
      });
      setDoc(updated);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save this document.");
    } finally {
      setSaving(false);
    }
  }, [doc, docId, title, sections, letterhead]);

  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);

  // Autosave on a short delay after any edit, so layout/text work isn't lost.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => { saveRef.current(); }, 2000);
    return () => clearTimeout(t);
  }, [dirty, sections, letterhead, title]);

  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      if (dirty) { e.preventDefault(); e.returnValue = ""; }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /* ---------------- actions ---------------- */

  async function regenerate() {
    if (!window.confirm("Regenerate rewrites every section from your company profile. Edits to this document will be lost. Continue?")) return;
    setBusy("Regenerating");
    setError(null);
    try {
      const d = await generateDocument(docId, docType);
      applyDoc(d);
      flash("Regenerated from your company profile.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't regenerate this document.");
    } finally {
      setBusy(null);
    }
  }

  async function exportPdf() {
    setBusy("Exporting");
    setError(null);
    try {
      // Save first so the PDF reflects the current edits.
      if (dirty) await save();
      const blob = await exportDocument(docId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safe = (title.trim() || "document").replace(/[^a-z0-9 \-_]/gi, "").trim() || "document";
      a.href = url;
      a.download = `${safe}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't export this document.");
    } finally {
      setBusy(null);
    }
  }

  /* ---------------- section editing ---------------- */

  function updateSection(index: number, field: keyof DocSection, value: string) {
    setSections((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
    markDirty();
  }

  function addSection() {
    setSections((prev) => {
      const next = [...prev, { heading: "New section", body: "" }];
      setSelected(next.length - 1);
      return next;
    });
    markDirty();
  }

  function deleteSection(index: number) {
    setSections((prev) => prev.filter((_, i) => i !== index));
    setSelected((s) => Math.max(0, s > index ? s - 1 : s === index ? Math.max(0, s - 1) : s));
    markDirty();
  }

  function reorder(from: number, to: number) {
    if (from === to) return;
    setSections((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setSelected(to);
    markDirty();
  }

  /* ---------------- letterhead editing ---------------- */

  const useCustom = letterhead !== null;

  function setCustomMode(custom: boolean) {
    if (custom) {
      // Seed the custom letterhead from whatever the profile provides, so the
      // user starts by editing the real values rather than a blank header.
      setLetterhead((prev) => prev ?? { ...profileLetterhead });
    } else {
      setLetterhead(null);
    }
    markDirty();
  }

  function updateLetterhead(field: keyof Letterhead, value: string) {
    setLetterhead((prev) => ({ ...(prev ?? profileLetterhead), [field]: value }));
    markDirty();
  }

  async function handleLogoUpload(file: File) {
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Logo is too large. Please use an image under 2MB.");
      return;
    }
    try {
      const dataUrl = await compressImage(file);
      updateLetterhead("logo_url", dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that image.");
    }
  }

  if (error && !doc) {
    return (
      <div className="doc-editor">
        <button className="p-btn p-btn-ghost" onClick={onBack}>&lt; Documents</button>
        <p className="p-error">{error}</p>
      </div>
    );
  }

  if (!doc) return <p className="doc-loading">Opening document…</p>;

  const lh = effectiveLetterhead(letterhead, profileLetterhead);
  const accent = lh.primary_color || DEFAULT_ACCENT;

  return (
    <div className="doc-editor">
      <header className="doc-toolbar">
        <div className="doc-toolbar-left">
          <button className="p-btn p-btn-ghost" onClick={onBack}>&lt; Documents</button>
          {editingTitle ? (
            <input
              className="p-input doc-title-input"
              value={title}
              autoFocus
              onChange={(e) => { setTitle(e.target.value); markDirty(); }}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
              }}
            />
          ) : (
            <button className="doc-title" title="Click to rename" onClick={() => setEditingTitle(true)}>
              {title || "Untitled Document"}
            </button>
          )}
          <span className="doc-type-badge">{TYPE_LABEL[docType] ?? docType}</span>
        </div>
        <div className="doc-toolbar-right">
          <span className="doc-save-state">
            {saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}
          </span>
          <button className="p-btn p-btn-ghost" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button className="p-btn p-btn-ghost" onClick={regenerate} disabled={!!busy}>
            {busy === "Regenerating" ? "Regenerating…" : "Regenerate"}
          </button>
          <button className="p-btn p-btn-secondary" onClick={exportPdf} disabled={!!busy}>
            {busy === "Exporting" ? "Exporting…" : "Export PDF"}
          </button>
        </div>
      </header>

      {error && <p className="p-error doc-inline-error">{error}</p>}
      {notice && <p className="doc-notice">{notice}</p>}

      <div className="doc-editor-body">
        {/* Left: A4 page preview */}
        <div className="doc-preview-wrap">
          <article className="doc-page" aria-label="Document preview">
            <div className="doc-letterhead" style={{ borderBottomColor: accent }}>
              {lh.logo_url && (
                <img className="doc-letterhead-logo" src={lh.logo_url} alt="" />
              )}
              <div className="doc-letterhead-text">
                {lh.company_name && (
                  <div className="doc-letterhead-name" style={{ color: accent }}>{lh.company_name}</div>
                )}
                {lh.tagline && <div className="doc-letterhead-tagline">{lh.tagline}</div>}
              </div>
              {lh.address && <div className="doc-letterhead-address">{lh.address}</div>}
            </div>

            <div className="doc-page-body">
              {title && <h1 className="doc-page-title">{title}</h1>}
              {sections.length === 0 ? (
                <p className="doc-page-empty">No content yet. Add a section, or use Regenerate to write this document from your profile.</p>
              ) : (
                sections.map((s, i) => (
                  <section
                    key={i}
                    className={`doc-page-section ${i === selected ? "doc-page-section-active" : ""}`}
                    onClick={() => { setSelected(i); setRightTab("sections"); }}
                  >
                    {s.heading && <h2 className="doc-page-heading" style={{ color: accent }}>{s.heading}</h2>}
                    {s.body.split(/\n{2,}/).map((para, j) => (
                      <p key={j} className="doc-page-para">{para}</p>
                    ))}
                  </section>
                ))
              )}
            </div>
          </article>
        </div>

        {/* Right: editor panel */}
        <aside className="doc-panel">
          <div className="doc-panel-tabs">
            <button
              className={`doc-panel-tab ${rightTab === "sections" ? "doc-panel-tab-active" : ""}`}
              onClick={() => setRightTab("sections")}
            >
              Sections
            </button>
            <button
              className={`doc-panel-tab ${rightTab === "letterhead" ? "doc-panel-tab-active" : ""}`}
              onClick={() => setRightTab("letterhead")}
            >
              Letterhead
            </button>
          </div>

          {rightTab === "sections" ? (
            <div className="doc-panel-body">
              <ul className="doc-section-list">
                {sections.map((s, i) => (
                  <li
                    key={i}
                    draggable
                    onDragStart={() => { dragIndex.current = i; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => { if (dragIndex.current !== null) reorder(dragIndex.current, i); dragIndex.current = null; }}
                    className={`doc-section-item ${i === selected ? "doc-section-item-active" : ""}`}
                    onClick={() => setSelected(i)}
                    title="Drag to reorder"
                  >
                    <span className="doc-section-grip" aria-hidden="true">⋮⋮</span>
                    <span className="doc-section-label">{s.heading || `Section ${i + 1}`}</span>
                  </li>
                ))}
              </ul>
              <button className="p-btn p-btn-ghost doc-add-section" onClick={addSection}>+ Add section</button>

              {sections[selected] && (
                <div className="doc-section-editor">
                  <label className="doc-field">
                    <span>Heading</span>
                    <input
                      className="p-input"
                      value={sections[selected].heading}
                      onChange={(e) => updateSection(selected, "heading", e.target.value)}
                    />
                  </label>
                  <label className="doc-field">
                    <span>Body</span>
                    <textarea
                      className="p-input doc-body-textarea"
                      rows={16}
                      value={sections[selected].body}
                      onChange={(e) => updateSection(selected, "body", e.target.value)}
                      placeholder="Write this section's prose. Separate paragraphs with a blank line."
                    />
                  </label>
                  <button
                    className="p-btn p-btn-ghost doc-delete-section"
                    onClick={() => deleteSection(selected)}
                  >
                    Delete section
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="doc-panel-body">
              <div className="doc-field">
                <span className="doc-field-label">Letterhead source</span>
                <label className="doc-radio">
                  <input type="radio" checked={!useCustom} onChange={() => setCustomMode(false)} />
                  Use company profile
                </label>
                <label className="doc-radio">
                  <input type="radio" checked={useCustom} onChange={() => setCustomMode(true)} />
                  Custom
                </label>
              </div>

              {useCustom && letterhead && (
                <>
                  <div className="doc-field">
                    <span>Logo</span>
                    {letterhead.logo_url ? (
                      <div className="doc-logo-preview">
                        <img src={letterhead.logo_url} alt="Letterhead logo" />
                        <button className="p-btn p-btn-ghost" onClick={() => updateLetterhead("logo_url", "")}>Remove</button>
                      </div>
                    ) : (
                      <label className="doc-upload">
                        <input
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(e) => e.target.files?.[0] && handleLogoUpload(e.target.files[0])}
                        />
                        Click to upload logo
                      </label>
                    )}
                  </div>
                  <label className="doc-field">
                    <span>Company name</span>
                    <input className="p-input" value={letterhead.company_name} onChange={(e) => updateLetterhead("company_name", e.target.value)} />
                  </label>
                  <label className="doc-field">
                    <span>Address</span>
                    <textarea className="p-input" rows={3} value={letterhead.address} onChange={(e) => updateLetterhead("address", e.target.value)} style={{ resize: "vertical" }} />
                  </label>
                  <label className="doc-field">
                    <span>Tagline</span>
                    <input className="p-input" value={letterhead.tagline} onChange={(e) => updateLetterhead("tagline", e.target.value)} />
                  </label>
                  <label className="doc-field">
                    <span>Accent color</span>
                    <span className="doc-color-row">
                      <input type="color" value={letterhead.primary_color || DEFAULT_ACCENT} onChange={(e) => updateLetterhead("primary_color", e.target.value)} />
                      <input className="p-input" value={letterhead.primary_color} onChange={(e) => updateLetterhead("primary_color", e.target.value)} placeholder={DEFAULT_ACCENT} />
                    </span>
                  </label>
                </>
              )}
              {!useCustom && (
                <p className="doc-panel-note">
                  This document uses your company profile's logo, name, address, tagline and brand colour. Edit those in Settings → Brand, or switch to Custom to override them here.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
