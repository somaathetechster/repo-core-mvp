/**
 * NotificationBanner — polls for admin-sent notifications and shows them
 * as a dismissible banner at the top of the app.
 *
 * Polls every 60 seconds. Only shows when there are unread notifications.
 * The user can dismiss each one individually.
 *
 * It also renders *client-side* plan-upgrade notifications (see
 * registerPlanUpgrade below). Those live in localStorage, persist for 24
 * hours, and are keyed by plan+date so the same upgrade never nags twice.
 */
import { useEffect, useState, useCallback } from "react";
import "./notification-banner.css";

interface Notification {
  id: number;
  message: string;
  category: "info" | "success" | "warning";
  created_at: string;
}

const API_BASE = import.meta.env.VITE_API_BASE as string;

// ── Plan-upgrade notifications (client-side, localStorage-backed) ─────────

const PLAN_UPGRADE_PREFIX = "provisio:plan-upgrade:";
const PLAN_UPGRADE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
/** Dispatched after a plan-upgrade notification is stored, so a mounted
 *  banner picks it up without waiting for its next poll. */
export const PLAN_UPGRADE_EVENT = "provisio:plan-upgrade";

interface StoredUpgrade {
  plan: string;
  ts: number;
  dismissed: boolean;
}

/**
 * Record that the user was just upgraded to `planName`. Safe to call more than
 * once for the same upgrade: the entry is keyed by plan + calendar day, so a
 * refresh or a re-fire won't produce a second banner once it's been dismissed.
 */
export function registerPlanUpgrade(planName: string) {
  try {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const key = `${PLAN_UPGRADE_PREFIX}${planName}:${date}`;
    const existingRaw = localStorage.getItem(key);
    // Don't resurrect an upgrade the user already dismissed today.
    if (existingRaw) {
      try {
        if ((JSON.parse(existingRaw) as StoredUpgrade).dismissed) return;
      } catch { /* fall through and rewrite */ }
    }
    const entry: StoredUpgrade = { plan: planName, ts: Date.now(), dismissed: false };
    localStorage.setItem(key, JSON.stringify(entry));
    window.dispatchEvent(new CustomEvent(PLAN_UPGRADE_EVENT));
  } catch {
    /* localStorage unavailable — the celebration overlay already fired, so
       losing the follow-up banner is acceptable. */
  }
}

interface LiveUpgrade {
  key: string;
  plan: string;
}

function readUpgrades(): LiveUpgrade[] {
  const out: LiveUpgrade[] = [];
  try {
    const now = Date.now();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PLAN_UPGRADE_PREFIX)) continue;
      try {
        const entry = JSON.parse(localStorage.getItem(key) || "") as StoredUpgrade;
        if (now - entry.ts > PLAN_UPGRADE_TTL_MS) {
          localStorage.removeItem(key); // expired — clean it up
          continue;
        }
        if (!entry.dismissed) out.push({ key, plan: entry.plan });
      } catch {
        /* malformed entry — ignore */
      }
    }
  } catch {
    /* localStorage unavailable */
  }
  return out;
}

function dismissUpgrade(key: string) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const entry = JSON.parse(raw) as StoredUpgrade;
    entry.dismissed = true;
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    /* ignore */
  }
}

interface Props {
  /** Supabase access token for the current user. */
  accessToken: string | null;
}

export default function NotificationBanner({ accessToken }: Props) {
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [dismissing, setDismissing] = useState<Set<number>>(new Set());
  const [upgrades, setUpgrades] = useState<LiveUpgrade[]>(() => readUpgrades());

  const poll = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_BASE}/notifications`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) setNotifs(await res.json());
    } catch {
      // Silent — a failed poll is not an error the user needs to see
    }
  }, [accessToken]);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 60_000);
    return () => clearInterval(interval);
  }, [poll]);

  // Refresh the plan-upgrade banners when one is registered, and prune expired
  // ones periodically.
  useEffect(() => {
    const refresh = () => setUpgrades(readUpgrades());
    window.addEventListener(PLAN_UPGRADE_EVENT, refresh);
    const interval = setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener(PLAN_UPGRADE_EVENT, refresh);
      clearInterval(interval);
    };
  }, []);

  const dismiss = async (id: number) => {
    setDismissing(s => new Set(s).add(id));
    try {
      await fetch(`${API_BASE}/notifications/${id}/dismiss`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setNotifs(n => n.filter(x => x.id !== id));
    } catch {
      setDismissing(s => { const next = new Set(s); next.delete(id); return next; });
    }
  };

  const handleDismissUpgrade = (key: string) => {
    dismissUpgrade(key);
    setUpgrades(u => u.filter(x => x.key !== key));
  };

  if (!notifs.length && !upgrades.length) return null;

  return (
    <div className="notif-stack">
      {upgrades.map(u => (
        <div key={u.key} className="notif notif-upgrade">
          <div className="notif-icon">🎉</div>
          <div className="notif-message">
            You're now on the {u.plan} plan. Start by generating your first deck.
          </div>
          <button
            className="notif-dismiss"
            onClick={() => handleDismissUpgrade(u.key)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
      {notifs.map(n => (
        <div key={n.id} className={`notif notif-${n.category}`}>
          <div className="notif-icon">
            {n.category === "success" ? "✦" : n.category === "warning" ? "⚠" : "ℹ"}
          </div>
          <div className="notif-message">{n.message}</div>
          <button
            className="notif-dismiss"
            disabled={dismissing.has(n.id)}
            onClick={() => dismiss(n.id)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
