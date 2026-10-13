import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "./supabaseClient";
import { acceptInvite, getAcceptInfo, setActiveWorkspaceOwnerId, type AcceptInfo } from "./api";
import { ACTIVE_WORKSPACE_STORAGE_KEY } from "./WorkspaceContext";
import { PasswordRules, passwordError, MIN_PASSWORD_LENGTH } from "./passwordPolicy";
import "./theme.css";
import "./auth.css";

type Mode = "loading" | "error" | "already" | "signup" | "login" | "verify" | "accept";

/**
 * Accept-invitation landing page, reachable at /invite/:token whether or not
 * the visitor is logged in.
 *
 * The server tells us (via GET accept/:token) whether an account already
 * exists for the invited email. From there:
 *   - already accepted  → say so
 *   - logged in         → one-click accept
 *   - no account        → create one (name + password), verify email, accept
 *   - has account       → log in inline, then accept
 */
export default function InvitePage() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>("loading");
  const [info, setInfo] = useState<AcceptInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [data, sessionRes] = await Promise.all([
          getAcceptInfo(token),
          supabase.auth.getSession(),
        ]);
        if (cancelled) return;
        setInfo(data);
        const loggedIn = Boolean(sessionRes.data.session);
        if (data.already_accepted) setMode("already");
        else if (loggedIn) setMode("accept");
        else if (data.requires_signup) setMode("signup");
        else setMode("login");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "This invitation link is not valid.");
        setMode("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Finalise: record the workspace as active, then land in the app.
  async function finishAccept() {
    setBusy(true);
    setError(null);
    try {
      const res = await acceptInvite(token);
      try {
        localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, res.owner_id);
      } catch {
        /* storage unavailable — the switcher still works, just not pre-selected */
      }
      setActiveWorkspaceOwnerId(res.owner_id);
      navigate("/home", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't accept this invitation.");
      setBusy(false);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!info) return;
    const weak = passwordError(password);
    if (weak) {
      setError(weak);
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signUp({
      email: info.email,
      password,
      options: { data: { full_name: fullName } },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setCode("");
    setNotice(`We sent a code to ${info.email}. Enter it to activate your account.`);
    setMode("verify");
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!info) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({
      email: info.email,
      token: code.trim(),
      type: "signup",
    });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    // Session now exists — accept straight away.
    await finishAccept();
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!info) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: info.email, password });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    await finishAccept();
  }

  const owner = info?.owner_name ?? "the";
  const ownerPossessive = owner.endsWith("s") ? `${owner}'` : `${owner}'s`;

  return (
    <div className="provisio auth-screen">
      <div className="auth-card">
        <span className="brand-mark auth-brand">Provisio</span>

        {mode === "loading" && <p className="auth-sub">Checking your invitation…</p>}

        {mode === "error" && (
          <>
            <h2>Invitation not available</h2>
            <p className="p-error">{error}</p>
            <button className="p-btn p-btn-ghost auth-switch" onClick={() => navigate("/")}>
              Go to Provisio
            </button>
          </>
        )}

        {mode === "already" && (
          <>
            <h2>You're already a member</h2>
            <p className="auth-sub">
              You've already accepted the invitation to {ownerPossessive} workspace.
            </p>
            <button className="p-btn p-btn-primary" onClick={() => navigate("/home")}>
              Go to workspace
            </button>
          </>
        )}

        {mode === "accept" && (
          <>
            <h2>Accept invitation</h2>
            <p className="auth-sub">
              You've been invited to join {ownerPossessive} workspace as a{" "}
              <strong>{info?.role}</strong>.
            </p>
            {error && <p className="p-error">{error}</p>}
            <button className="p-btn p-btn-primary" onClick={finishAccept} disabled={busy}>
              {busy ? "Accepting…" : `Accept invitation to ${ownerPossessive} workspace`}
            </button>
          </>
        )}

        {mode === "signup" && (
          <>
            <h2>Create your account</h2>
            <p className="auth-sub">
              You've been invited to join {ownerPossessive} workspace. Set up your account for{" "}
              <strong>{info?.email}</strong> to accept.
            </p>
            <form onSubmit={handleSignup} className="auth-form">
              <input
                className="p-input"
                type="text"
                placeholder="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
              <input className="p-input" type="email" value={info?.email ?? ""} disabled />
              <input
                className="p-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
              />
              <PasswordRules value={password} />
              {error && <p className="p-error">{error}</p>}
              <button className="p-btn p-btn-primary" type="submit" disabled={busy}>
                {busy ? "Working…" : "Create account"}
              </button>
            </form>
          </>
        )}

        {mode === "login" && (
          <>
            <h2>Log in to accept</h2>
            <p className="auth-sub">
              You've been invited to join {ownerPossessive} workspace. Log in as{" "}
              <strong>{info?.email}</strong> to accept.
            </p>
            <form onSubmit={handleLogin} className="auth-form">
              <input className="p-input" type="email" value={info?.email ?? ""} disabled />
              <input
                className="p-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {error && <p className="p-error">{error}</p>}
              <button className="p-btn p-btn-primary" type="submit" disabled={busy}>
                {busy ? "Working…" : "Log in and accept"}
              </button>
            </form>
          </>
        )}

        {mode === "verify" && (
          <>
            <h2>Confirm your email</h2>
            <p className="auth-sub">{notice}</p>
            <form onSubmit={handleVerify} className="auth-form">
              <input
                className="p-input auth-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Code from your email"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
                required
                autoFocus
              />
              {error && <p className="p-error">{error}</p>}
              <button className="p-btn p-btn-primary" type="submit" disabled={busy}>
                {busy ? "Working…" : "Confirm and accept"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
