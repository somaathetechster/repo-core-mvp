import { useEffect, useState, lazy, Suspense } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { startGithubConnect, listRepos, analyzeRepo, type RepoListing, type AnalyzeResult } from "./api";
import Login from "./Login";
import MfaChallenge from "./MfaChallenge";
import Landing from "./marketing/Landing";
const CompanyProfileForm = lazy(() => import("./CompanyProfileForm"));
import MfaSettings from "./MfaSettings";
const DecksHome = lazy(() => import("./DecksHome"));
import HomeDashboard from "./HomeDashboard";
const DataStudio = lazy(() => import("./DataStudio"));
import "./theme.css";
import "./dashboard.css";

type LoggedOutView = "landing" | "login";
type AalStatus = "checking" | "ok" | "needs-mfa";

function TabLoading() {
  return <p style={{ padding: "2rem", color: "var(--text-dim)" }}>Loading...</p>;
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined = still loading
  const [loggedOutView, setLoggedOutView] = useState<LoggedOutView>("landing");
  const [aalStatus, setAalStatus] = useState<AalStatus>("checking");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Whenever we get a NEW session (a different user, or the first sign-in),
  // check whether it's actually at the assurance level it needs to be. A
  // session exists at aal1 the instant a password check succeeds, even for
  // accounts with 2FA enabled, so this check is what actually keeps the
  // dashboard gated, not anything in Login.tsx.
  //
  // We key this off the user's id rather than the session object itself,
  // because Supabase refreshes the session (a new object, same user) on its
  // own roughly hourly, and re-running this check on every refresh would
  // briefly unmount the dashboard and wipe anything unsaved, like an
  // in-progress company profile edit.
  const [checkedUserId, setCheckedUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setAalStatus("checking");
      setCheckedUserId(null);
      return;
    }
    if (session.user.id === checkedUserId) {
      // Same user as last time we checked (this is just a token refresh) —
      // don't re-run the check or touch aalStatus.
      return;
    }
    setAalStatus("checking");
    const userId = session.user.id;
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data, error }) => {
      if (error) {
        // Fail closed: if we can't determine the assurance level, don't show
        // the dashboard.
        setAalStatus("needs-mfa");
        setCheckedUserId(userId);
        return;
      }
      setAalStatus(data.nextLevel === "aal2" && data.currentLevel !== "aal2" ? "needs-mfa" : "ok");
      setCheckedUserId(userId);
    });
  }, [session, checkedUserId]);

  if (session === undefined) {
    return (
      <div className="provisio">
        <p style={{ padding: "2rem", color: "var(--text-dim)" }}>Loading...</p>
      </div>
    );
  }

  if (session === null) {
    return loggedOutView === "login" ? (
      <Login onGoHome={() => setLoggedOutView("landing")} />
    ) : (
      <Landing onTryNow={() => setLoggedOutView("login")} />
    );
  }

  if (aalStatus === "checking") {
    return (
      <div className="provisio">
        <p style={{ padding: "2rem", color: "var(--text-dim)" }}>Checking your session...</p>
      </div>
    );
  }

  if (aalStatus === "needs-mfa") {
    return (
      <MfaChallenge
        onVerified={() => {
          if (session) setCheckedUserId(session.user.id);
          setAalStatus("ok");
        }}
        onGoHome={() => supabase.auth.signOut()}
      />
    );
  }

  return (
    <Dashboard
      userEmail={session.user.email ?? ""}
      userName={(session.user.user_metadata?.full_name as string | undefined) ?? ""}
    />
  );
}

type DashTab = "home" | "evidence" | "profile" | "security" | "deck" | "data";

function Dashboard({ userEmail, userName }: { userEmail: string; userName: string }) {
  const [tab, setTab] = useState<DashTab>("home");
  const [repos, setRepos] = useState<RepoListing[] | null>(null);
  const [selected, setSelected] = useState<AnalyzeResult | null>(null);
  const [analyzedRepos, setAnalyzedRepos] = useState<AnalyzeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("status") === "success") {
      window.history.replaceState({}, "", window.location.pathname);
      handleLoadRepos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function messageOf(e: unknown, fallback: string): string {
    return e instanceof Error && e.message ? e.message : fallback;
  }

  async function handleLoadRepos() {
    setError(null);
    setLoading(true);
    try {
      setRepos(await listRepos());
    } catch (e) {
      setError(messageOf(e, "Couldn't load repos. Did you connect GitHub first?"));
    } finally {
      setLoading(false);
    }
  }

  async function handleAnalyze(fullName: string) {
    setError(null);
    setLoading(true);
    setSelected(null);
    try {
      const [owner, repo] = fullName.split("/");
      const result = await analyzeRepo(owner, repo);
      setSelected(result);
      setAnalyzedRepos((prev) => [...prev.filter((r) => r.summary.full_name !== result.summary.full_name), result]);
    } catch (e) {
      setError(messageOf(e, "Analysis failed. Check the backend logs."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="provisio dashboard">
      <div className="dash-topbar">
        <button className="brand-mark brand-mark-link" onClick={() => setTab("home")}>
          Provisio
        </button>
        <nav className="dash-tabs">
          <button className={`dash-tab ${tab === "home" ? "dash-tab-active" : ""}`} onClick={() => setTab("home")}>
            Home
          </button>
          <button className={`dash-tab ${tab === "evidence" ? "dash-tab-active" : ""}`} onClick={() => setTab("evidence")}>
            Evidence
          </button>
          <button className={`dash-tab ${tab === "profile" ? "dash-tab-active" : ""}`} onClick={() => setTab("profile")}>
            Company profile
          </button>
          <button className={`dash-tab ${tab === "deck" ? "dash-tab-active" : ""}`} onClick={() => setTab("deck")}>
            Deck
          </button>
          <button className={`dash-tab ${tab === "data" ? "dash-tab-active" : ""}`} onClick={() => setTab("data")}>
            Data
          </button>
          <button className={`dash-tab ${tab === "security" ? "dash-tab-active" : ""}`} onClick={() => setTab("security")}>
            Security
          </button>
        </nav>
        <div className="dash-user">
          <span className="dash-email">{userName || userEmail}</span>
          <button className="p-btn p-btn-ghost" onClick={() => supabase.auth.signOut()}>
            Log out
          </button>
        </div>
      </div>

      {tab === "profile" && (
        <Suspense fallback={<TabLoading />}>
          <CompanyProfileForm />
        </Suspense>
      )}

      {tab === "deck" && (
        <Suspense fallback={<TabLoading />}>
          <DecksHome analyzedRepos={analyzedRepos} />
        </Suspense>
      )}

      {tab === "data" && (
        <Suspense fallback={<TabLoading />}>
          <DataStudio />
        </Suspense>
      )}

      {tab === "security" && (
        <div className="dash-body">
          <MfaSettings />
        </div>
      )}

      {tab === "home" && (
        <div className="dash-body">
          <HomeDashboard userName={userName} onNavigate={(t) => setTab(t)} />
        </div>
      )}

      {tab === "evidence" && (
        <div className="dash-body">
          <h1 className="dash-title">Connect your evidence</h1>
          <p className="dash-subtitle">Connect a repo. See what it actually says about your company.</p>

          <div className="dash-actions">
            <button className="p-btn p-btn-primary" onClick={() => startGithubConnect()}>
              Connect GitHub
            </button>
            <button className="p-btn p-btn-secondary" onClick={handleLoadRepos} disabled={loading}>
              Load my repos
            </button>
          </div>

          {error && <p className="p-error dash-error">{error}</p>}
          {loading && <p className="dash-loading">Working...</p>}

          {repos && (
            <ul className="dash-repo-list">
              {repos.map((r) => (
                <li key={r.full_name} className="dash-repo-item">
                  <div>
                    <strong>{r.full_name}</strong>{" "}
                    {r.private && <span className="dash-badge">private</span>}
                    <p>{r.description}</p>
                  </div>
                  <button className="p-btn p-btn-secondary" onClick={() => handleAnalyze(r.full_name)} disabled={loading}>
                    Analyze
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected && (
            <div className="dash-result">
              <h2>Technology slide draft</h2>
              <p className="dash-slide-content">{selected.technology_slide_content}</p>

              <h3>Underlying evidence (what the AI was given, nothing more)</h3>
              <pre className="dash-evidence">{JSON.stringify(selected.summary, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
