import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import "./settings.css";

/**
 * Dropdown in the top navigation that switches the active workspace.
 * "My Workspace" is always first; accepted invitations follow.
 */
export default function WorkspaceSwitcher() {
  const { activeOwnerId, workspaces, activeLabel, setActive } = useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Nothing to switch between — don't clutter the bar with a dead dropdown.
  if (workspaces.length === 0) return null;

  return (
    <div className="ws-switcher" ref={ref}>
      <button
        className="ws-switcher-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="ws-switcher-label">{activeLabel}</span>
        <span className="ws-switcher-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <ul className="ws-switcher-menu" role="listbox">
          <li>
            <button
              className={`ws-switcher-item ${activeOwnerId === null ? "ws-switcher-item-active" : ""}`}
              role="option"
              aria-selected={activeOwnerId === null}
              onClick={() => {
                setActive(null);
                setOpen(false);
              }}
            >
              My Workspace
            </button>
          </li>
          {workspaces.map((w) => (
            <li key={w.owner_id}>
              <button
                className={`ws-switcher-item ${activeOwnerId === w.owner_id ? "ws-switcher-item-active" : ""}`}
                role="option"
                aria-selected={activeOwnerId === w.owner_id}
                onClick={() => {
                  setActive(w.owner_id);
                  setOpen(false);
                }}
              >
                <span className="ws-switcher-item-name">{w.owner_name}'s Workspace</span>
                <span className="ws-switcher-item-role">{w.role}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
