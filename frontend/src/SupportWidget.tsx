/**
 * Support widget.
 *
 * A founder stuck at 1am should be able to say so without leaving the page
 * they're stuck on. This is a floating button that opens a thread with the
 * Provisio team.
 *
 * It polls, rather than holding a socket: every 20 seconds while closed (just
 * for the unread badge, which is a count rather than the messages) and every
 * 6 seconds while open. Polling stops entirely when the browser tab is
 * hidden, so a backgrounded tab costs nothing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import "./support-widget.css";

const API_BASE = import.meta.env.VITE_API_BASE as string;

interface Message {
  id: number;
  sender: "user" | "admin";
  body: string;
  created_at: string | null;
}

export default function SupportWidget({ accessToken }: { accessToken: string | null }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const headers = useCallback(
    () => ({ "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }),
    [accessToken],
  );

  const loadMessages = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_BASE}/support/messages`, { headers: headers() });
      if (res.ok) { setMessages(await res.json()); setUnread(0); }
    } catch { /* a failed poll is not worth interrupting the founder for */ }
  }, [accessToken, headers]);

  const loadUnread = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_BASE}/support/unread`, { headers: headers() });
      if (res.ok) setUnread((await res.json()).unread ?? 0);
    } catch { /* ignore */ }
  }, [accessToken, headers]);

  // Poll at a rate that matches whether anyone is actually looking.
  useEffect(() => {
    if (!accessToken) return;
    const tick = () => {
      if (document.hidden) return;
      if (open) loadMessages(); else loadUnread();
    };
    tick();
    const interval = setInterval(tick, open ? 6000 : 20000);
    return () => clearInterval(interval);
  }, [open, accessToken, loadMessages, loadUnread]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true); setError(null);

    // Show it immediately with a temporary id; the poll replaces it with the
    // stored row. Waiting on the network to see your own words feels broken.
    const optimistic: Message = { id: -Date.now(), sender: "user", body, created_at: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    setDraft("");

    try {
      const res = await fetch(`${API_BASE}/support/messages`, {
        method: "POST", headers: headers(), body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error(await res.text());
      const saved: Message = await res.json();
      setMessages((m) => m.map((x) => (x.id === optimistic.id ? saved : x)));
    } catch {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setDraft(body);
      setError("Couldn't send that. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  if (!accessToken) return null;

  return (
    <>
      <button
        className={`sw-launcher ${open ? "is-open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close support" : "Open support"}
      >
        {open ? "✕" : "Support"}
        {!open && unread > 0 && <span className="sw-badge">{unread}</span>}
      </button>

      {open && (
        <section className="sw-panel" role="dialog" aria-label="Support conversation">
          <header className="sw-head">
            <div>
              <div className="sw-title">Support</div>
              <div className="sw-sub">We usually reply within a few hours.</div>
            </div>
            <button className="sw-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </header>

          <div className="sw-thread">
            {messages.length === 0 && (
              <div className="sw-empty">
                <p>Tell us what's going wrong, or what you're trying to do.</p>
                <p className="sw-empty-hint">Screenshots help — paste a link to one if you have it.</p>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`sw-msg sw-${m.sender}`}>
                <div className="sw-bubble">{m.body}</div>
                <div className="sw-time">
                  {m.sender === "admin" ? "Provisio" : "You"}
                  {m.created_at && ` · ${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {error && <p className="sw-error">{error}</p>}

          <div className="sw-compose">
            <textarea
              rows={2}
              placeholder="Type your message…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              }}
            />
            <button onClick={send} disabled={!draft.trim() || sending}>
              {sending ? "…" : "Send"}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
