/**
 * Change password, for someone already signed in.
 *
 * Supabase will change a password from any valid session without asking for
 * the old one. That is a real risk on a shared or unattended machine, so the
 * current password is verified first by signing in with it. The re-sign-in
 * uses the same email and returns the same session, so it is invisible when
 * the password is right and a clean error when it isn't.
 */
import { useState } from "react";
import { supabase } from "./supabaseClient";
import { PasswordRules, passwordError, MIN_PASSWORD_LENGTH } from "./passwordPolicy";

export default function ChangePassword({ email }: { email: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);

    const weak = passwordError(next);
    if (weak) { setError(weak); return; }
    if (next !== confirm) { setError("The two new passwords don't match."); return; }
    if (next === current) { setError("That's the password you already have."); return; }

    setBusy(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email, password: current,
      });
      if (authError) { setError("Your current password isn't right."); return; }

      const { error: updateError } = await supabase.auth.updateUser({ password: next });
      if (updateError) { setError(updateError.message); return; }

      setCurrent(""); setNext(""); setConfirm(""); setDone(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mfa-card">
      <div className="mfa-card-head">
        <div>
          <h3>Password</h3>
          <p>Change the password you use to sign in.</p>
        </div>
      </div>

      <form className="pw-form" onSubmit={submit}>
        <label className="pw-field">
          <span>Current password</span>
          <input
            className="p-input" type="password" autoComplete="current-password"
            value={current} onChange={(e) => setCurrent(e.target.value)} required
          />
        </label>
        <label className="pw-field">
          <span>New password</span>
          <input
            className="p-input" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH}
            value={next} onChange={(e) => setNext(e.target.value)} required
          />
          <PasswordRules value={next} />
        </label>
        <label className="pw-field">
          <span>Confirm new password</span>
          <input
            className="p-input" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH}
            value={confirm} onChange={(e) => setConfirm(e.target.value)} required
          />
        </label>

        {error && <p className="p-error">{error}</p>}
        {done && <p className="pw-done">Password changed. Use the new one next time you sign in.</p>}

        <button className="p-btn p-btn-primary" type="submit" disabled={busy}>
          {busy ? "Changing…" : "Change password"}
        </button>
      </form>
    </section>
  );
}
