import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { listWorkspaces, setActiveWorkspaceOwnerId, type Workspace } from "./api";

/**
 * Tracks which workspace the user is currently acting inside.
 *
 * "My Workspace" is the user's own account and is represented by ownerId
 * `null`. Any other active workspace is one the user was invited to and
 * accepted. The active choice is mirrored into api.ts (so requests carry the
 * X-Workspace-Id header) and persisted to localStorage so a refresh keeps the
 * same context.
 */

export const ACTIVE_WORKSPACE_STORAGE_KEY = "provisio:active-workspace";
const STORAGE_KEY = ACTIVE_WORKSPACE_STORAGE_KEY;

export interface WorkspaceContextValue {
  /** null = the user's own "My Workspace". */
  activeOwnerId: string | null;
  /** Workspaces the user has been invited to and accepted. */
  workspaces: Workspace[];
  /** Human label for the current context, e.g. "My Workspace". */
  activeLabel: string;
  loading: boolean;
  setActive: (ownerId: string | null) => void;
  refresh: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeOwnerId, setActiveOwnerId] = useState<string | null>(() => {
    let initial: string | null = null;
    try {
      initial = localStorage.getItem(STORAGE_KEY) || null;
    } catch {
      initial = null;
    }
    // Prime api.ts synchronously, during the first render, so the header is
    // already correct before any child's mount fetch fires. Doing this only
    // in an effect would let the initial data load race ahead of it.
    setActiveWorkspaceOwnerId(initial);
    return initial;
  });

  // The single path for changing the active workspace: update api.ts
  // synchronously *before* the state change, so that when WorkspaceScope
  // remounts the tabs on the new activeOwnerId, their re-fetches already carry
  // the new X-Workspace-Id. (An effect-based sync fires after the children's
  // mount effects, which would refetch the previous workspace's data.)
  const applyActive = useCallback((ownerId: string | null) => {
    setActiveWorkspaceOwnerId(ownerId);
    setActiveOwnerId(ownerId);
  }, []);

  // Persist the choice so a refresh keeps the same context. (The api.ts sync
  // itself happens synchronously in applyActive / the initializer above.)
  useEffect(() => {
    try {
      if (activeOwnerId) localStorage.setItem(STORAGE_KEY, activeOwnerId);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage may be unavailable (private mode) — not worth failing over */
    }
  }, [activeOwnerId]);

  const refresh = useCallback(() => {
    setLoading(true);
    listWorkspaces()
      .then((ws) => setWorkspaces(ws))
      .catch(() => setWorkspaces([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // If the active workspace is no longer one we belong to (invite revoked,
  // or stale localStorage), fall back to the user's own workspace.
  useEffect(() => {
    if (loading || !activeOwnerId) return;
    if (!workspaces.some((w) => w.owner_id === activeOwnerId)) {
      applyActive(null);
    }
  }, [loading, workspaces, activeOwnerId, applyActive]);

  const setActive = applyActive;

  const activeLabel = useMemo(() => {
    if (!activeOwnerId) return "My Workspace";
    const w = workspaces.find((x) => x.owner_id === activeOwnerId);
    return w ? `${w.owner_name}'s Workspace` : "My Workspace";
  }, [activeOwnerId, workspaces]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({ activeOwnerId, workspaces, activeLabel, loading, setActive, refresh }),
    [activeOwnerId, workspaces, activeLabel, loading, setActive, refresh],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return ctx;
}

/**
 * Remounts its subtree whenever the active workspace changes.
 *
 * The data-driven tabs (decks list, company profile, evidence, review) fetch
 * once on mount and don't otherwise know when the workspace switched — so
 * without this they'd keep showing the previous workspace's data even though
 * api.ts is now sending the new X-Workspace-Id. Keying on the active owner id
 * forces those components to unmount and re-run their initial fetch against
 * the newly-active workspace. Wrap the routed content with it, not the whole
 * shell, so the top bar and switcher themselves stay put.
 */
export function WorkspaceScope({ children }: { children: ReactNode }) {
  const { activeOwnerId } = useWorkspace();
  return <Fragment key={activeOwnerId ?? "__me__"}>{children}</Fragment>;
}
