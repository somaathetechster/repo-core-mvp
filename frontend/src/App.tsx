import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { Routes, Route, Navigate, NavLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { type AnalyzeResult } from "./api";
import Login from "./Login";
import MfaChallenge from "./MfaChallenge";
import Landing from "./marketing/Landing";
import MfaSettings from "./MfaSettings";
import HomeDashboard from "./HomeDashboard";
import NotificationBanner, { registerPlanUpgrade } from "./NotificationBanner";
import SupportWidget from "./SupportWidget";
import BillingPlans from "./BillingPlans";
import ChangePassword from "./ChangePassword";
import WelcomeCelebration from "./WelcomeCelebration";
import SettingsPage from "./SettingsPage";
import InvitePage from "./InvitePage";
import { WorkspaceProvider, WorkspaceScope } from "./WorkspaceContext";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import "./theme.css";
import "./dashboard.css";

// These pull in the heaviest dependencies in the app (recharts, react-rnd,
// @dnd-kit, html2canvas), so they're loaded on demand instead of bundled into
// the initial page load. Someone who only ever uses Evidence and Home
// shouldn't have to download charting/drag-and-drop code they never touch.
const CompanyProfileForm = lazy(() => import("./CompanyProfileForm"));
const DecksHome = lazy(() => import("./DecksHome"));
const DeckEditor = lazy(() => import("./DeckEditor"));
const DocumentsPage = lazy(() => import("./DocumentsPage"));
const DocumentEditor = lazy(() => import("./DocumentEditor"));
const DataStudio = lazy(() => import("./DataStudio"));
const Evidence = lazy(() => import("./Evidence"));
const DeckReview = lazy(() => import("./DeckReview"));

const API_BASE = import.meta.env.VITE_API_BASE as string;

function TabLoading() {
  return <p style={{ padding: "2rem", color: "var(--text-dim)" }}>Loading...</p>;
}

type LoggedOutView = "landing" | "login";
type AalStatus = "checking" | "ok" | "needs-mfa";

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

  // Logged out: the landing/login pages live at "/", and every other path
  // redirects there. The login/landing toggle stays as local state so those
  // pages are unchanged.
  if (session === null) {
    const loggedOut = loggedOutView === "login" ? (
      <Login onGoHome={() => setLoggedOutView("landing")} />
    ) : (
      <Landing onTryNow={() => setLoggedOutView("login")} />
    );
    return (
      <Routes>
        {/* The accept-invite page is reachable whether or not you're logged
            in — the person following the link may have no account yet. */}
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/" element={loggedOut} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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

  // The mailing-list choice was made before the account had a token, so it
  // is synced here the first time a session exists. Guarded so it runs once
  // per browser session rather than on every render.
  if (session && !sessionStorage.getItem("provisio:optin-synced")) {
    sessionStorage.setItem("provisio:optin-synced", "1");
    const optIn = Boolean((session.user.user_metadata as Record<string, unknown>)?.marketing_opt_in);
    fetch(`${API_BASE}/me/marketing-optin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ opt_in: optIn, email: session.user.email ?? "" }),
    }).catch(() => { /* not worth blocking sign-in over */ });
  }

  return (
    <Dashboard
      userEmail={session.user.email ?? ""}
      userName={(session.user.user_metadata?.full_name as string | undefined) ?? ""}
      accessToken={session.access_token}
    />
  );
}

const DASH_TABS = [
  { to: "/home", label: "Home" },
  { to: "/evidence", label: "Evidence" },
  { to: "/profile", label: "Company profile" },
  { to: "/deck", label: "Deck" },
  { to: "/documents", label: "Documents" },
  { to: "/review", label: "Review" },
  { to: "/data", label: "Data" },
  { to: "/security", label: "Security" },
  { to: "/settings", label: "Settings" },
  // Billing is reached through Settings → Billing now, so it's no longer a
  // top-level nav item — but the /billing route stays registered below so
  // existing links (emails, checkout redirects) keep working.
] as const;

function Dashboard({ userEmail, userName, accessToken }: { userEmail: string; userName: string; accessToken: string }) {
  const navigate = useNavigate();
  const [analyzedRepos, setAnalyzedRepos] = useState<AnalyzeResult[]>([]);
  const [profileFocusField, setProfileFocusField] = useState<string | null>(null);
  // Plan name to show in the celebration overlay; null means no overlay.
  const [celebration, setCelebration] = useState<string | null>(null);

  // The query string as it was on first render. We capture it synchronously
  // because the "/" → "/home" redirect runs in a child effect *before* our
  // mount effect below, and that redirect strips the query — so reading
  // window.location.search from the effect would come back empty.
  const initialSearch = useRef(typeof window !== "undefined" ? window.location.search : "");

  // Handle the query-string hand-offs from external flows exactly once, on
  // mount. Each clears its own param by navigating to a clean path so a
  // refresh doesn't re-trigger it, and the browser history stays tidy.
  //
  //  ?status=success   — returning from the GitHub install → open Evidence.
  //  ?checkout=success — returning from a successful checkout → open Billing,
  //                       celebrate, and raise the persistent upgrade banner.
  useEffect(() => {
    const params = new URLSearchParams(initialSearch.current);
    if (params.get("status") === "success") {
      navigate("/evidence", { replace: true });
      return;
    }
    if (params.get("checkout") === "success") {
      // Land on Billing with the param stripped.
      navigate("/billing", { replace: true });
      // Confirm the plan name from the server and use the real name in both
      // the overlay and the banner. Fulfilment is via webhook, so the plan
      // may lag a moment — fall back to a generic name if it hasn't landed.
      fetch(`${API_BASE}/billing/me`, { headers: { Authorization: `Bearer ${accessToken}` } })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          const name = data?.entitlement?.plan?.name;
          const planName = name && name !== "Free" ? name : "Provisio";
          setCelebration(planName);
          registerPlanUpgrade(planName);
        })
        .catch(() => {
          setCelebration("Provisio");
          registerPlanUpgrade("Provisio");
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Navigate to a specific deck in the editor. slideIndex, when given, is
  // carried as a query param the editor reads on open.
  const openDeck = (id: string, slideIndex?: number) => {
    navigate(`/deck/${id}${slideIndex != null ? `?slide=${slideIndex}` : ""}`);
  };

  const navigateTo = (tab: string, focusField?: string) => {
    if (focusField) setProfileFocusField(focusField);
    navigate(`/${tab}`);
  };

  return (
    <WorkspaceProvider>
    <div className="provisio dashboard">
      {/* Persistent notifications (incl. the plan-upgrade banner) sit above
          the topbar, per spec. */}
      <NotificationBanner accessToken={accessToken} />

      <div className="dash-topbar">
        <div className="dash-brand-group">
          <button className="brand-mark brand-mark-link" onClick={() => navigate("/home")}>
            Provisio
          </button>
          <WorkspaceSwitcher />
        </div>
        <nav className="dash-tabs">
          {DASH_TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) => `dash-tab ${isActive ? "dash-tab-active" : ""}`}
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="dash-user">
          <a className="dash-domani" href="https://www.domanimedia.com" target="_blank" rel="noopener noreferrer">
            Powered by Domani
          </a>
          <span className="dash-email">{userName || userEmail}</span>
          <button className="p-btn p-btn-ghost" onClick={() => supabase.auth.signOut()}>
            Log out
          </button>
        </div>
      </div>

      <SupportWidget accessToken={accessToken} />

      {celebration && (
        <WelcomeCelebration planName={celebration} onDismiss={() => setCelebration(null)} />
      )}

      <WorkspaceScope>
      <Suspense fallback={<TabLoading />}>
        <Routes>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route
            path="/home"
            element={
              <div className="dash-body">
                <HomeDashboard userName={userName} onNavigate={navigateTo} onOpenDeck={openDeck} />
              </div>
            }
          />
          <Route
            path="/evidence"
            element={
              <Evidence
                onAnalyzed={(res) => {
                  // Keep analysed repos available to the deck builder, which
                  // uses them as the evidence source when generating slides.
                  setAnalyzedRepos((prev) => [
                    ...prev.filter((r) => r.summary.full_name !== res.summary.full_name),
                    res as unknown as AnalyzeResult,
                  ]);
                }}
              />
            }
          />
          <Route
            path="/profile"
            element={
              <CompanyProfileForm
                focusField={profileFocusField}
                onFocusHandled={() => setProfileFocusField(null)}
              />
            }
          />
          <Route path="/deck" element={<DecksHome analyzedRepos={analyzedRepos} />} />
          <Route path="/deck/:id" element={<DeckEditorRoute analyzedRepos={analyzedRepos} />} />
          <Route path="/documents" element={<div className="dash-body"><DocumentsPage /></div>} />
          <Route path="/documents/:id" element={<DocumentEditorRoute />} />
          <Route path="/review" element={<DeckReview onOpenDeck={openDeck} onNavigate={navigateTo} />} />
          <Route path="/data" element={<DataStudio />} />
          <Route
            path="/security"
            element={
              <div className="dash-body">
                <ChangePassword email={userEmail} />
                <MfaSettings />
              </div>
            }
          />
          <Route
            path="/settings"
            element={<SettingsPage userName={userName} userEmail={userEmail} />}
          />
          <Route
            path="/billing"
            element={
              <div className="dash-body">
                <BillingPlans accessToken={accessToken} />
              </div>
            }
          />
          {/* Reachable while logged in too, e.g. following an invite link in
              an already-authenticated browser. */}
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </Suspense>
      </WorkspaceScope>
    </div>
    </WorkspaceProvider>
  );
}

// Reads the deck id from the path (and an optional ?slide= hint) and renders
// the editor. Back returns to the deck list.
function DeckEditorRoute({ analyzedRepos }: { analyzedRepos: AnalyzeResult[] }) {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  if (!id) return <Navigate to="/deck" replace />;
  const slideParam = searchParams.get("slide");
  const initialSlide = slideParam != null && Number.isFinite(Number(slideParam)) ? Number(slideParam) : undefined;
  return (
    <DeckEditor
      key={id}
      deckId={id}
      initialSlide={initialSlide}
      analyzedRepos={analyzedRepos}
      onBack={() => navigate("/deck")}
    />
  );
}

// Reads the document id from the path and renders the document editor. Back
// returns to the documents list.
function DocumentEditorRoute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  if (!id) return <Navigate to="/documents" replace />;
  return <DocumentEditor key={id} docId={id} onBack={() => navigate("/documents")} />;
}
