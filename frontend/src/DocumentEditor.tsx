import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Node, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Typography } from "@tiptap/extension-typography";
import { TextAlign } from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Image } from "@tiptap/extension-image";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Highlight } from "@tiptap/extension-highlight";
import { CharacterCount } from "@tiptap/extension-character-count";
import {
  getDocument, updateDocument, generateDocument, getCompanyProfile,
  DOC_TYPE_OPTIONS,
  type FullDocument, type Letterhead, type LetterheadTemplate, type DocType,
} from "./api";
import { compressImage, MAX_IMAGE_BYTES } from "./fileUtils";
import "./theme.css";
import "./document-editor.css";

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  DOC_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

const DEFAULT_ACCENT = "#b8860b";

/* ------------------------------------------------------------------ */
/* Content conversion                                                  */
/* ------------------------------------------------------------------ */

type TipTapDoc = JSONContent;

const EMPTY_DOC: TipTapDoc = { type: "doc", content: [{ type: "paragraph" }] };

/** Convert the legacy {sections:[{heading, body}]} shape into TipTap JSON. */
function sectionsToDoc(sections: { heading?: string; body?: string }[]): TipTapDoc {
  const nodes: JSONContent[] = [];
  for (const s of sections) {
    const heading = (s.heading || "").trim();
    if (heading) {
      nodes.push({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: heading }] });
    }
    const body = (s.body || "").trim();
    for (const para of body.split(/\n{2,}/)) {
      const text = para.trim();
      if (text) nodes.push({ type: "paragraph", content: [{ type: "text", text }] });
    }
  }
  if (nodes.length === 0) nodes.push({ type: "paragraph" });
  return { type: "doc", content: nodes };
}

/** Normalise whatever is stored on the document into a TipTap JSON doc the
 *  editor can load: pass through TipTap JSON, convert the legacy section
 *  format, or fall back to an empty document. */
function toTipTapDoc(content: unknown): TipTapDoc {
  if (content && typeof content === "object") {
    const c = content as Record<string, unknown>;
    if (c.type === "doc" && Array.isArray(c.content)) return c as unknown as TipTapDoc;
    if (Array.isArray(c.sections)) return sectionsToDoc(c.sections as { heading?: string; body?: string }[]);
  }
  return EMPTY_DOC;
}

/* ------------------------------------------------------------------ */
/* Custom block nodes: page break and signature block                 */
/* ------------------------------------------------------------------ */

const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },
  renderHTML() {
    return ["div", { "data-page-break": "true", class: "doc-pagebreak" }];
  },
});

const SignatureBlock = Node.create({
  name: "signatureBlock",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: "div[data-signature-block]" }];
  },
  renderHTML() {
    return [
      "div",
      { "data-signature-block": "true", class: "doc-signature" },
      ["div", { class: "doc-signature-col" },
        ["div", { class: "doc-signature-line" }],
        ["div", { class: "doc-signature-label" }, "Signature"],
      ],
      ["div", { class: "doc-signature-col" },
        ["div", { class: "doc-signature-line" }],
        ["div", { class: "doc-signature-label" }, "Date"],
      ],
    ];
  },
});

/* ------------------------------------------------------------------ */
/* Letterhead templates                                                */
/* ------------------------------------------------------------------ */

const LETTERHEAD_TEMPLATES: { id: LetterheadTemplate; label: string }[] = [
  { id: "minimal", label: "Minimal" },
  { id: "classic", label: "Classic" },
  { id: "bold", label: "Bold" },
  { id: "modern", label: "Modern" },
  { id: "legal", label: "Legal" },
];

/** A letterhead with every field resolved: custom value, else profile fallback. */
interface ResolvedLetterhead {
  template: LetterheadTemplate;
  logo_url: string;
  company_name: string;
  tagline: string;
  address: string;
  contact: string;
  accent: string;
}

function LetterheadView({ lh }: { lh: ResolvedLetterhead }) {
  const accent = lh.accent || DEFAULT_ACCENT;
  const logo = lh.logo_url
    ? <img className="lh-logo" src={lh.logo_url} alt="" />
    : null;

  switch (lh.template) {
    case "classic":
      return (
        <header className="lh lh-classic">
          <div className="lh-classic-top">
            {logo}
            <div className="lh-classic-name" style={{ color: accent }}>{lh.company_name}</div>
          </div>
          <div className="lh-bar" style={{ background: accent }} />
          {lh.tagline && <div className="lh-classic-tagline">{lh.tagline}</div>}
        </header>
      );
    case "bold":
      return (
        <header className="lh lh-bold" style={{ background: accent }}>
          <div className="lh-bold-inner">
            {logo}
            <div className="lh-bold-name">{lh.company_name}</div>
            {lh.tagline && <div className="lh-bold-tagline">{lh.tagline}</div>}
          </div>
          <div className="lh-bold-cut" />
        </header>
      );
    case "modern":
      return (
        <header className="lh lh-modern">
          <div className="lh-modern-left">
            {logo}
            <div className="lh-modern-name" style={{ color: accent }}>{lh.company_name}</div>
          </div>
          <div className="lh-modern-rule" style={{ background: accent }} />
          <div className="lh-modern-right">
            {lh.address && <div className="lh-modern-address">{lh.address}</div>}
            {lh.contact && <div className="lh-modern-contact">{lh.contact}</div>}
          </div>
        </header>
      );
    case "legal":
      return (
        <header className="lh lh-legal">
          {lh.logo_url && <img className="lh-legal-logo" src={lh.logo_url} alt="" />}
          <div className="lh-legal-name">{lh.company_name}</div>
          {lh.address && <div className="lh-legal-address">{lh.address}</div>}
          {lh.contact && <div className="lh-legal-address">{lh.contact}</div>}
          <div className="lh-legal-rule" style={{ borderColor: accent }} />
        </header>
      );
    case "minimal":
    default:
      return (
        <header className="lh lh-minimal">
          <div className="lh-minimal-top">
            <div className="lh-minimal-name">{lh.company_name}</div>
            {(lh.address || lh.contact) && (
              <div className="lh-minimal-meta">
                {lh.address && <div>{lh.address}</div>}
                {lh.contact && <div>{lh.contact}</div>}
              </div>
            )}
          </div>
          <div className="lh-minimal-rule" style={{ background: accent }} />
        </header>
      );
  }
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

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
  const [letterhead, setLetterhead] = useState<Letterhead | null>(null);
  const [profile, setProfile] = useState<Letterhead>({
    logo_url: "", company_name: "", address: "", tagline: "", contact: "", primary_color: "",
  });
  const [rightTab, setRightTab] = useState<"insert" | "letterhead">("insert");
  const [dirty, setDirty] = useState(false);
  const [contentVersion, setContentVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [textColor, setTextColor] = useState("#1a1a1a");
  const [highlightColor, setHighlightColor] = useState("#fff3a3");
  // Bumped on every editor transaction so the toolbar active-states and the
  // outline re-render in step with the selection and content.
  const [, setTick] = useState(0);
  const loadedDocId = useRef<string | null>(null);
  const imageInput = useRef<HTMLInputElement | null>(null);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  }

  const markDirty = useCallback(() => {
    setDirty(true);
    setContentVersion((v) => v + 1);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: "Start writing your document…" }),
      Typography,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({ inline: false, allowBase64: true }),
      CharacterCount,
      PageBreak,
      SignatureBlock,
    ],
    content: EMPTY_DOC,
    editorProps: { attributes: { class: "doc-prosemirror" } },
    onUpdate: () => markDirty(),
    onTransaction: () => setTick((t) => t + 1),
  });

  /* ---------------- load ---------------- */

  const applyMeta = useCallback((d: FullDocument) => {
    setDoc(d);
    setTitle(d.title);
    setDocType(d.doc_type);
    setLetterhead(d.letterhead ?? null);
    setDirty(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getDocument(docId)
      .then((d) => { if (!cancelled) applyMeta(d); })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't open this document."));
    getCompanyProfile()
      .then((p) => {
        if (cancelled) return;
        setProfile({
          logo_url: p.logo_data_url || "",
          company_name: p.company_name || "",
          address: p.address || "",
          tagline: p.tagline || "",
          contact: "",
          primary_color: p.brand_primary_color || "",
        });
      })
      .catch(() => { /* non-critical: letterhead fallback just stays blank */ });
    return () => { cancelled = true; };
  }, [docId, applyMeta]);

  // Load the document's body into the editor once both are ready. Loading a
  // different document (or a regenerate, which resets loadedDocId) re-applies.
  useEffect(() => {
    if (!doc || !editor) return;
    if (loadedDocId.current === doc.id) return;
    loadedDocId.current = doc.id;
    editor.commands.setContent(toTipTapDoc(doc.content), { emitUpdate: false });
    setDirty(false);
  }, [doc, editor]);

  /* ---------------- save ---------------- */

  const save = useCallback(async () => {
    if (!doc || !editor) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateDocument(docId, {
        title: title.trim() || "Untitled Document",
        content: editor.getJSON(),
        letterhead,
      });
      setDoc(updated);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save this document.");
    } finally {
      setSaving(false);
    }
  }, [doc, editor, docId, title, letterhead]);

  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);

  // Debounced autosave: 2s after the last edit (same cadence as the deck editor).
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => { saveRef.current(); }, 2000);
    return () => clearTimeout(t);
  }, [dirty, contentVersion]);

  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      if (dirty) { e.preventDefault(); e.returnValue = ""; }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /* ---------------- actions ---------------- */

  async function regenerate() {
    if (!window.confirm("Regenerate rewrites this document from your company profile. Your current edits will be lost. Continue?")) return;
    setBusy("Regenerating");
    setError(null);
    try {
      const d = await generateDocument(docId, docType);
      loadedDocId.current = null; // force the load effect to re-apply the new body
      applyMeta(d);
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
      if (dirty) await save();
      // Reliable path: a print-optimised view (see @media print in the CSS)
      // that the browser turns into a PDF via "Save as PDF".
      window.print();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open the print view.");
    } finally {
      setBusy(null);
    }
  }

  /* ---------------- letterhead editing ---------------- */

  function toggleLetterhead(on: boolean) {
    if (on) {
      setLetterhead((prev) => prev ?? {
        template: "minimal",
        logo_url: "", company_name: "", address: "", tagline: "", contact: "", primary_color: "",
      });
    } else {
      setLetterhead(null);
    }
    markDirty();
  }

  function updateLetterhead(field: keyof Letterhead, value: string) {
    setLetterhead((prev) => ({
      ...(prev ?? { template: "minimal", logo_url: "", company_name: "", address: "", tagline: "", contact: "", primary_color: "" }),
      [field]: value,
    }));
    markDirty();
  }

  async function handleLogoUpload(file: File) {
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Logo is too large. Please use an image under 2MB.");
      return;
    }
    try {
      updateLetterhead("logo_url", await compressImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that image.");
    }
  }

  async function handleImageInsert(file: File) {
    if (!editor) return;
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image is too large. Please use one under 2MB.");
      return;
    }
    try {
      const dataUrl = await compressImage(file);
      editor.chain().focus().setImage({ src: dataUrl }).run();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that image.");
    }
  }

  /* ---------------- render guards ---------------- */

  if (error && !doc) {
    return (
      <div className="doc-editor">
        <button className="p-btn p-btn-ghost" onClick={onBack}>&lt; Documents</button>
        <p className="p-error">{error}</p>
      </div>
    );
  }

  if (!doc) return <p className="doc-loading">Opening document…</p>;

  /* ---------------- derived values ---------------- */

  const resolved: ResolvedLetterhead | null = letterhead && {
    template: letterhead.template || "minimal",
    logo_url: letterhead.logo_url || profile.logo_url,
    company_name: letterhead.company_name || profile.company_name,
    tagline: letterhead.tagline || profile.tagline,
    address: letterhead.address || profile.address,
    contact: letterhead.contact || "",
    accent: letterhead.primary_color || profile.primary_color || DEFAULT_ACCENT,
  };
  const accent = (letterhead?.primary_color || profile.primary_color) || DEFAULT_ACCENT;

  // Document outline from the live editor state.
  const outline: { level: number; text: string; pos: number }[] = [];
  if (editor) {
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        outline.push({ level: node.attrs.level as number, text: node.textContent || "Untitled heading", pos });
      }
      return true;
    });
  }

  function scrollToHeading(pos: number) {
    if (!editor) return;
    let el = editor.view.nodeDOM(pos) as HTMLElement | null;
    if (!el) {
      const at = editor.view.domAtPos(pos + 1).node;
      el = at instanceof HTMLElement ? at : at.parentElement;
    }
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const headingValue =
    editor?.isActive("heading", { level: 1 }) ? "h1"
      : editor?.isActive("heading", { level: 2 }) ? "h2"
        : editor?.isActive("heading", { level: 3 }) ? "h3"
          : "paragraph";

  function setBlockStyle(value: string) {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (value === "paragraph") chain.setParagraph().run();
    else chain.setHeading({ level: Number(value[1]) as 1 | 2 | 3 }).run();
  }

  const btn = (active: boolean) => `doc-fmt-btn${active ? " doc-fmt-btn-active" : ""}`;

  const pageStyle: React.CSSProperties & Record<string, string> =
    { "--doc-accent": accent } as React.CSSProperties & Record<string, string>;

  return (
    <div className="doc-editor">
      {/* ── Top toolbar ─────────────────────────────────────────── */}
      <header className="doc-toolbar doc-print-hide">
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

      {/* ── Formatting ribbon ───────────────────────────────────── */}
      <div className="doc-format-toolbar doc-print-hide">
        <select
          className="doc-fmt-select"
          value={headingValue}
          onChange={(e) => setBlockStyle(e.target.value)}
          title="Text style"
        >
          <option value="paragraph">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>

        <span className="doc-fmt-sep" />
        <button className={btn(!!editor?.isActive("bold"))} onClick={() => editor?.chain().focus().toggleBold().run()} title="Bold"><b>B</b></button>
        <button className={btn(!!editor?.isActive("italic"))} onClick={() => editor?.chain().focus().toggleItalic().run()} title="Italic"><i>I</i></button>
        <button className={btn(!!editor?.isActive("underline"))} onClick={() => editor?.chain().focus().toggleUnderline().run()} title="Underline"><u>U</u></button>

        <span className="doc-fmt-sep" />
        <button className={btn(!!editor?.isActive({ textAlign: "left" }))} onClick={() => editor?.chain().focus().setTextAlign("left").run()} title="Align left">⟸</button>
        <button className={btn(!!editor?.isActive({ textAlign: "center" }))} onClick={() => editor?.chain().focus().setTextAlign("center").run()} title="Align center">≡</button>
        <button className={btn(!!editor?.isActive({ textAlign: "right" }))} onClick={() => editor?.chain().focus().setTextAlign("right").run()} title="Align right">⟹</button>
        <button className={btn(!!editor?.isActive({ textAlign: "justify" }))} onClick={() => editor?.chain().focus().setTextAlign("justify").run()} title="Justify">▦</button>

        <span className="doc-fmt-sep" />
        <button className={btn(!!editor?.isActive("bulletList"))} onClick={() => editor?.chain().focus().toggleBulletList().run()} title="Bullet list">• ☰</button>
        <button className={btn(!!editor?.isActive("orderedList"))} onClick={() => editor?.chain().focus().toggleOrderedList().run()} title="Numbered list">1. ☰</button>

        <span className="doc-fmt-sep" />
        <button className={btn(false)} onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert table">⊞</button>
        <button className={btn(false)} onClick={() => editor?.chain().focus().setHorizontalRule().run()} title="Insert divider">―</button>
        <button className={btn(false)} onClick={() => imageInput.current?.click()} title="Insert image">🖼</button>

        <span className="doc-fmt-sep" />
        <label className="doc-fmt-color" title="Text color">
          A
          <input
            type="color"
            value={textColor}
            onChange={(e) => { setTextColor(e.target.value); editor?.chain().focus().setColor(e.target.value).run(); }}
          />
        </label>
        <label className="doc-fmt-color doc-fmt-highlight" title="Highlight color">
          H
          <input
            type="color"
            value={highlightColor}
            onChange={(e) => { setHighlightColor(e.target.value); editor?.chain().focus().toggleHighlight({ color: e.target.value }).run(); }}
          />
        </label>

        <span className="doc-fmt-sep" />
        <button className={btn(false)} onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().unsetColor().run()} title="Clear formatting">⨯</button>

        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => { if (e.target.files?.[0]) handleImageInsert(e.target.files[0]); e.target.value = ""; }}
        />
      </div>

      {error && <p className="p-error doc-inline-error doc-print-hide">{error}</p>}
      {notice && <p className="doc-notice doc-print-hide">{notice}</p>}

      <div className="doc-editor-body">
        {/* ── Left: outline ───────────────────────────────────── */}
        <nav className="doc-outline doc-print-hide" aria-label="Document outline">
          <div className="doc-outline-title">Outline</div>
          {outline.length === 0 ? (
            <p className="doc-outline-empty">Headings appear here.</p>
          ) : (
            <ul className="doc-outline-list">
              {outline.map((h, i) => (
                <li key={i}>
                  <button
                    className={`doc-outline-item doc-outline-l${h.level}`}
                    onClick={() => scrollToHeading(h.pos)}
                    title={h.text}
                  >
                    {h.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>

        {/* ── Center: the A4 page ─────────────────────────────── */}
        <div className="doc-preview-wrap">
          <article
            className="doc-page"
            style={pageStyle}
            aria-label="Document"
          >
            {resolved && <LetterheadView lh={resolved} />}
            <EditorContent editor={editor} className="doc-page-editor" />
          </article>
        </div>

        {/* ── Right: Insert / Letterhead panel ────────────────── */}
        <aside className="doc-panel doc-print-hide">
          <div className="doc-panel-tabs">
            <button
              className={`doc-panel-tab ${rightTab === "insert" ? "doc-panel-tab-active" : ""}`}
              onClick={() => setRightTab("insert")}
            >
              Insert
            </button>
            <button
              className={`doc-panel-tab ${rightTab === "letterhead" ? "doc-panel-tab-active" : ""}`}
              onClick={() => setRightTab("letterhead")}
            >
              Letterhead
            </button>
          </div>

          {rightTab === "insert" ? (
            <div className="doc-panel-body doc-insert-grid">
              <button className="doc-insert-btn" onClick={() => editor?.chain().focus().setParagraph().run()}>+ Paragraph</button>
              <button className="doc-insert-btn" onClick={() => editor?.chain().focus().setHeading({ level: 1 }).run()}>+ Heading 1</button>
              <button className="doc-insert-btn" onClick={() => editor?.chain().focus().setHeading({ level: 2 }).run()}>+ Heading 2</button>
              <button className="doc-insert-btn" onClick={() => editor?.chain().focus().setHeading({ level: 3 }).run()}>+ Heading 3</button>
              <button className="doc-insert-btn" onClick={() => editor?.chain().focus().toggleBulletList().run()}>+ Bullet list</button>
              <button className="doc-insert-btn" onClick={() => editor?.chain().focus().toggleOrderedList().run()}>+ Numbered list</button>
              <button className="doc-insert-btn" onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>+ Table</button>
              <button className="doc-insert-btn" onClick={() => editor?.chain().focus().setHorizontalRule().run()}>+ Divider</button>
              <button className="doc-insert-btn" onClick={() => imageInput.current?.click()}>+ Image</button>
              <button className="doc-insert-btn" onClick={() => editor?.chain().focus().insertContent({ type: "signatureBlock" }).run()}>+ Signature block</button>
              <button className="doc-insert-btn" onClick={() => editor?.chain().focus().insertContent({ type: "pageBreak" }).run()}>+ Page break</button>
            </div>
          ) : (
            <div className="doc-panel-body">
              <label className="doc-toggle">
                <input
                  type="checkbox"
                  checked={letterhead !== null}
                  onChange={(e) => toggleLetterhead(e.target.checked)}
                />
                Add letterhead to this document
              </label>

              {letterhead && (
                <>
                  <div className="doc-field">
                    <span className="doc-field-label">Template</span>
                    <div className="doc-template-grid">
                      {LETTERHEAD_TEMPLATES.map((t) => (
                        <button
                          key={t.id}
                          className={`doc-template-card${(letterhead.template || "minimal") === t.id ? " doc-template-card-active" : ""}`}
                          onClick={() => updateLetterhead("template", t.id)}
                        >
                          <span className={`doc-template-thumb thumb-${t.id}`} aria-hidden="true" />
                          <span className="doc-template-name">{t.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

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
                    <input className="p-input" value={letterhead.company_name} placeholder={profile.company_name} onChange={(e) => updateLetterhead("company_name", e.target.value)} />
                  </label>
                  <label className="doc-field">
                    <span>Tagline</span>
                    <input className="p-input" value={letterhead.tagline} placeholder={profile.tagline} onChange={(e) => updateLetterhead("tagline", e.target.value)} />
                  </label>
                  <label className="doc-field">
                    <span>Address</span>
                    <textarea className="p-input" rows={3} value={letterhead.address} placeholder={profile.address} onChange={(e) => updateLetterhead("address", e.target.value)} style={{ resize: "vertical" }} />
                  </label>
                  <label className="doc-field">
                    <span>Phone / email</span>
                    <input className="p-input" value={letterhead.contact || ""} onChange={(e) => updateLetterhead("contact", e.target.value)} />
                  </label>
                  <label className="doc-field">
                    <span>Accent color</span>
                    <span className="doc-color-row">
                      <input type="color" value={letterhead.primary_color || accent} onChange={(e) => updateLetterhead("primary_color", e.target.value)} />
                      <input className="p-input" value={letterhead.primary_color} placeholder={profile.primary_color || DEFAULT_ACCENT} onChange={(e) => updateLetterhead("primary_color", e.target.value)} />
                    </span>
                  </label>
                  <p className="doc-panel-note">Empty fields fall back to your company profile.</p>
                </>
              )}
              {!letterhead && (
                <p className="doc-panel-note">
                  No letterhead on this document. Turn it on to add a branded header drawn from one of five templates.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
