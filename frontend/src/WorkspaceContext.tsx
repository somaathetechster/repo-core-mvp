import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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
    try {
      return localStorage.getItem(STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });

  // Keep api.ts in sync so every request made while a workspace is active
  // carries the header, from the very first render.
  useEffect(() => {
    setActiveWorkspaceOwnerId(activeOwnerId);
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
      setActiveOwnerId(null);
    }
  }, [loading, workspaces, activeOwnerId]);

  const setActive = useCallback((ownerId: string | null) => setActiveOwnerId(ownerId), []);

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
