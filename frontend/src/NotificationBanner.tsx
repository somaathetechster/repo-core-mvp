/**
 * NotificationBanner — polls for admin-sent notifications and shows them
 * as a dismissible banner at the top of the app.
 *
 * Polls every 60 seconds. Only shows when there are unread notifications.
 * The user can dismiss each one individually.
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

interface Props {
  /** Supabase access token for the current user. */
  accessToken: string | null;
}

export default function NotificationBanner({ accessToken }: Props) {
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [dismissing, setDismissing] = useState<Set<number>>(new Set());

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

  if (!notifs.length) return null;

  return (
    <div className="notif-stack">
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
