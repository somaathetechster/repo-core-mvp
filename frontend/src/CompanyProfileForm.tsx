import { useEffect, useState } from "react";
import DeckImport from "./DeckImport";
import { getCompanyProfile, saveCompanyProfile, type CompanyProfile, type TeamMember, type TaggedImage } from "./api";
import { fileToDataUrl, extractDominantColor, MAX_IMAGE_BYTES } from "./fileUtils";
import "./theme.css";
import "./profile-form.css";

const EMPTY_TEAM_MEMBER: TeamMember = { name: "", role: "", bio: "", photo_data_url: "", linkedin_url: "" };

const EMPTY_PROFILE: CompanyProfile = {
  company_name: "",
  one_liner: "",
  website_url: "",
  industry: "",
  stage: "",
  location: "",
  founded_date: "",
  incorporation_status: "",
  incorporation_country: "",
  logo_data_url: "",
  company_image_data_urls: [],
  demo_video_url: "",
  brand_primary_color: "",
  brand_secondary_color: "",
  brand_font_style: "serif",
  problem: "",
  solution: "",
  evidence_of_innovation: "",
  differentiation: "",
  patents_or_ip: "",
  market_research: "",
  market_opportunity: "",
  tam: "",
  sam: "",
  som: "",
  competitive_landscape: "",
  go_to_market: "",
  traction: "",
  key_metrics: "",
  business_model: "",
  pricing_model: "",
  team_members: [],
  funding_ask: "",
  use_of_funds: "",
  previous_funding: "",
  valuation_expectation: "",
  risks_and_mitigations: "",
  program_name: "",
  program_type: "",
  program_url: "",
  program_requirements: "",
  program_deadline: "",
};

type TextField = Exclude<
  keyof CompanyProfile,
  "team_members" | "company_image_data_urls"
>;

interface FieldSpec {
  key: TextField;
  label: string;
  placeholder: string;
  multiline?: boolean;
  isUrl?: boolean;
}

interface Section {
  title: string;
  description: string;
  fields: FieldSpec[];
}

const SECTIONS: Section[] = [
  {
    title: "Identity",
    description: "The basics that anchor every other section.",
    fields: [
      { key: "company_name", label: "Company name", placeholder: "Acme Robotics" },
      { key: "one_liner", label: "One-liner", placeholder: "What you do, in one sentence" },
      { key: "website_url", label: "Website", placeholder: "https://acme.com", isUrl: true },
      { key: "industry", label: "Industry", placeholder: "e.g. Fintech, Robotics, Healthtech" },
      { key: "stage", label: "Stage", placeholder: "e.g. Pre-seed, Seed, Series A" },
      { key: "location", label: "Location", placeholder: "City, country" },
      { key: "founded_date", label: "Founded", placeholder: "e.g. March 2024" },
      { key: "incorporation_status", label: "Incorporation status", placeholder: "e.g. C-Corp, registered June 2024" },
      { key: "incorporation_country", label: "Incorporation country", placeholder: "e.g. United States" },
    ],
  },
  {
    title: "The narrative",
    description: "What problem you solve and why your approach is the right one.",
    fields: [
      { key: "problem", label: "Problem", placeholder: "What problem are you solving, and for whom?", multiline: true },
      { key: "solution", label: "Solution", placeholder: "How does your product solve it?", multiline: true },
      { key: "evidence_of_innovation", label: "Evidence of innovation", placeholder: "What's technically or strategically novel here?", multiline: true },
      { key: "differentiation", label: "Differentiation", placeholder: "Why can't an incumbent or competitor just copy this?", multiline: true },
      { key: "patents_or_ip", label: "Patents or IP", placeholder: "Any filed, pending, or provisional patents, or other protected IP", multiline: true },
    ],
  },
  {
    title: "Market",
    description: "How big is this, and who else is already in it.",
    fields: [
      { key: "market_research", label: "Market research", placeholder: "What research supports the size and timing of this opportunity?", multiline: true },
      { key: "market_opportunity", label: "Market opportunity narrative", placeholder: "The story behind the numbers below", multiline: true },
      { key: "tam", label: "TAM (Total addressable market)", placeholder: "e.g. $12B globally, source: [report name]" },
      { key: "sam", label: "SAM (Serviceable addressable market)", placeholder: "e.g. $2.1B in your initial target segment" },
      { key: "som", label: "SOM (Serviceable obtainable market)", placeholder: "e.g. $40M realistically reachable in 3 years" },
      { key: "competitive_landscape", label: "Competitive landscape", placeholder: "Who else is solving this, and how are you positioned against them?", multiline: true },
      { key: "go_to_market", label: "Go-to-market strategy", placeholder: "How will you actually acquire your first, and next, customers?", multiline: true },
    ],
  },
  {
    title: "Traction and business",
    description: "What's real right now, and how the business actually makes money.",
    fields: [
      { key: "traction", label: "Traction", placeholder: "Users, pilots, LOIs, waitlist, revenue if any. State only what's real.", multiline: true },
      { key: "key_metrics", label: "Key metrics", placeholder: "The 2-4 numbers that best show momentum", multiline: true },
      { key: "business_model", label: "Business model", placeholder: "How do you charge, and what does the unit economics look like?", multiline: true },
      { key: "pricing_model", label: "Pricing model", placeholder: "e.g. $49/mo per seat, usage-based, one-time license", multiline: true },
    ],
  },
  {
    title: "The ask",
    description: "What you're raising and what happens to the money.",
    fields: [
      { key: "funding_ask", label: "Funding ask", placeholder: "How much are you raising, and on what terms if known?", multiline: true },
      { key: "use_of_funds", label: "Use of funds", placeholder: "What will this money actually go toward in the next 12-18 months?", multiline: true },
      { key: "previous_funding", label: "Previous funding", placeholder: "Any prior rounds, amounts, and investors, if applicable", multiline: true },
      { key: "valuation_expectation", label: "Valuation expectation", placeholder: "If you have one and want it included" },
    ],
  },
  {
    title: "Risk",
    description: "What could go wrong, stated plainly.",
    fields: [
      { key: "risks_and_mitigations", label: "Risks and mitigations", placeholder: "The real risks an investor would ask about, and how you're addressing them", multiline: true },
    ],
  },
];

interface CompanyProfileFormProps {
  // When provided, the form loads/saves against these instead of the
  // shared company profile endpoints, letting the same UI edit a specific
  // deck's own profile_snapshot without touching the shared profile.
  load?: () => Promise<CompanyProfile>;
  save?: (profile: CompanyProfile) => Promise<void>;
  heading?: string;
  description?: string;
}

export default function CompanyProfileForm({ load, save, heading, description }: CompanyProfileFormProps = {}) {
  const [profile, setProfile] = useState<CompanyProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [importing, setImporting] = useState(false);

  const doLoad = load ?? getCompanyProfile;
  const doSave = save ?? saveCompanyProfile;

  useEffect(() => {
    doLoad()
      .then((p) => setProfile({ ...EMPTY_PROFILE, ...p }))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your profile."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(key: TextField, value: string) {
    setProfile((p) => ({ ...p, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await doSave(profile);
      setSavedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your profile.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoUpload(file: File) {
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Logo is too large. Please use an image under 2MB.");
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    setProfile((p) => ({ ...p, logo_data_url: dataUrl }));

    // Suggest a brand color from the logo, but only if the founder hasn't
    // already chosen one, so this never overwrites a deliberate pick.
    setProfile((p) => {
      if (p.brand_primary_color) return p;
      extractDominantColor(dataUrl).then((color) => {
        if (color) setProfile((p2) => (p2.brand_primary_color ? p2 : { ...p2, brand_primary_color: color }));
      });
      return p;
    });
  }

  async function handleCompanyImageUpload(file: File) {
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image is too large. Please use an image under 2MB.");
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    setProfile((p) => ({
      ...p,
      company_image_data_urls: [...p.company_image_data_urls, { data_url: dataUrl, tag: "other" }],
    }));
  }

  function updateImageTag(index: number, tag: TaggedImage["tag"]) {
    setProfile((p) => ({
      ...p,
      company_image_data_urls: p.company_image_data_urls.map((img, i) =>
        i === index ? { ...img, tag } : img
      ),
    }));
  }

  function removeCompanyImage(index: number) {
    setProfile((p) => ({
      ...p,
      company_image_data_urls: p.company_image_data_urls.filter((_, i) => i !== index),
    }));
  }

  function addTeamMember() {
    setProfile((p) => ({ ...p, team_members: [...p.team_members, { ...EMPTY_TEAM_MEMBER }] }));
  }

  function updateTeamMember(index: number, field: keyof TeamMember, value: string) {
    setProfile((p) => ({
      ...p,
      team_members: p.team_members.map((tm, i) => (i === index ? { ...tm, [field]: value } : tm)),
    }));
  }

  async function handleTeamPhotoUpload(index: number, file: File) {
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Photo is too large. Please use an image under 2MB.");
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    updateTeamMember(index, "photo_data_url", dataUrl);
  }

  function removeTeamMember(index: number) {
    setProfile((p) => ({ ...p, team_members: p.team_members.filter((_, i) => i !== index) }));
  }

  if (loading) return <p className="profile-loading">Loading your company profile...</p>;

  return (
    <div className="profile-form">
      {importing && (
        <DeckImport
          onClose={() => setImporting(false)}
          onApply={(fields) => {
            // Merge rather than replace: an import fills gaps, it does not
            // wipe work the founder already did.
            setProfile((p) => ({ ...p, ...fields }));
            setImporting(false);
          }}
        />
      )}

      <div className="profile-header">
        <div>
          <h2>{heading ?? "Company profile"}</h2>
          <p className="profile-sub">
            {description ??
              "This is the manually entered evidence layer. It's combined with what's extracted from your connected repositories to build your deck. Uploaded images are placed directly into the deck; they are never described or reinterpreted by the AI."}
          </p>
        </div>
        <div className="profile-save-area">
          <button className="p-btn p-btn-secondary" onClick={() => setImporting(true)}>
            Import existing deck
          </button>
          {savedAt && <span className="profile-saved-note">Saved {savedAt.toLocaleTimeString()}</span>}
          <button className="p-btn p-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save profile"}
          </button>
        </div>
      </div>

      {error && <p className="p-error">{error}</p>}

      {/* Brand assets */}
      <div className="profile-section">
        <h3>Brand and media</h3>
        <p className="profile-section-desc">
          Your logo, product or company images, and a demo video link. These are
          placed into the deck as-is; the AI never generates or alters them.
        </p>

        <div className="brand-row">
          <div className="logo-upload">
            <span className="profile-field-label">Company logo</span>
            {profile.logo_data_url ? (
              <div className="logo-preview">
                <img src={profile.logo_data_url} alt="Company logo" />
                <button className="p-btn p-btn-ghost" onClick={() => setProfile((p) => ({ ...p, logo_data_url: "" }))}>
                  Remove
                </button>
              </div>
            ) : (
              <label className="upload-dropzone">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => e.target.files?.[0] && handleLogoUpload(e.target.files[0])}
                  hidden
                />
                Click to upload logo
              </label>
            )}
          </div>

          <label className="profile-field">
            <span>Demo video link</span>
            <input
              className="p-input"
              type="text"
              placeholder="https://youtube.com/... or https://loom.com/..."
              value={profile.demo_video_url}
              onChange={(e) => update("demo_video_url", e.target.value)}
            />
          </label>
        </div>

        <div className="company-images">
          <span className="profile-field-label">Company or product images</span>
          <p className="profile-tag-hint">
            Tag each image so it lands on the right slide in your deck.
          </p>
          <div className="company-images-grid">
            {profile.company_image_data_urls.map((img, i) => (
              <div className="company-image-thumb" key={i}>
                <img src={img.data_url} alt={`Company ${i + 1}`} />
                <button className="thumb-remove" onClick={() => removeCompanyImage(i)}>
                  x
                </button>
                <select
                  className="thumb-tag-select"
                  value={img.tag}
                  onChange={(e) => updateImageTag(i, e.target.value as TaggedImage["tag"])}
                >
                  <option value="product">Product</option>
                  <option value="market">Market slide</option>
                  <option value="traction">Traction slide</option>
                  <option value="cover">Cover</option>
                  <option value="other">Other</option>
                </select>
              </div>
            ))}
            <label className="upload-dropzone upload-dropzone-small">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && handleCompanyImageUpload(e.target.files[0])}
                hidden
              />
              + Add image
            </label>
          </div>
        </div>

        <div className="brand-colors-row">
          <label className="profile-field">
            <span>Primary brand color</span>
            <div className="color-input-row">
              <input
                type="color"
                value={profile.brand_primary_color || "#f2b705"}
                onChange={(e) => update("brand_primary_color", e.target.value)}
              />
              <input
                className="p-input"
                type="text"
                placeholder="#f2b705 (leave blank to use Provisio's default)"
                value={profile.brand_primary_color}
                onChange={(e) => update("brand_primary_color", e.target.value)}
              />
            </div>
          </label>
          <label className="profile-field">
            <span>Secondary brand color</span>
            <div className="color-input-row">
              <input
                type="color"
                value={profile.brand_secondary_color || "#0a0a0a"}
                onChange={(e) => update("brand_secondary_color", e.target.value)}
              />
              <input
                className="p-input"
                type="text"
                placeholder="#0a0a0a (optional)"
                value={profile.brand_secondary_color}
                onChange={(e) => update("brand_secondary_color", e.target.value)}
              />
            </div>
          </label>
        </div>

        <label className="profile-field brand-font-field">
          <span>Deck font style</span>
          <select
            className="p-input"
            value={profile.brand_font_style}
            onChange={(e) => update("brand_font_style", e.target.value)}
          >
            <option value="serif">Serif (default): editorial, warm</option>
            <option value="sans">Sans: modern, minimal</option>
            <option value="classic">Classic: formal, institutional</option>
          </select>
        </label>
      </div>

      {SECTIONS.map((section) => (
        <div className="profile-section" key={section.title}>
          <h3>{section.title}</h3>
          <p className="profile-section-desc">{section.description}</p>
          <div className="profile-fields">
            {section.fields.map((field) => (
              <label className="profile-field" key={field.key}>
                <span>{field.label}</span>
                {field.multiline ? (
                  <textarea
                    className="p-input"
                    rows={3}
                    placeholder={field.placeholder}
                    value={profile[field.key] as string}
                    onChange={(e) => update(field.key, e.target.value)}
                  />
                ) : (
                  <input
                    className="p-input"
                    type={field.isUrl ? "url" : "text"}
                    placeholder={field.placeholder}
                    value={profile[field.key] as string}
                    onChange={(e) => update(field.key, e.target.value)}
                  />
                )}
              </label>
            ))}
          </div>
        </div>
      ))}

      {/* Team members, repeatable */}
      <div className="profile-section">
        <h3>Founding team</h3>
        <p className="profile-section-desc">
          Add each team member you want featured. Include a photo, name, role, and
          short bio for each.
        </p>

        {profile.team_members.map((member, i) => (
          <div className="team-member-card" key={i}>
            <div className="team-member-photo">
              {member.photo_data_url ? (
                <img src={member.photo_data_url} alt={member.name || "Team member"} />
              ) : (
                <label className="upload-dropzone upload-dropzone-round">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && handleTeamPhotoUpload(i, e.target.files[0])}
                    hidden
                  />
                  Photo
                </label>
              )}
            </div>
            <div className="team-member-fields">
              <div className="team-member-row">
                <input
                  className="p-input"
                  type="text"
                  placeholder="Full name"
                  value={member.name}
                  onChange={(e) => updateTeamMember(i, "name", e.target.value)}
                />
                <input
                  className="p-input"
                  type="text"
                  placeholder="Role, e.g. CEO & Co-founder"
                  value={member.role}
                  onChange={(e) => updateTeamMember(i, "role", e.target.value)}
                />
              </div>
              <textarea
                className="p-input"
                rows={2}
                placeholder="Short bio, relevant background and achievements"
                value={member.bio}
                onChange={(e) => updateTeamMember(i, "bio", e.target.value)}
              />
              <input
                className="p-input"
                type="url"
                placeholder="LinkedIn URL (optional)"
                value={member.linkedin_url}
                onChange={(e) => updateTeamMember(i, "linkedin_url", e.target.value)}
              />
            </div>
            <button className="p-btn p-btn-ghost team-remove" onClick={() => removeTeamMember(i)}>
              Remove
            </button>
          </div>
        ))}

        <button className="p-btn p-btn-secondary" onClick={addTeamMember}>
          + Add team member
        </button>
      </div>

      {/* Target program, expanded */}
      <div className="profile-section">
        <h3>Target program</h3>
        <p className="profile-section-desc">
          The accelerator, fund, or competition you're applying to. The more
          specific this is, the more the deck can reflect what this program
          actually asks for.
        </p>
        <div className="profile-fields">
          <label className="profile-field">
            <span>Program name</span>
            <input
              className="p-input"
              type="text"
              placeholder="e.g. Y Combinator, Techstars, a specific fund's name"
              value={profile.program_name}
              onChange={(e) => update("program_name", e.target.value)}
            />
          </label>
          <label className="profile-field">
            <span>Program type</span>
            <input
              className="p-input"
              type="text"
              placeholder="Accelerator, VC fund, competition, or grant"
              value={profile.program_type}
              onChange={(e) => update("program_type", e.target.value)}
            />
          </label>
          <label className="profile-field">
            <span>Program link</span>
            <input
              className="p-input"
              type="url"
              placeholder="https://... link to the program's page or application"
              value={profile.program_url}
              onChange={(e) => update("program_url", e.target.value)}
            />
          </label>
          <label className="profile-field">
            <span>Application deadline</span>
            <input
              className="p-input"
              type="text"
              placeholder="e.g. March 15, 2026"
              value={profile.program_deadline}
              onChange={(e) => update("program_deadline", e.target.value)}
            />
          </label>
          <label className="profile-field">
            <span>What this program asks for</span>
            <textarea
              className="p-input"
              rows={4}
              placeholder="Paste the program's stated criteria, focus areas, or application requirements, so the deck can address them directly"
              value={profile.program_requirements}
              onChange={(e) => update("program_requirements", e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="profile-footer-save">
        <button className="p-btn p-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save profile"}
        </button>
      </div>
    </div>
  );
}
