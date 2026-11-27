import { isGrantedAtInstall, permissionPatternOf } from './crm-address';
import type { CrmSession } from './session';

/**
 * Linking the extension to a CRM (ADR 0067, amendement du 19/11 § 5): the browser is asked for that site alone, then
 * the CRM must answer `/v1/me` with an open session. Only then is the address saved; else nothing is, and the site is
 * given back if it was not already allowed. A new address forgets what the old one held, and gives back the old site
 * (avis Sécurité du 19/11).
 * The session check does not tell a CRM from a site that imitates one: it only keeps the extension off a CRM where the
 * person is not signed in. What protects is elsewhere: the host shown in full, the first link only, the link code.
 */

/** `down`: nothing answers, or the CRM answers unwell (5xx): the address may be right, the CRM is not up (EXT-04). */
export type LinkFailure = 'denied' | 'signed_out' | 'down' | 'not_crm';

export type Linked =
  { readonly state: 'linked' } | { readonly state: 'failed'; readonly failure: LinkFailure };

interface Pattern {
  readonly origins: string[];
}

export interface LinkDeps {
  readonly contains: (pattern: Pattern) => Promise<boolean>;
  /** Must be called inside the click: the browser's question needs the gesture. */
  readonly request: (pattern: Pattern) => Promise<boolean>;
  readonly remove: (pattern: Pattern) => Promise<unknown>;
  readonly readSession: (origin: string) => Promise<CrmSession>;
  readonly saved: () => Promise<string | null>;
  readonly save: (origin: string) => Promise<void>;
  /** Forgets the link code and what the syncs left, tied to the old address. */
  readonly forget: () => Promise<unknown>;
  /** The address a hosted build was made for: its leave comes with the manifest and is never given back. */
  readonly builtIn: string | null;
}

/** Call it synchronously from the click: it asks the browser before its first `await`. */
export function linkCrm(next: string, deps: LinkDeps): Promise<Linked> {
  const atInstall = isGrantedAtInstall(next);
  const pattern = { origins: [permissionPatternOf(next)] };
  const had = atInstall ? Promise.resolve(true) : deps.contains(pattern).catch(() => false);
  const asked = atInstall ? Promise.resolve(true) : deps.request(pattern).catch(() => false);
  return (async (): Promise<Linked> => {
    const [before, granted] = await Promise.all([had, asked]);
    if (!granted) return { state: 'failed', failure: 'denied' };
    const session = await deps.readSession(next);
    if (session.kind !== 'signed_in') {
      if (!before) await deps.remove(pattern).catch(() => false);
      const signedOut = session.kind === 'signed_out' || session.kind === 'second_factor_required';
      const down = session.kind === 'server_down' || session.kind === 'unreachable';
      return { state: 'failed', failure: signedOut ? 'signed_out' : down ? 'down' : 'not_crm' };
    }
    const saved = await deps.saved();
    if (saved !== null && saved !== next) {
      await deps.forget();
      // The site left behind is given back too, unless the manifest grants it (avis Sécurité du 19/11 sur #870).
      if (!isGrantedAtInstall(saved) && saved !== deps.builtIn) {
        await deps.remove({ origins: [permissionPatternOf(saved)] }).catch(() => false);
      }
    }
    await deps.save(next);
    return { state: 'linked' };
  })();
}
