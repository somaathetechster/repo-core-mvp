import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "./supabaseClient";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import "./app-shell.css";

/* ── Icons ─────────────────────────────────────────────────────────────
   Small, stroke-based line icons so the sidebar reads as one set. Each is
   16×16 and inherits the surrounding text colour via `currentColor`. */
type IconProps = { className?: string };
const icon = (paths: ReactNode) => ({ className }: IconProps) => (
  <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths}
  </svg>
);

const HouseIcon = icon(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" /></>);
const BuildingIcon = icon(<><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M8 7h2M8 11h2M8 15h2M14 7h2M14 11h2M14 15h2" /></>);
const LayersIcon = icon(<><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>);
const DocIcon = icon(<><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v4h4" /><path d="M9 13h6M9 17h6" /></>);
const PaletteIcon = icon(<><path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-.5-.3-.9-.6-1.2-.3-.4-.6-.7-.6-1.3 0-.8.7-1.5 1.5-1.5H15a5 5 0 0 0 5-5c0-4-3.6-6.5-8-6.5Z" /><circle cx="7.5" cy="10.5" r="1" /><circle cx="12" cy="7.5" r="1" /><circle cx="16.5" cy="10.5" r="1" /></>);
const PenIcon = icon(<><path d="M15 4 20 9 8 21H3v-5L15 4Z" /><path d="m13.5 5.5 5 5" /></>);
const GearIcon = icon(<><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v2.5M12 19v2.5M4.5 12H2M22 12h-2.5M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" /></>);
const CardIcon = icon(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></>);
const ShieldIcon = icon(<><path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" /></>);
const LogoutIcon = icon(<><path d="M9 21H5V3h4" /><path d="M16 16l4-4-4-4" /><path d="M20 12H9" /></>);
const MenuIcon = icon(<><path d="M3 6h18M3 12h18M3 18h18" /></>);
const CloseIcon = icon(<><path d="M6 6l12 12M18 6 6 18" /></>);

interface NavItem {
  to: string;
  label: string;
  Icon: (p: IconProps) => ReactNode;
  soon?: boolean;
}

const SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { to: "/home", label: "Home", Icon: HouseIcon },
      { to: "/profile", label: "Company Profile", Icon: BuildingIcon },
    ],
  },
  {
    label: "Products",
    items: [
      { to: "/decks", label: "Decks", Icon: LayersIcon },
      { to: "/documents", label: "Docs", Icon: DocIcon },
      { to: "/brand", label: "Brand", Icon: PaletteIcon, soon: true },
      { to: "/sign", label: "Sign", Icon: PenIcon, soon: true },
    ],
  },
];

// Account items live pinned to the bottom of the sidebar.
const ACCOUNT_ITEMS: NavItem[] = [
  { to: "/settings", label: "Settings", Icon: GearIcon },
  { to: "/billing", label: "Billing", Icon: CardIcon },
  { to: "/security", label: "Security", Icon: ShieldIcon },
];

/**
 * The persistent app frame: a dark left sidebar with the Provisio wordmark,
 * the workspace switcher, grouped navigation, and the account block pinned to
 * the bottom. The routed page renders in the main column to its right.
 *
 * On desktop the sidebar is always visible. On mobile it collapses behind a
 * hamburger toggle and slides in over a dimming overlay.
 */
export default function AppShell({
  userName,
  userEmail,
  children,
}: {
  userName: string;
  userEmail: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer whenever navigation lands on a new route, so
  // tapping a nav item doesn't leave the drawer covering the page.
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  function renderItem(item: NavItem) {
    return (
      <NavLink
        key={item.to}
        to={item.to}
        className={({ isActive }) => `shell-nav-item ${isActive ? "shell-nav-item-active" : ""}`}
      >
        <item.Icon className="shell-nav-icon" />
        <span className="shell-nav-label">{item.label}</span>
        {item.soon && <span className="shell-soon-badge">Soon</span>}
      </NavLink>
    );
  }

  return (
    <div className="app-shell">
      {/* Mobile hamburger — only shown below the breakpoint via CSS. */}
      <button
        className="shell-hamburger"
        onClick={() => setMobileOpen((o) => !o)}
        aria-label={mobileOpen ? "Close menu" : "Open menu"}
        aria-expanded={mobileOpen}
      >
        {mobileOpen ? <CloseIcon /> : <MenuIcon />}
      </button>

      {/* Dimming overlay behind the mobile drawer. */}
      {mobileOpen && <div className="shell-overlay" onClick={() => setMobileOpen(false)} />}

      <aside className={`app-sidebar ${mobileOpen ? "app-sidebar-open" : ""}`}>
        <div className="shell-top">
          <button className="shell-brand" onClick={() => navigate("/home")}>
            Provisio
          </button>
          <WorkspaceSwitcher />
        </div>

        <nav className="shell-nav">
          {SECTIONS.map((section) => (
            <div className="shell-nav-section" key={section.label}>
              <div className="shell-nav-section-label">{section.label}</div>
              {section.items.map(renderItem)}
            </div>
          ))}
        </nav>

        <div className="shell-account">
          <div className="shell-nav-section-label">Account</div>
          {ACCOUNT_ITEMS.map(renderItem)}
          <button className="shell-nav-item shell-logout" onClick={() => supabase.auth.signOut()}>
            <LogoutIcon className="shell-nav-icon" />
            <span className="shell-nav-label">Log out</span>
          </button>
          <div className="shell-user" title={userEmail}>{userName || userEmail}</div>
          <a className="shell-domani" href="https://www.domanimedia.com" target="_blank" rel="noopener noreferrer">
            Powered by Domani
          </a>
        </div>
      </aside>

      <main className="app-main provisio">{children}</main>
    </div>
  );
}
