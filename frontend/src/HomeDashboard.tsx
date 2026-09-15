import { useEffect, useState } from "react";
import { getCompanyProfile, listRepos, listDecks, type CompanyProfile } from "./api";
import "./home-dashboard.css";

interface HomeDashboardProps {
  userName: string;
  onNavigate: (tab: "evidence" | "profile" | "deck" | "security") => void;
}

// Fields that count toward "profile completeness". Deliberately a subset,
// not every field in the schema, since some (valuation_expectation,
// previous_funding) are genuinely optional for most founders and shouldn't
// drag the percentage down for everyone.
const COMPLETENESS_FIELDS: (keyof CompanyProfile)[] = [
  "company_name",
  "one_liner",
  "problem",
  "solution",
  "market_opportunity",
  "traction",
  "business_model",
  "funding_ask",
];

export default function HomeDashboard({ userName, onNavigate }: HomeDashboardProps) {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [repoCount, setRepoCount] = useState<number | null>(null);
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null);
  const [deckCount, setDeckCount] = useState<number | null>(null);
  const [mostRecentDeckUpdate, setMostRecentDeckUpdate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([getCompanyProfile(), listRepos(), listDecks()]).then(([profileR, reposR, decksR]) => {
      if (cancelled) return;

      if (profileR.status === "fulfilled") setProfile(profileR.value);

      if (reposR.status === "fulfilled") {
        setGithubConnected(true);
        setRepoCount(reposR.value.length);
      } else {
        setGithubConnected(false);
      }

      if (decksR.status === "fulfilled") {
        setDeckCount(decksR.value.length);
        const mostRecent = decksR.value[0]; // already sorted by updated_at desc from the backend
        setMostRecentDeckUpdate(mostRecent?.updated_at ?? null);
      }

      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const completeness = profile
    ? Math.round(
        (COMPLETENESS_FIELDS.filter((f) => String(profile[f] ?? "").trim().length > 0).length /
          COMPLETENESS_FIELDS.length) *
          100
      )
    : 0;

  const firstName = userName.split(" ")[0];
  const greeting = firstName ? `Welcome back, ${firstName}` : "Welcome back";

  return (
    <div className="home-dash">
      <h1 className="dash-title">{greeting}</h1>
      <p className="dash-subtitle">Here's where things actually stand right now.</p>

      {loading ? (
        <p className="home-loading">Loading your status...</p>
      ) : (
        <div className="home-status-grid">
          <button className="home-status-card" onClick={() => onNavigate("profile")}>
            <div className="home-status-ring">
              <svg viewBox="0 0 36 36" className="home-ring-svg">
                <path
                  className="home-ring-bg"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="home-ring-fill"
                  strokeDasharray={`${completeness}, 100`}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <span className="home-ring-label">{completeness}%</span>
            </div>
            <div>
              <h3>Company profile</h3>
              <p>
                {completeness === 100
                  ? "Core sections complete."
                  : `${COMPLETENESS_FIELDS.length - Math.round((completeness / 100) * COMPLETENESS_FIELDS.length)} core section(s) still empty.`}
              </p>
            </div>
          </button>

          <button className="home-status-card" onClick={() => onNavigate("evidence")}>
            <div className={`home-status-dot ${githubConnected ? "home-status-dot-ok" : "home-status-dot-off"}`} />
            <div>
              <h3>GitHub evidence</h3>
              <p>
                {githubConnected === null
                  ? "Checking..."
                  : githubConnected
                    ? `Connected. ${repoCount ?? 0} repo${repoCount === 1 ? "" : "s"} available.`
                    : "Not connected yet."}
              </p>
            </div>
          </button>

          <button className="home-status-card" onClick={() => onNavigate("deck")}>
            <div className={`home-status-dot ${deckCount ? "home-status-dot-ok" : "home-status-dot-off"}`} />
            <div>
              <h3>Your decks</h3>
              <p>
                {deckCount
                  ? `${deckCount} deck${deckCount === 1 ? "" : "s"}. Last updated ${mostRecentDeckUpdate ? new Date(mostRecentDeckUpdate).toLocaleDateString() : "recently"}.`
                  : "No decks yet."}
              </p>
            </div>
          </button>

          <button className="home-status-card" onClick={() => onNavigate("security")}>
            <div className="home-status-dot home-status-dot-neutral" />
            <div>
              <h3>Security</h3>
              <p>Set up two-factor authentication for your account.</p>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
