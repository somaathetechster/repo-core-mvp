import { supabase } from "./supabaseClient";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not logged in.");
  return token;
}

async function authHeaders(): Promise<HeadersInit> {
  return { Authorization: `Bearer ${await getToken()}` };
}

// A plain <a href> can't carry an Authorization header, so the GitHub-connect
// entry point takes the token as a query param instead. The backend reads it
// from either place (see github_auth.py) — query param only for this one
// browser-redirect route, everything else uses the header.
export async function startGithubConnect() {
  const token = await getToken();
  window.location.href = `${API_BASE}/auth/github/install?access_token=${encodeURIComponent(token)}`;
}

export interface RepoListing {
  full_name: string;
  private: boolean;
  description: string | null;
  updated_at: string;
}

async function throwWithDetail(res: Response, fallback: string): Promise<never> {
  let detail: string | null = null;
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") detail = body.detail;
  } catch {
    // body wasn't JSON or had no detail field
  }
  throw new Error(detail ?? fallback);
}

export async function listRepos(): Promise<RepoListing[]> {
  const res = await fetch(`${API_BASE}/repos`, { headers: await authHeaders() });
  if (!res.ok) await throwWithDetail(res, `Failed to list repos: ${res.status}`);
  return res.json();
}

export interface AnalyzeResult {
  summary: Record<string, unknown>;
  technology_slide_content: string;
}

export async function analyzeRepo(owner: string, repo: string): Promise<AnalyzeResult> {
  const res = await fetch(`${API_BASE}/repos/${owner}/${repo}/analyze`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) await throwWithDetail(res, `Failed to analyze repo: ${res.status}`);
  return res.json();
}

export interface TeamMember {
  name: string;
  role: string;
  bio: string;
  photo_data_url: string;
  linkedin_url: string;
}

export interface TaggedImage {
  data_url: string;
  tag: "product" | "market" | "traction" | "cover" | "other";
}

export interface CompanyProfile {
  company_name: string;
  one_liner: string;
  website_url: string;
  industry: string;
  stage: string;
  location: string;
  founded_date: string;
  incorporation_status: string;
  incorporation_country: string;

  logo_data_url: string;
  company_image_data_urls: TaggedImage[];
  demo_video_url: string;
  brand_primary_color: string;
  brand_secondary_color: string;
  brand_font_style: "serif" | "sans" | "classic";

  problem: string;
  solution: string;
  evidence_of_innovation: string;
  differentiation: string;
  patents_or_ip: string;

  market_research: string;
  market_opportunity: string;
  tam: string;
  sam: string;
  som: string;
  competitive_landscape: string;
  go_to_market: string;

  traction: string;
  key_metrics: string;
  business_model: string;
  pricing_model: string;

  team_members: TeamMember[];

  funding_ask: string;
  use_of_funds: string;
  previous_funding: string;
  valuation_expectation: string;

  risks_and_mitigations: string;

  program_name: string;
  program_type: string;
  program_url: string;
  program_requirements: string;
  program_deadline: string;
}

export interface DeckSlideBlock {
  text: string;
  source: string;
}

export interface DeckTeamMember {
  name: string;
  role: string;
  bio: string;
  photo_data_url: string;
  linkedin_url: string;
}

export interface DeckSlide {
  id: string;
  type: "cover" | "text" | "team" | "image" | "toc" | "chart";
  title: string;
  blocks: DeckSlideBlock[];
  image_data_url: string | null;
  team_members: DeckTeamMember[] | null;
  toc_entries: { title: string }[] | null;
  chart?: { chart_type: "bar" | "line" | "pie" | "table"; columns: string[]; rows: string[][] };
}

export interface DeckTheme {
  primary_color: string | null;
  secondary_color: string | null;
  font_style: string;
}

export interface DeckSummary {
  id: string;
  name: string;
  slide_count: number;
  updated_at: string | null;
  created_at: string | null;
}

export interface FullDeck extends DeckSummary {
  profile_snapshot: Record<string, unknown>;
  repo_full_names: string[];
  slides: DeckSlide[];
  theme: DeckTheme;
  layouts: Record<string, unknown>;
  freeform_slide_ids: string[];
}

export async function listDecks(): Promise<DeckSummary[]> {
  const res = await fetch(`${API_BASE}/decks`, { headers: await authHeaders() });
  if (!res.ok) await throwWithDetail(res, `Failed to load decks: ${res.status}`);
  return res.json();
}

export async function createDeck(params: {
  name: string;
  useSharedProfile: boolean;
  repoSummaries: Record<string, unknown>[];
}): Promise<FullDeck> {
  const res = await fetch(`${API_BASE}/decks`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({
      name: params.name,
      use_shared_profile: params.useSharedProfile,
      repo_summaries: params.repoSummaries,
    }),
  });
  if (!res.ok) await throwWithDetail(res, `Failed to create deck: ${res.status}`);
  return res.json();
}

export async function getDeck(deckId: string): Promise<FullDeck> {
  const res = await fetch(`${API_BASE}/decks/${deckId}`, { headers: await authHeaders() });
  if (!res.ok) await throwWithDetail(res, `Failed to load deck: ${res.status}`);
  return res.json();
}

export async function saveDeckEditorState(
  deckId: string,
  state: {
    name?: string;
    slides: DeckSlide[];
    theme: DeckTheme;
    layouts: Record<string, unknown>;
    freeform_slide_ids: string[];
  }
): Promise<void> {
  const res = await fetch(`${API_BASE}/decks/${deckId}`, {
    method: "PUT",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
  if (!res.ok) await throwWithDetail(res, `Failed to save deck: ${res.status}`);
}

export async function updateDeckProfile(deckId: string, profile: CompanyProfile): Promise<void> {
  const res = await fetch(`${API_BASE}/decks/${deckId}/profile`, {
    method: "PUT",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
  if (!res.ok) await throwWithDetail(res, `Failed to update deck profile: ${res.status}`);
}

export async function regenerateDeck(
  deckId: string,
  repoSummaries: Record<string, unknown>[]
): Promise<FullDeck> {
  const res = await fetch(`${API_BASE}/decks/${deckId}/regenerate`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ repo_summaries: repoSummaries }),
  });
  if (!res.ok) await throwWithDetail(res, `Failed to regenerate deck: ${res.status}`);
  return res.json();
}

export async function deleteDeck(deckId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/decks/${deckId}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) await throwWithDetail(res, `Failed to delete deck: ${res.status}`);
}

export interface RecordType {
  key: string;
  label: string;
  default_columns: string[];
}

export interface DataRecord {
  id: string;
  record_type: string;
  title: string;
  columns: string[];
  rows: string[][];
  chart_type: "bar" | "line" | "pie" | "table";
}

export async function listRecordTypes(): Promise<RecordType[]> {
  const res = await fetch(`${API_BASE}/data-records/types`, { headers: await authHeaders() });
  if (!res.ok) await throwWithDetail(res, `Failed to load record types: ${res.status}`);
  return res.json();
}

export async function listDataRecords(): Promise<DataRecord[]> {
  const res = await fetch(`${API_BASE}/data-records`, { headers: await authHeaders() });
  if (!res.ok) await throwWithDetail(res, `Failed to load data records: ${res.status}`);
  return res.json();
}

export async function createDataRecord(record: Omit<DataRecord, "id">): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/data-records`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
  if (!res.ok) await throwWithDetail(res, `Failed to create record: ${res.status}`);
  return res.json();
}

export async function updateDataRecord(id: string, record: Omit<DataRecord, "id">): Promise<void> {
  const res = await fetch(`${API_BASE}/data-records/${id}`, {
    method: "PUT",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
  if (!res.ok) await throwWithDetail(res, `Failed to update record: ${res.status}`);
}

export async function deleteDataRecord(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/data-records/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) await throwWithDetail(res, `Failed to delete record: ${res.status}`);
}

export async function getCompanyProfile(): Promise<CompanyProfile> {
  const res = await fetch(`${API_BASE}/company-profile`, { headers: await authHeaders() });
  if (!res.ok) await throwWithDetail(res, `Failed to load company profile: ${res.status}`);
  return res.json();
}

export async function saveCompanyProfile(profile: CompanyProfile): Promise<void> {
  const res = await fetch(`${API_BASE}/company-profile`, {
    method: "PUT",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
  if (!res.ok) await throwWithDetail(res, `Failed to save company profile: ${res.status}`);
}
