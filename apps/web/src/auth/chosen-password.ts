/**
 * The password a member has just chosen on a link page, kept in this page's memory only (never storage), for the
 * activation of the code that follows at once: one password gesture for a first access, not two (recette SEC-15).
 * It lapses after two minutes and is forgotten as soon as it served, or when the person leaves.
 */
const HOLD_MS = 2 * 60_000;

let held: { readonly password: string; readonly until: number } | null = null;
let lapse: ReturnType<typeof setTimeout> | undefined;

export function holdChosenPassword(password: string, now: number = Date.now()): void {
  held = { password, until: now + HOLD_MS };
  // Forgotten on time even if no page ever reads it (the code page never shown, relecture #538).
  clearTimeout(lapse);
  lapse = setTimeout(forgetChosenPassword, HOLD_MS);
}

/** The password just chosen, if it is still fresh; reading it does not forget it. */
export function chosenPassword(now: number = Date.now()): string | null {
  if (held === null) return null;
  if (now > held.until) {
    held = null;
    return null;
  }
  return held.password;
}

export function forgetChosenPassword(): void {
  held = null;
  clearTimeout(lapse);
  lapse = undefined;
}
