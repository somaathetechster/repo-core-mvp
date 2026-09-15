import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import "./theme.css";
import "./auth.css";

interface MfaChallengeProps {
  onVerified: () => void;
  onGoHome: () => void;
}

export default function MfaChallenge({ onVerified, onGoHome }: MfaChallengeProps) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (error) {
        setError(error.message);
      } else {
        const verified = data.totp.find((f) => f.status === "verified");
        if (verified) setFactorId(verified.id);
        else setError("Your account requires a second factor, but none is enrolled. Contact support.");
      }
      setLoading(false);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setLoading(true);
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError) {
        setError(challengeError.message);
        return;
      }
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      });
      if (verifyError) {
        setError(verifyError.message);
        return;
      }
      onVerified();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="provisio auth-screen">
      <div className="auth-card">
        <button className="brand-mark auth-brand auth-brand-link" onClick={onGoHome}>
          Provisio
        </button>
        <h2>Enter your authenticator code</h2>
        <p className="auth-sub">Open your authenticator app and enter the 6-digit code.</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <input
            className="p-input"
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
          {error && <p className="p-error">{error}</p>}
          <button className="p-btn p-btn-primary" type="submit" disabled={loading || !factorId || code.length !== 6}>
            {loading ? "Verifying..." : "Verify"}
          </button>
        </form>
      </div>
    </div>
  );
}
