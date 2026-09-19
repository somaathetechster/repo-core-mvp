import { useCallback, useRef, useState } from "react";

/**
 * Undo/redo for the deck editor.
 *
 * The subtlety is drag and resize: a single drag fires dozens of state
 * updates, and pushing each one would make undo useless (fifty presses to
 * reverse one gesture). So updates made within a short window under the
 * same label are coalesced into one entry, which means one drag, one
 * keystroke run, or one slider sweep costs exactly one undo.
 */

const COALESCE_MS = 600;
const MAX_HISTORY = 80;

export interface HistoryApi<T> {
  state: T;
  /** Replaces state and records an undo entry. `label` groups rapid edits. */
  set: (next: T | ((prev: T) => T), label?: string) => void;
  /** Replaces state without recording anything (loading, remote sync). */
  reset: (next: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Ends the current coalescing window, so the next edit starts a new entry. */
  commit: () => void;
}

export function useHistory<T>(initial: T): HistoryApi<T> {
  const [state, setState] = useState<T>(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const lastLabel = useRef<string | null>(null);
  const lastAt = useRef(0);
  const [, force] = useState(0);

  const set = useCallback((next: T | ((prev: T) => T), label = "edit") => {
    setState((prev) => {
      const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      if (Object.is(resolved, prev)) return prev;

      const now = Date.now();
      const sameGesture = label === lastLabel.current && now - lastAt.current < COALESCE_MS;

      if (!sameGesture) {
        past.current = [...past.current.slice(-(MAX_HISTORY - 1)), prev];
        future.current = [];
      }
      lastLabel.current = label;
      lastAt.current = now;
      return resolved;
    });
    force((n) => n + 1);
  }, []);

  const reset = useCallback((next: T) => {
    past.current = [];
    future.current = [];
    lastLabel.current = null;
    setState(next);
    force((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    setState((prev) => {
      const previous = past.current[past.current.length - 1];
      if (previous === undefined) return prev;
      past.current = past.current.slice(0, -1);
      future.current = [prev, ...future.current];
      lastLabel.current = null;
      return previous;
    });
    force((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    setState((prev) => {
      const next = future.current[0];
      if (next === undefined) return prev;
      future.current = future.current.slice(1);
      past.current = [...past.current, prev];
      lastLabel.current = null;
      return next;
    });
    force((n) => n + 1);
  }, []);

  const commit = useCallback(() => {
    lastLabel.current = null;
  }, []);

  return {
    state,
    set,
    reset,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    commit,
  };
}
