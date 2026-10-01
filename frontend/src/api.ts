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
  program_questions: string;
  why_this_program: string;
  why_now: string;
  customer_segment: string;
  unit_economics: string;
  milestones_next_12m: string;
  impact_outcomes: string;
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
  /** Compositional template and colour scheme, persisted with the deck. */
  template_id?: string | null;
  scheme_id?: string | null;
  font_pairing?: string | null;
  type_scale?: number | null;
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

export interface DeckCoachMessage {
  role: "user" | "assistant";
  content: string;
}

export async function askDeckCoach(
  messages: DeckCoachMessage[],
  deckContext: {
    findings: { id: string; title: string; detail: string; severity: string }[];
    approved_ids: string[];
    rejected_ids: string[];
    brief: unknown;
    profile: CompanyProfile | null;
    deck_name: string;
  },
): Promise<{ reply: string }> {
  const res = await fetch(`${API_BASE}/ai/deck-coach`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ messages, deck_context: deckContext }),
  });
  if (!res.ok) await throwWithDetail(res, `Failed to contact the deck coach: ${res.status}`);
  return res.json();
}

export async function addSlide(
  deckId: string,
  section: string,
  position?: number,
): Promise<FullDeck> {
  const res = await fetch(`${API_BASE}/decks/${deckId}/slides`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ section, position }),
  });
  if (!res.ok) await throwWithDetail(res, `Failed to add slide: ${res.status}`);
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

export async function renameDeck(deckId: string, name: string): Promise<DeckSummary> {
  const res = await fetch(`${API_BASE}/decks/${deckId}`, {
    method: "PATCH",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) await throwWithDetail(res, `Failed to rename deck: ${res.status}`);
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

/* ---------------------------------------------------------------- */
/* Data Studio                                                       */
/* ---------------------------------------------------------------- */

export interface DetectedTable {
  title: string;
  columns: string[];
  rows: string[][];
  source: string;
  row_count: number;
  column_count: number;
  notes: string[];
}

export interface ColumnProfileDTO {
  name: string;
  index: number;
  type: string;
  role: string;
  null_count: number;
  unique_count: number;
  currency: string | null;
  is_percentage: boolean;
  date_granularity: string | null;
  min: number | null;
  max: number | null;
  mean: number | null;
  sample_values: string[];
  issues: string[];
  confidence: number;
}

export interface TableProfileDTO {
  title: string;
  row_count: number;
  columns: ColumnProfileDTO[];
  issues: string[];
}

export interface ChartSpecDTO {
  chart_type: string;
  title: string;
  reason: string;
  score: number;
  encoding: Record<string, unknown>;
  warnings: string[];
}

export interface ChartAdviceDTO {
  recommendations: ChartSpecDTO[];
  rejections: { chart_type: string; reason: string }[];
}

export interface SuggestedTransform {
  op: string;
  label: string;
  reason: string;
  params: Record<string, unknown>;
}

export interface ProfileResponse {
  profile: TableProfileDTO;
  charts: ChartAdviceDTO;
  suggested_transforms: SuggestedTransform[];
}

export async function ingestText(text: string): Promise<{ tables: DetectedTable[] }> {
  const res = await fetch(`${API_BASE}/data-studio/ingest`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) await throwWithDetail(res, "Could not read that data.");
  return res.json();
}

export async function ingestFile(file: File): Promise<{ tables: DetectedTable[]; filename: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/data-studio/ingest-file`, {
    method: "POST",
    headers: await authHeaders(),
    body: form,
  });
  if (!res.ok) await throwWithDetail(res, "Could not read that file.");
  return res.json();
}

export async function profileTable(
  title: string,
  columns: string[],
  rows: (string | number | null)[][]
): Promise<ProfileResponse> {
  const res = await fetch(`${API_BASE}/data-studio/profile`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ title, columns, rows }),
  });
  if (!res.ok) await throwWithDetail(res, "Could not analyse that table.");
  return res.json();
}

export interface TransformResponse extends ProfileResponse {
  result: { columns: string[]; rows: (string | number | null)[][]; description: string; notes: string[] };
}

export async function transformTable(
  op: string,
  columns: string[],
  rows: (string | number | null)[][],
  params: Record<string, unknown>,
  title = "Transformed data"
): Promise<TransformResponse> {
  const res = await fetch(`${API_BASE}/data-studio/transform`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ op, columns, rows, params, title }),
  });
  if (!res.ok) await throwWithDetail(res, "Could not apply that transform.");
  return res.json();
}

/* ---------------------------------------------------------------- */
/* Pitch deck import                                                 */
/* ---------------------------------------------------------------- */

export interface ImportSuggestion {
  field: string;
  value: string;
  source_slides: number[];
  confidence: "high" | "medium" | "low";
}

export interface DeckImportResult {
  detected_company_name: string | null;
  slide_count: number;
  slides: { index: number; title: string; excerpt: string }[];
  suggestions: ImportSuggestion[];
  warnings: string[];
}

export async function importPitchDeck(file: File): Promise<DeckImportResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/company-profile/import-deck`, {
    method: "POST",
    headers: await authHeaders(),
    body: form,
  });
  if (!res.ok) await throwWithDetail(res, "Could not import that deck.");
  return res.json();
}

/* ---------------------------------------------------------------- */
/* Billing                                                           */
/* ---------------------------------------------------------------- */

export interface PlanDTO {
  id: string;
  name: string;
  description: string;
  price_usd: number;
  interval: string | null;
  deck_exports: number | null;
  features: string[];
}

export interface EntitlementDTO {
  plan: PlanDTO;
  can_export: boolean;
  reason: string;
  is_paid: boolean;
  exports_remaining: number | null;
  period_end: string | null;
  subscription_id: string | null;
}

/** Thrown when the backend returns 402, carrying the plans to offer. */
export class PaymentRequiredError extends Error {
  plans: PlanDTO[];
  constructor(message: string, plans: PlanDTO[]) {
    super(message);
    this.name = "PaymentRequiredError";
    this.plans = plans;
  }
}

export async function getMyBilling(): Promise<{
  entitlement: EntitlementDTO;
  exports_used: number;
  history: Record<string, unknown>[];
}> {
  const res = await fetch(`${API_BASE}/billing/me`, { headers: await authHeaders() });
  if (!res.ok) await throwWithDetail(res, "Couldn't load your plan.");
  return res.json();
}

export async function listPlans(): Promise<{ plans: PlanDTO[] }> {
  const res = await fetch(`${API_BASE}/billing/plans`, { headers: await authHeaders() });
  if (!res.ok) await throwWithDetail(res, "Couldn't load plans.");
  return res.json();
}

export interface AdminUser {
  user_id: string;
  email: string | null;
  display_name: string | null;
  is_admin: boolean;
  plan: string;
  plan_name: string;
  can_export: boolean;
  period_end: string | null;
  deck_count: number;
  export_count: number;
  joined: string | null;
}

export async function adminListUsers(): Promise<{
  users: AdminUser[];
  totals: { users: number; paying: number; decks: number; exports: number };
}> {
  const res = await fetch(`${API_BASE}/admin/users`, { headers: await authHeaders() });
  if (!res.ok) await throwWithDetail(res, "Couldn't load users.");
  return res.json();
}

export async function adminGrantPlan(target_user_id: string, plan_id: string, note: string) {
  const res = await fetch(`${API_BASE}/admin/grant`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ target_user_id, plan_id, note }),
  });
  if (!res.ok) await throwWithDetail(res, "Couldn't grant that plan.");
  return res.json();
}

export async function adminRevoke(subscription_id: string, reason: string) {
  const res = await fetch(`${API_BASE}/admin/revoke`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ subscription_id, reason }),
  });
  if (!res.ok) await throwWithDetail(res, "Couldn't revoke.");
  return res.json();
}
