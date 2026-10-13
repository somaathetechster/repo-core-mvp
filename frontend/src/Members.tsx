import { useCallback, useEffect, useState } from "react";
import {
  ROLE_OPTIONS,
  inviteMember,
  listMembers,
  listPendingInvites,
  removeMember,
  revokeInvite,
  updateMemberRole,
  type Member,
  type PendingInvite,
  type WorkspaceRole,
} from "./api";
import { useWorkspace } from "./WorkspaceContext";
import "./settings.css";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  ...Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label])),
};

export default function Members() {
  const { refresh: refreshWorkspaces } = useWorkspace();
  const [members, setMembers] = useState<Member[]>([]);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("viewer");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, p] = await Promise.all([listMembers(), listPendingInvites()]);
      setMembers(m);
      setPending(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load members.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    setInviting(true);
    setError(null);
    setInviteMsg(null);
    try {
      await inviteMember(email, inviteRole);
      setInviteEmail("");
      setInviteRole("viewer");
      setInviteMsg(`Invitation sent to ${email}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that invite.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(m: Member, role: WorkspaceRole) {
    setError(null);
    try {
      await updateMemberRole(m.id, role);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change that role.");
    }
  }

  async function handleRemove(m: Member) {
    setError(null);
    try {
      await removeMember(m.id);
      await load();
      refreshWorkspaces();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove that member.");
    }
  }

  async function handleRevoke(p: PendingInvite) {
    setError(null);
    try {
      await revokeInvite(p.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't revoke that invite.");
    }
  }

  // Members already accepted (the owner is always included by the API).
  const activeMembers = members.filter((m) => m.status === "accepted");

  if (loading) return <p className="settings-loading">Loading members…</p>;

  return (
    <div className="members">
      <div className="settings-section-head">
        <h2>Members</h2>
        <p className="settings-section-desc">
          Invite people into your workspace and control what they can do.
        </p>
      </div>

      {error && <p className="p-error settings-error">{error}</p>}

      {/* ── Current members ─────────────────────────────────────────── */}
      <section className="members-block">
        <h3 className="members-block-title">Current members</h3>
        <ul className="members-list">
          {activeMembers.map((m) => (
            <li key={m.id} className="member-row">
              <div className="member-identity">
                <span className="member-name">{m.name}</span>
                {m.email && <span className="member-email">{m.email}</span>}
              </div>
              <div className="member-controls">
                {m.is_owner ? (
                  <span className="role-badge role-badge-owner">Owner</span>
                ) : (
                  <>
                    <select
                      className="p-input member-role-select"
                      value={m.role}
                      onChange={(e) => handleRoleChange(m, e.target.value as WorkspaceRole)}
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className="p-btn p-btn-ghost member-remove"
                      onClick={() => handleRemove(m)}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Invite form ─────────────────────────────────────────────── */}
      <section className="members-block">
        <h3 className="members-block-title">Invite someone</h3>
        <form className="invite-form" onSubmit={handleInvite}>
          <input
            className="p-input invite-email"
            type="email"
            placeholder="name@company.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
          />
          <select
            className="p-input invite-role"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label} — {r.description}
              </option>
            ))}
          </select>
          <button className="p-btn p-btn-primary" type="submit" disabled={inviting}>
            {inviting ? "Sending…" : "Send Invite"}
          </button>
        </form>
        {inviteMsg && <p className="invite-success">{inviteMsg}</p>}
        <p className="invite-role-hint">{ROLE_OPTIONS.find((r) => r.value === inviteRole)?.description}</p>
      </section>

      {/* ── Pending invites ─────────────────────────────────────────── */}
      {pending.length > 0 && (
        <section className="members-block">
          <h3 className="members-block-title">Pending invites</h3>
          <ul className="members-list">
            {pending.map((p) => (
              <li key={p.id} className="member-row">
                <div className="member-identity">
                  <span className="member-name">{p.invitee_email}</span>
                  <span className="member-email">Invited · not yet accepted</span>
                </div>
                <div className="member-controls">
                  <span className="role-badge">{ROLE_LABEL[p.role] ?? p.role}</span>
                  <button className="p-btn p-btn-ghost member-remove" onClick={() => handleRevoke(p)}>
                    Revoke
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
