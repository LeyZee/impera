import { MeSchema, type Me } from '@impera/contracts';

/*
 * The creator's last known session on this device (CREA-04): her role, her name and her creators, never a secret
 * (the cookie stays `HttpOnly`). Read only when the phone has no network, so that her app opens on her agenda kept
 * offline (ADR 0042 § 8); forgotten with the rest of the device at sign-out and on any 401 (`forgetDevice`).
 */

/** The prefix `forgetDevice` drops. */
export const SESSION_STORAGE_PREFIX = 'impera.session.';
const KEY = `${SESSION_STORAGE_PREFIX}me`;

/** Kept for a creator, the one whose app works offline; anyone else keeps nothing. */
export function keepSession(me: Me): void {
  try {
    if (me.role === 'creator') localStorage.setItem(KEY, JSON.stringify(me));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: her app needs the network to open, as before.
  }
}

export function keptSession(): Me | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed = MeSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.role === 'creator' ? parsed.data : null;
  } catch {
    return null;
  }
}
