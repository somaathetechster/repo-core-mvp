import { useCallback, useState } from "react";

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
  interface HistoryState {
    present: T;
    past: T[];
    future: T[];
    lastLabel: string | null;
    lastAt: number;
  }
  const [history, setHistory] = useState<HistoryState>({
    present: initial, past: [], future: [], lastLabel: null, lastAt: 0,
  });

  const set = useCallback((next: T | ((prev: T) => T), label = "edit") => {
    setHistory((current) => {
      const resolved = typeof next === "function"
        ? (next as (p: T) => T)(current.present)
        : next;
      if (Object.is(resolved, current.present)) return current;
      const now = Date.now();
      const sameGesture = label === current.lastLabel && now - current.lastAt < COALESCE_MS;
      return {
        present: resolved,
        past: sameGesture ? current.past : [...current.past.slice(-(MAX_HISTORY - 1)), current.present],
        future: sameGesture ? current.future : [],
        lastLabel: label,
        lastAt: now,
      };
    });
  }, []);

  const reset = useCallback((next: T) => {
    setHistory({ present: next, past: [], future: [], lastLabel: null, lastAt: 0 });
  }, []);

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.past.at(-1);
      if (previous === undefined) return current;
      return {
        present: previous,
        past: current.past.slice(0, -1),
        future: [current.present, ...current.future],
        lastLabel: null,
        lastAt: 0,
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = current.future[0];
      if (next === undefined) return current;
      return {
        present: next,
        past: [...current.past, current.present],
        future: current.future.slice(1),
        lastLabel: null,
        lastAt: 0,
      };
    });
  }, []);

  const commit = useCallback(() => {
    setHistory((current) => ({ ...current, lastLabel: null, lastAt: 0 }));
  }, []);

  return {
    state: history.present,
    set,
    reset,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    commit,
  };
}
