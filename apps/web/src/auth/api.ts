import {
  ApiErrorSchema,
  InvitationLinkPreviewSchema,
  InvitationLinkTokenSchema,
  MeSchema,
  PasswordInvalidReasonSchema,
  type ApiError,
  type InvitationLinkPreview,
  type InvitationLinkPurpose,
  type Me,
  type PasswordInvalidReason,
} from '@nirvana/contracts';

/**
 * Invitation links (EQ-10): a member's first access (`/bienvenue#t=…`) or a new password
 * (`/nouveau-mot-de-passe#t=…`). The token lives in the fragment, which no request carries; the page takes it out of
 * the address before any call, and only ever sends it in a POST body.
 */

export const LINK_PAGE_PATHS: Readonly<Record<InvitationLinkPurpose, string>> = {
  invitation: '/bienvenue',
  reset: '/nouveau-mot-de-passe',
};

/** The link page an address opens, or `null` anywhere else. */
export function linkPageOf(pathname: string): InvitationLinkPurpose | null {
  const path = pathname.replace(/\/+$/u, '');
  if (path === LINK_PAGE_PATHS.invitation) return 'invitation';
  if (path === LINK_PAGE_PATHS.reset) return 'reset';
  return null;
}

let taken: { readonly token: string | null } | null = null;

/**
 * The token of the address, read once: the fragment leaves the address at once (history, bookmarks, a screenshot of
 * the bar), and later calls get the same answer, as StrictMode renders twice. `null` when the link is cut or altered.
 */
export function takeToken(
  location: Location = window.location,
  history: History = window.history,
): string | null {
  if (taken !== null) return taken.token;
  const raw = new URLSearchParams(location.hash.replace(/^#/u, '')).get('t');
  const parsed = InvitationLinkTokenSchema.safeParse(raw);
  taken = { token: parsed.success ? parsed.data : null };
  if (location.hash !== '') history.replaceState(history.state, '', location.pathname);
  return taken.token;
}

/** Tests start each case on a fresh address. */
export function forgetTakenToken(): void {
  taken = null;
}

/**
 * A link nobody can use any more looks the same whatever the reason (unknown, used, replaced, expired, a member who
 * left): the page says it does not work, and nothing more.
 */
type Refusal = 'gone' | 'too_many_attempts' | 'unavailable';

export type InspectResult =
  { readonly kind: 'ok'; readonly preview: InvitationLinkPreview } | { readonly kind: Refusal };

export type RedeemResult =
  /** `me` is `null` when the answer cannot be read: the session is open all the same, the app reads it again. */
  | { readonly kind: 'ok'; readonly me: Me | null }
  | { readonly kind: 'password_refused'; readonly reason: PasswordInvalidReason }
  | { readonly kind: Refusal };

async function post(path: string, body: unknown): Promise<Response | null> {
  return fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    // The page's own policy says the same (`<meta name="referrer">`); the call does not depend on it.
    referrerPolicy: 'no-referrer',
    body: JSON.stringify(body),
  }).catch(() => null);
}

async function errorOf(response: Response): Promise<ApiError['error'] | null> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error : null;
}

/** By the error's code, or by its status when a proxy answers in its place. */
function refusalOf(status: number, error: ApiError['error'] | null): Refusal {
  const code = error?.code;
  if (code === 'invitation_link_not_found' || code === 'member_left_conflict') return 'gone';
  if (code === 'rate_limited') return 'too_many_attempts';
  if (code === undefined && status === 404) return 'gone';
  if (code === undefined && status === 429) return 'too_many_attempts';
  return 'unavailable';
}

/** What the page shows before the link is used; reading it does not use it. */
export async function inspectInvitationLink(token: string): Promise<InspectResult> {
  const response = await post('/v1/invitation-links/inspect', { token });
  if (response === null) return { kind: 'unavailable' };
  if (!response.ok) return { kind: refusalOf(response.status, await errorOf(response)) };
  const parsed = InvitationLinkPreviewSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? { kind: 'ok', preview: parsed.data } : { kind: 'unavailable' };
}

/**
 * Uses the link once: the password is set and the member's session opens (its cookie, which the page never sees), in
 * place of any other account signed in on this browser.
 */
export async function redeemInvitationLink(token: string, password: string): Promise<RedeemResult> {
  const response = await post('/v1/invitation-links/redeem', { token, password });
  if (response === null) return { kind: 'unavailable' };
  if (response.ok) {
    // The link is used by now: an unreadable answer is not a reason to ask the member to use it again.
    const me = MeSchema.safeParse(await response.json().catch(() => null));
    return { kind: 'ok', me: me.success ? me.data : null };
  }
  const error = await errorOf(response);
  // A refused password leaves the link unused: the member tries again on the same page.
  if (error?.code === 'password_invalid' || (error === null && response.status === 400)) {
    const reason = PasswordInvalidReasonSchema.safeParse(error?.details['reason']);
    return { kind: 'password_refused', reason: reason.success ? reason.data : 'refused' };
  }
  return { kind: refusalOf(response.status, error) };
}
