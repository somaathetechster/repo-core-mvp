const BASE = import.meta.env.VITE_API_BASE as string;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY as string;

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": ADMIN_KEY,
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export interface AdminUser {
  user_id: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
  plan: string;
  plan_name: string;
  can_export: boolean;
  deck_count: number;
  export_count: number;
  joined: string | null;
}

export interface AdminStats {
  total_users: number;
  active_7d: number;
  total_decks: number;
  total_exports: number;
  paying_users: number;
  mrr_usd: number;
}

export interface AdminUsageRow {
  user_id: string;
  email: string;
  period: string;
  decks_created: number;
  exports_used: number;
  plan: string;
}

export const api = {
  stats: () => req<AdminStats>("/admin/stats"),
  users: (q?: string) => req<AdminUser[]>(
    `/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`
  ).then((r: any) => Array.isArray(r) ? r : (r.users ?? [])),
  grantAdmin:  (userId: string) => req<void>("/admin/grant-admin",  { method:"POST", body:JSON.stringify({ user_id: userId }) }),
  revokeAdmin: (userId: string) => req<void>("/admin/revoke-admin", { method:"POST", body:JSON.stringify({ user_id: userId }) }),
  grantPlan:   (userId: string, plan: string) =>
    req<void>("/admin/grant", { method:"POST", body:JSON.stringify({ target_user_id: userId, plan_id: plan, note: "admin grant" }) }),
  revokePlan:  (userId: string) =>
    req<void>("/admin/revoke-plan", { method:"POST", body:JSON.stringify({ user_id: userId }) }),
  usage: () => req<AdminUsageRow[]>("/admin/usage"),
  createAdminUser: (email: string, password: string) =>
    req<{ user_id: string }>("/admin/create-admin", { method:"POST", body:JSON.stringify({ email, password }) }),
};
