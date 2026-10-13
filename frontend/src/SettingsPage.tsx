import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Members from "./Members";
import "./settings.css";

type Section = "profile" | "members" | "billing";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "members", label: "Members" },
  { id: "billing", label: "Billing" },
];

export default function SettingsPage({
  userName,
  userEmail,
}: {
  userName: string;
  userEmail: string;
}) {
  const [active, setActive] = useState<Section>("members");
  const navigate = useNavigate();

  return (
    <div className="settings-page">
      <aside className="settings-sidebar">
        <h1 className="settings-title">Settings</h1>
        <nav className="settings-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`settings-nav-item ${active === s.id ? "settings-nav-item-active" : ""}`}
              onClick={() => {
                if (s.id === "billing") {
                  navigate("/billing");
                  return;
                }
                setActive(s.id);
              }}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="settings-content">
        {active === "profile" && (
          <div className="settings-profile">
            <div className="settings-section-head">
              <h2>Profile</h2>
              <p className="settings-section-desc">Your account details.</p>
            </div>
            <div className="profile-field">
              <label className="profile-field-label">Name</label>
              <div className="profile-field-value">{userName || <span className="profile-field-empty">Not set</span>}</div>
            </div>
            <div className="profile-field">
              <label className="profile-field-label">Email</label>
              <div className="profile-field-value">{userEmail || <span className="profile-field-empty">Not set</span>}</div>
            </div>
          </div>
        )}

        {active === "members" && <Members />}
      </div>
    </div>
  );
}
