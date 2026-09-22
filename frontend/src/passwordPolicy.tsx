/**
 * Password policy, in one place.
 *
 * Sign-up, password reset and password change all have to agree on what a
 * valid password is. When each screen carries its own rules they drift, and
 * a founder ends up able to set a password on one screen that another screen
 * would have rejected.
 *
 * The rules are shown as a live checklist rather than as an error after
 * submitting. Telling someone what's required while they type is the
 * difference between one attempt and four.
 *
 * This is client-side convenience, not enforcement. Supabase enforces its own
 * minimum server-side, and these rules should be mirrored in
 * Authentication → Policies so they can't be bypassed by calling the API
 * directly.
 */

export interface PasswordRule {
  id: string;
  label: string;
  test: (value: string) => boolean;
}

export const MIN_PASSWORD_LENGTH = 10;

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "length",
    label: `At least ${MIN_PASSWORD_LENGTH} characters`,
    test: (v) => v.length >= MIN_PASSWORD_LENGTH,
  },
  {
    id: "lower",
    label: "A lowercase letter",
    test: (v) => /[a-z]/.test(v),
  },
  {
    id: "upper",
    label: "An uppercase letter",
    test: (v) => /[A-Z]/.test(v),
  },
  {
    id: "number",
    label: "A number",
    test: (v) => /\d/.test(v),
  },
  {
    id: "symbol",
    label: "A symbol (!, ?, @, and so on)",
    test: (v) => /[^A-Za-z0-9]/.test(v),
  },
];

/** Every rule the password currently fails. Empty means it's acceptable. */
export function failedRules(value: string): PasswordRule[] {
  return PASSWORD_RULES.filter((r) => !r.test(value));
}

export function isPasswordValid(value: string): boolean {
  return failedRules(value).length === 0;
}

/**
 * A short reason to show on submit, for the case where someone pastes a
 * password and never sees the checklist update.
 */
export function passwordError(value: string): string | null {
  const failed = failedRules(value);
  if (failed.length === 0) return null;
  if (failed.length === 1) return `Password needs: ${failed[0].label.toLowerCase()}.`;
  return `Password needs: ${failed.map((f) => f.label.toLowerCase()).join(", ")}.`;
}

/**
 * Live checklist. Rules already met are shown as met rather than hidden, so
 * the list doesn't reflow under the cursor while someone types.
 */
export function PasswordRules({ value }: { value: string }) {
  if (!value) {
    return (
      <ul className="pw-rules">
        {PASSWORD_RULES.map((r) => (
          <li key={r.id} className="pw-rule">
            <span className="pw-rule-mark" aria-hidden="true">○</span>
            {r.label}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="pw-rules">
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(value);
        return (
          <li key={r.id} className={`pw-rule ${ok ? "is-met" : ""}`}>
            <span className="pw-rule-mark" aria-hidden="true">{ok ? "✓" : "○"}</span>
            {r.label}
          </li>
        );
      })}
    </ul>
  );
}
