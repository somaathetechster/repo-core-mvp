const API_BASE = "http://localhost:8000";

// TODO: replace with a real user id from your auth system once it exists.
const DEV_USER_ID = "test-user-1";

function headers() {
  return { "X-User-Id": DEV_USER_ID };
}

export function githubLoginUrl() {
  return `${API_BASE}/auth/github/login`;
}

export interface RepoListing {
  full_name: string;
  private: boolean;
  description: string | null;
  updated_at: string;
}

export async function listRepos(): Promise<RepoListing[]> {
  const res = await fetch(`${API_BASE}/repos`, { headers: headers() });
  if (!res.ok) throw new Error(`Failed to list repos: ${res.status}`);
  return res.json();
}

export interface AnalyzeResult {
  summary: Record<string, unknown>;
  technology_slide_content: string;
}

export async function analyzeRepo(owner: string, repo: string): Promise<AnalyzeResult> {
  const res = await fetch(`${API_BASE}/repos/${owner}/${repo}/analyze`, {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Failed to analyze repo: ${res.status}`);
  return res.json();
}
