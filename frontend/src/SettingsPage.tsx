import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Members from "./Members";
import { getCompanyProfile, saveCompanyProfile, type CompanyProfile } from "./api";
import { compressImage, MAX_IMAGE_BYTES } from "./fileUtils";
import "./settings.css";

type Section = "profile" | "brand" | "members" | "billing";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "brand", label: "Brand" },
  { id: "members", label: "Members" },
  { id: "billing", label: "Billing" },
];

export default function SettingsPage({
  userName,
  userEmail,
}: {
  userName: string;
  userEmail: string;
}) {
  const [active, setActive] = useState<Section>("members");
  const navigate = useNavigate();

  return (
    <div className="settings-page">
      <aside className="settings-sidebar">
        <h1 className="settings-title">Settings</h1>
        <nav className="settings-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`settings-nav-item ${active === s.id ? "settings-nav-item-active" : ""}`}
              onClick={() => {
                if (s.id === "billing") {
                  navigate("/billing");
                  return;
                }
                setActive(s.id);
              }}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="settings-content">
        {active === "profile" && (
          <div className="settings-profile">
            <div className="settings-section-head">
              <h2>Profile</h2>
              <p className="settings-section-desc">Your account details.</p>
            </div>
            <div className="profile-field">
              <label className="profile-field-label">Name</label>
              <div className="profile-field-value">{userName || <span className="profile-field-empty">Not set</span>}</div>
            </div>
            <div className="profile-field">
              <label className="profile-field-label">Email</label>
              <div className="profile-field-value">{userEmail || <span className="profile-field-empty">Not set</span>}</div>
            </div>
          </div>
        )}

        {active === "brand" && <BrandSettings />}

        {active === "members" && <Members />}
      </div>
    </div>
  );
}

/**
 * Brand kit: logo, brand colours, address and tagline. These are stored on the
 * company profile and become the default letterhead for every Provisio Doc.
 */
function BrandSettings() {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCompanyProfile()
      .then(setProfile)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your brand settings."));
  }, []);

  function patch(changes: Partial<CompanyProfile>) {
    setProfile((p) => (p ? { ...p, ...changes } : p));
  }

  async function handleLogoUpload(file: File) {
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Logo is too large. Please use an image under 2MB.");
      return;
    }
    try {
      const dataUrl = await compressImage(file);
      patch({ logo_data_url: dataUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that image.");
    }
  }

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    setError(null);
    try {
      await saveCompanyProfile(profile);
      setSavedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your brand settings.");
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return (
      <div className="settings-profile">
        {error ? <p className="p-error">{error}</p> : <p className="settings-section-desc">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="settings-profile">
      <div className="settings-section-head">
        <h2>Brand</h2>
        <p className="settings-section-desc">
          Your logo, colours, address and tagline. These are applied as the default letterhead on every document you generate.
        </p>
      </div>

      {error && <p className="p-error">{error}</p>}

      <div className="profile-field">
        <label className="profile-field-label">Company logo</label>
        {profile.logo_data_url ? (
          <div className="logo-preview">
            <img src={profile.logo_data_url} alt="Company logo" style={{ maxHeight: 64, maxWidth: 180, objectFit: "contain", background: "#fff", borderRadius: 6, padding: 4 }} />
            <button className="p-btn p-btn-ghost" onClick={() => patch({ logo_data_url: "" })}>Remove</button>
          </div>
        ) : (
          <label className="upload-dropzone" style={{ display: "inline-block", cursor: "pointer" }}>
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && handleLogoUpload(e.target.files[0])} />
            Click to upload logo
          </label>
        )}
      </div>

      <div className="profile-field">
        <label className="profile-field-label">Primary color</label>
        <span style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input type="color" value={profile.brand_primary_color || "#b8860b"} onChange={(e) => patch({ brand_primary_color: e.target.value })} style={{ width: 44, height: 36 }} />
          <input className="p-input" value={profile.brand_primary_color} placeholder="#b8860b" onChange={(e) => patch({ brand_primary_color: e.target.value })} style={{ maxWidth: 160 }} />
        </span>
      </div>

      <div className="profile-field">
        <label className="profile-field-label">Secondary color</label>
        <span style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input type="color" value={profile.brand_secondary_color || "#161412"} onChange={(e) => patch({ brand_secondary_color: e.target.value })} style={{ width: 44, height: 36 }} />
          <input className="p-input" value={profile.brand_secondary_color} placeholder="#161412" onChange={(e) => patch({ brand_secondary_color: e.target.value })} style={{ maxWidth: 160 }} />
        </span>
      </div>

      <div className="profile-field">
        <label className="profile-field-label">Company address</label>
        <textarea className="p-input" rows={3} value={profile.address} onChange={(e) => patch({ address: e.target.value })} style={{ resize: "vertical" }} />
      </div>

      <div className="profile-field">
        <label className="profile-field-label">Tagline</label>
        <input className="p-input" value={profile.tagline} onChange={(e) => patch({ tagline: e.target.value })} placeholder="e.g. Banking for the next billion" />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "1rem" }}>
        <button className="p-btn p-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save brand settings"}
        </button>
        {savedAt && <span className="profile-saved-note">Saved {savedAt.toLocaleTimeString()}</span>}
      </div>
    </div>
  );
}
