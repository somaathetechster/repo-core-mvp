import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCompanyProfile, listDecks, listDocuments, type CompanyProfile, type DeckSummary } from "./api";
import "./home-dashboard.css";

interface HomeDashboardProps {
  userName: string;
}

function greet(): string {
  const h = new Date().getHours();
  return `Good ${h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"}`;
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

/* Stroke icons matching the sidebar set. */
const iconProps = {
  width: 26, height: 26, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};
const DecksIcon = () => <svg {...iconProps}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></svg>;
const DocsIcon = () => <svg {...iconProps}><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v4h4" /><path d="M9 13h6M9 17h6" /></svg>;
const BrandIcon = () => <svg {...iconProps}><path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-.5-.3-.9-.6-1.2-.3-.4-.6-.7-.6-1.3 0-.8.7-1.5 1.5-1.5H15a5 5 0 0 0 5-5c0-4-3.6-6.5-8-6.5Z" /><circle cx="7.5" cy="10.5" r="1" /><circle cx="12" cy="7.5" r="1" /><circle cx="16.5" cy="10.5" r="1" /></svg>;
const SignIcon = () => <svg {...iconProps}><path d="M15 4 20 9 8 21H3v-5L15 4Z" /><path d="m13.5 5.5 5 5" /></svg>;

export default function HomeDashboard({ userName }: HomeDashboardProps) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [docCount, setDocCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([getCompanyProfile(), listDecks(), listDocuments()]).then(([pR, dR, docR]) => {
      if (cancelled) return;
      if (pR.status === "fulfilled") setProfile(pR.value);
      if (dR.status === "fulfilled") setDecks(dR.value);
      if (docR.status === "fulfilled") setDocCount(docR.value.length);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const firstName = userName.split(" ")[0] || "there";
  const companyName = profile?.company_name?.trim();
  const logo = profile?.logo_data_url?.trim();
  const deckCount = decks?.length ?? 0;
  const recent = decks?.slice(0, 3) ?? [];

  const products = [
    {
      key: "decks",
      Icon: DecksIcon,
      name: "Provisio Decks",
      desc: "AI-generated pitch decks",
      count: decks === null ? null : `${deckCount} deck${deckCount === 1 ? "" : "s"}`,
      cta: "Open Decks",
      onClick: () => navigate("/decks"),
      soon: false,
    },
    {
      key: "docs",
      Icon: DocsIcon,
      name: "Provisio Docs",
      desc: "Professional business documents",
      count: docCount === null ? null : `${docCount} document${docCount === 1 ? "" : "s"}`,
      cta: "Open Docs",
      onClick: () => navigate("/documents"),
      soon: false,
    },
    {
      key: "brand",
      Icon: BrandIcon,
      name: "Provisio Brand",
      desc: "Brand kit and letterhead",
      count: null,
      cta: "Open Brand",
      onClick: () => navigate("/brand"),
      soon: true,
    },
    {
      key: "sign",
      Icon: SignIcon,
      name: "Provisio Sign",
      desc: "E-signatures and document signing",
      count: null,
      cta: "Open Sign",
      onClick: () => navigate("/sign"),
      soon: true,
    },
  ];

  if (loading) {
    return (
      <div className="home2">
        <div className="home2-loading"><div className="home2-spinner" /><p>Loading your workspace…</p></div>
      </div>
    );
  }

  return (
    <div className="home2">
      {/* Greeting */}
      <header className="home2-head">
        <div>
          <div className="home2-greeting">{greet()}, {firstName}.</div>
          <div className="home2-subline">Here's your Provisio workspace.</div>
        </div>
        {companyName && (
          <div className="home2-company">
            {logo
              ? <img className="home2-logo" src={logo} alt={`${companyName} logo`} />
              : <div className="home2-logo home2-logo-fallback">{companyName.charAt(0).toUpperCase()}</div>}
            <span className="home2-company-name">{companyName}</span>
          </div>
        )}
      </header>

      {/* Product cards */}
      <section className="home2-products">
        {products.map((p) => (
          <button
            key={p.key}
            className={`home2-card ${p.soon ? "home2-card-soon" : ""}`}
            onClick={p.soon ? undefined : p.onClick}
            disabled={p.soon}
          >
            {p.soon && <span className="home2-card-badge">Coming soon</span>}
            <div className="home2-card-icon"><p.Icon /></div>
            <div className="home2-card-name">{p.name}</div>
            <div className="home2-card-desc">{p.desc}</div>
            <div className="home2-card-foot">
              {p.count && <span className="home2-card-count">{p.count}</span>}
              {!p.soon && <span className="home2-card-cta">{p.cta} →</span>}
            </div>
          </button>
        ))}
      </section>

      {/* Recent activity + quick actions */}
      <section className="home2-activity">
        <div className="home2-recent">
          <div className="home2-section-label">Recent Decks</div>
          {recent.length > 0 ? (
            <div className="home2-recent-list">
              {recent.map((d) => (
                <button key={d.id} className="home2-recent-row" onClick={() => navigate(`/deck/${d.id}`)}>
                  <div className="home2-recent-info">
                    <div className="home2-recent-name">{d.name}</div>
                    <div className="home2-recent-meta">{d.slide_count} slides · updated {relTime(d.updated_at)}</div>
                  </div>
                  <span className="home2-recent-open">Open →</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="home2-recent-empty">
              <p>No decks yet.</p>
              <button className="home2-qa-btn primary" onClick={() => navigate("/decks")}>Create your first deck →</button>
            </div>
          )}
        </div>

        <div className="home2-quick">
          <div className="home2-section-label">Quick actions</div>
          <div className="home2-quick-actions">
            <button className="home2-qa-btn primary" onClick={() => navigate("/decks")}>New Deck</button>
            <button className="home2-qa-btn" onClick={() => navigate("/profile")}>Edit Company Profile</button>
            <button className="home2-qa-btn" onClick={() => navigate("/evidence")}>Analyse a repo</button>
            <button className="home2-qa-btn" onClick={() => navigate("/data")}>Add data</button>
          </div>
        </div>
      </section>
    </div>
  );
}
