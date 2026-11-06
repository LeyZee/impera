import {
  ApiErrorSchema,
  InvitationLinkPreviewSchema,
  InvitationLinkTokenSchema,
  MeSchema,
  PASSWORD_RESET_PAGE,
  PASSWORD_RESET_REQUESTED_MESSAGE,
  PasswordInvalidReasonSchema,
  PasswordResetPreviewSchema,
  PasswordResetRequestedSchema,
  type ApiError,
  type InvitationLinkPreview,
  type InvitationLinkPurpose,
  type Me,
  type PasswordInvalidReason,
  type PasswordResetPreview,
} from '@impera/contracts';

/**
 * Invitation links (EQ-10): a member's first access (`/bienvenue#t=…`) or a new password
 * (`/nouveau-mot-de-passe#t=…`). The token lives in the fragment, which no request carries; the page takes it out of
 * the address before any call, and only ever sends it in a POST body.
 */

export const LINK_PAGE_PATHS: Readonly<Record<InvitationLinkPurpose, string>> = {
  invitation: '/bienvenue',
  reset: '/nouveau-mot-de-passe',
};

/** The pages open without a session: the two invitation links, and « mot de passe oublié » (SEC-05 lot 3). */
export type LinkPageKind = InvitationLinkPurpose | 'forgotten';

/** The link page an address opens, or `null` anywhere else. */
export function linkPageOf(pathname: string): LinkPageKind | null {
  const path = pathname.replace(/\/+$/u, '');
  if (path === LINK_PAGE_PATHS.invitation) return 'invitation';
  if (path === LINK_PAGE_PATHS.reset) return 'reset';
  if (path === PASSWORD_RESET_PAGE) return 'forgotten';
  return null;
}

/** `present`: the address carried a link, readable or not; a cut link is not the same page as no link at all. */
let taken: { readonly token: string | null; readonly present: boolean } | null = null;

/**
 * The token of the address, read once: the fragment leaves the address at once (history, bookmarks, a screenshot of
 * the bar), and later calls get the same answer, as StrictMode renders twice. `null` when the link is cut or altered.
 */
export function takeToken(
  location: Location = window.location,
  history: History = window.history,
): string | null {
  return takeLink(location, history).token;
}

/** The same reading, and whether the address carried a link at all. */
export function takeLink(
  location: Location = window.location,
  history: History = window.history,
): { readonly token: string | null; readonly present: boolean } {
  if (taken !== null) return taken;
  const raw = new URLSearchParams(location.hash.replace(/^#/u, '')).get('t');
  const parsed = InvitationLinkTokenSchema.safeParse(raw);
  taken = { token: parsed.success ? parsed.data : null, present: raw !== null };
  if (location.hash !== '') history.replaceState(history.state, '', location.pathname);
  return taken;
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
  /** The server is up, the breach check it relies on is not (503 with `reason: 'password_check'`). */
  | { readonly kind: 'password_check_unavailable' }
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
  if (
    code === 'invitation_link_not_found' ||
    code === 'member_left_conflict' ||
    code === 'password_reset_link_not_found'
  ) {
    return 'gone';
  }
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
  return refusedOf(response.status, await errorOf(response));
}

/** Why a link refused its password, or the link itself (same rules on both link pages). */
function refusedOf(
  status: number,
  error: ApiError['error'] | null,
):
  | { readonly kind: 'password_refused'; readonly reason: PasswordInvalidReason }
  | { readonly kind: 'password_check_unavailable' }
  | { readonly kind: Refusal } {
  // A refused password leaves the link unused: the member tries again on the same page.
  if (error?.code === 'password_invalid' || (error === null && status === 400)) {
    const reason = PasswordInvalidReasonSchema.safeParse(error?.details['reason']);
    return { kind: 'password_refused', reason: reason.success ? reason.data : 'refused' };
  }
  if (error?.code === 'service_unavailable' && error.details['reason'] === 'password_check') {
    return { kind: 'password_check_unavailable' };
  }
  return { kind: refusalOf(status, error) };
}

/* « Mot de passe oublié » (SEC-05 lot 3, ADR 0068): the link goes to the account's private Telegram chat. */

export type ResetRequestResult =
  | { readonly kind: 'requested'; readonly message: string }
  | { readonly kind: 'too_many_attempts' | 'unavailable' };

/**
 * Asks a link for this address. The answer is the same whoever asks (known account or not, linked chat or not): the
 * page shows its sentence as it is, and checks nothing of the address itself.
 */
export async function requestPasswordReset(email: string): Promise<ResetRequestResult> {
  const response = await post('/v1/auth/password-reset', { email });
  if (response === null) return { kind: 'unavailable' };
  if (response.ok) {
    const parsed = PasswordResetRequestedSchema.safeParse(await response.json().catch(() => null));
    return {
      kind: 'requested',
      message: parsed.success ? parsed.data.message : PASSWORD_RESET_REQUESTED_MESSAGE,
    };
  }
  const refusal = refusalOf(response.status, await errorOf(response));
  return { kind: refusal === 'too_many_attempts' ? 'too_many_attempts' : 'unavailable' };
}

export type ResetInspectResult =
  { readonly kind: 'ok'; readonly preview: PasswordResetPreview } | { readonly kind: Refusal };

/** Whose the link is and until when; reading it does not use it. */
export async function inspectPasswordReset(token: string): Promise<ResetInspectResult> {
  const response = await post('/v1/auth/password-reset/inspect', { token });
  if (response === null) return { kind: 'unavailable' };
  if (!response.ok) return { kind: refusalOf(response.status, await errorOf(response)) };
  const parsed = PasswordResetPreviewSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? { kind: 'ok', preview: parsed.data } : { kind: 'unavailable' };
}

export type ResetRedeemResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'password_refused'; readonly reason: PasswordInvalidReason }
  | { readonly kind: 'password_check_unavailable' }
  | { readonly kind: Refusal };

/**
 * Uses the link once: the password is set and every session of the account ends, this browser's too. No session
 * opens: the account signs in again, its code still asked.
 */
export async function redeemPasswordReset(token: string, password: string): Promise<ResetRedeemResult> {
  const response = await post('/v1/auth/password-reset/redeem', { token, password });
  if (response === null) return { kind: 'unavailable' };
  if (response.ok) return { kind: 'ok' };
  return refusedOf(response.status, await errorOf(response));
}
