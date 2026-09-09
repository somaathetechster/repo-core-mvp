import { useState } from "react";
import { githubLoginUrl, listRepos, analyzeRepo, type RepoListing, type AnalyzeResult } from "./api";
import "./App.css";

export default function App() {
  const [repos, setRepos] = useState<RepoListing[] | null>(null);
  const [selected, setSelected] = useState<AnalyzeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLoadRepos() {
    setError(null);
    setLoading(true);
    try {
      setRepos(await listRepos());
    } catch (e) {
      setError(
        "Couldn't load repos. Did you connect GitHub first? (Backend not stubbed with a real session yet.)"
      );
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
      setSelected(await analyzeRepo(owner, repo));
    } catch (e) {
      setError("Analysis failed. Check the backend logs.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <h1>repo-core</h1>
      <p className="subtitle">Connect a repo. See what it says about your company.</p>

      <div className="actions">
        <a className="button" href={githubLoginUrl()}>
          1. Connect GitHub
        </a>
        <button className="button" onClick={handleLoadRepos} disabled={loading}>
          2. Load my repos
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p>Working…</p>}

      {repos && (
        <ul className="repo-list">
          {repos.map((r) => (
            <li key={r.full_name}>
              <div>
                <strong>{r.full_name}</strong> {r.private && <span className="badge">private</span>}
                <p>{r.description}</p>
              </div>
              <button onClick={() => handleAnalyze(r.full_name)} disabled={loading}>
                Analyze
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="result">
          <h2>Technology slide draft</h2>
          <p className="slide-content">{selected.technology_slide_content}</p>

          <h3>Underlying evidence (what the AI was given — nothing more)</h3>
          <pre>{JSON.stringify(selected.summary, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
