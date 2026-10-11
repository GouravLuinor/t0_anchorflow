/**
 * Governs when we OFFER (never hard-lock) sign-in. The philosophy: core
 * workflow work — parsing, classification, the permission and injection
 * audits, the pinned rewrite, the diff and every copyable surface — stays
 * 100% free forever with no account. Sign-in only powers high-leverage
 * convenience: cross-device history sync and saved audit snapshots. This
 * module is pure policy with no UI or side effects beyond the session
 * counter below.
 */
export const SESSION_COUNT_KEY = "af_session_count";
export type AuthTrigger = "export" | "return-visit" | "manual";

export interface ShouldPromptArgs {
  isAuthenticated: boolean;
  trigger: AuthTrigger;
  sessionCount: number;
}

export function shouldPromptSignIn({
  isAuthenticated,
  trigger,
  sessionCount,
}: ShouldPromptArgs): boolean {
  if (isAuthenticated) return false;
  if (trigger === "manual" || trigger === "export") return true;
  // Return-visit prompt only from the 2nd visit onward.
  return sessionCount >= 2;
}

/**
 * Increments and persists the local visit counter used by the return-visit
 * trigger. Storage may be unavailable (private mode, quota, SSR) — the count
 * is still computed and returned so callers never crash on a degraded store.
 */
export function bumpSessionCount(): number {
  let current = 0;
  try {
    const raw = window.localStorage.getItem(SESSION_COUNT_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (Number.isFinite(parsed) && parsed > 0) current = parsed;
  } catch {
    current = 0;
  }
  const next = current + 1;
  try {
    window.localStorage.setItem(SESSION_COUNT_KEY, String(next));
  } catch {
    // Storage unavailable — the in-memory count above is still authoritative.
  }
  return next;
}
