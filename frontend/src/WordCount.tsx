/**
 * A subtle, live word count shown under a text field.
 *
 * Kept deliberately small and muted — it's a writing aid, not a control.
 * Right-aligned so it tucks under the bottom-right of the field it follows.
 */
import "./word-count.css";

/** Counts whitespace-separated words, treating empty/whitespace as zero. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export default function WordCount({ text }: { text: string }) {
  const n = countWords(text);
  return (
    <span className="word-count" aria-live="polite">
      {n} {n === 1 ? "word" : "words"}
    </span>
  );
}
