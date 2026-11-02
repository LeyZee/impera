import { ApiErrorSchema, PasskeySchema, PasskeysSchema, type Passkey } from '@nirvana/contracts';
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  WebAuthnError,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { z } from 'zod';

/**
 * Clés d'accès (ADR 0053): Face ID, a fingerprint or the phone's code in place of the password and the code. The
 * browser makes the gesture (`@simplewebauthn/browser`), the server checks it; a cancelled Face ID never reaches the
 * server. Every call goes through `/v1` with the session cookie.
 */

const JSON_HEADERS = { 'content-type': 'application/json' };

async function call(path: string, init: RequestInit = {}): Promise<Response | null> {
  return fetch(`/v1${path}`, { credentials: 'include', ...init }).catch(() => null);
}

async function errorCodeOf(response: Response): Promise<string | null> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.code : null;
}

const postGesture = (path: string, response: unknown): Promise<Response | null> =>
  call(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ response }) });

const DescriptorSchema = z.object({ id: z.string().min(1), type: z.literal('public-key') });
const RequestOptionsSchema = z.object({
  challenge: z.string().min(1),
  allowCredentials: z.array(DescriptorSchema).optional(),
});
const CreationOptionsSchema = z.object({
  challenge: z.string().min(1),
  rp: z.object({ name: z.string() }),
  user: z.object({ id: z.string().min(1), name: z.string(), displayName: z.string() }),
  pubKeyCredParams: z.array(z.object({ alg: z.number(), type: z.literal('public-key') })).min(1),
});

/** The server's options for a gesture, checked for the shape the browser needs; the rest passes through untouched. */
function isRequestOptions(value: unknown): value is PublicKeyCredentialRequestOptionsJSON {
  return RequestOptionsSchema.safeParse(value).success;
}
function isCreationOptions(value: unknown): value is PublicKeyCredentialCreationOptionsJSON {
  return CreationOptionsSchema.safeParse(value).success;
}

async function requestOptionsOf(response: Response): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const body: unknown = await response.json().catch(() => null);
  return isRequestOptions(body) ? body : null;
}

/** Whether this browser can make a gesture at all (no WebAuthn: the password and the code only). */
export function canUsePasskeys(): boolean {
  return browserSupportsWebAuthn();
}

/** Whether this device itself holds keys (Face ID, Touch ID, a fingerprint, Windows Hello): the offer is made only then. */
export async function deviceHoldsPasskeys(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) return false;
  return platformAuthenticatorIsAvailable().catch(() => false);
}

/**
 * The gesture as the person knows it on this device: « Face ID » on an iPhone or an iPad, « Touch ID » on a Mac, « ton
 * empreinte » on Android, « Windows Hello » on Windows, « une clé d’accès » elsewhere.
 */
export function gestureName(userAgent: string = navigator.userAgent): string {
  if (/iPhone|iPad|iPod/u.test(userAgent)) return 'Face ID';
  if (userAgent.includes('Android')) return 'ton empreinte';
  if (userAgent.includes('Macintosh')) return 'Touch ID';
  if (userAgent.includes('Windows')) return 'Windows Hello';
  return 'une clé d’accès';
}

export type PasskeySignInResult =
  | 'ok'
  /** The person closed Face ID, or the device has no key for Nirvana: nothing reached the server. */
  | 'cancelled'
  /** The server refused the gesture: unknown key, removed key, wrong signature. */
  | 'refused'
  | 'too_many_attempts'
  | 'unavailable';

/** Sign-in by one gesture (ADR 0053 § 1): no e-mail, the key says whose it is. */
export async function signInWithPasskey(): Promise<PasskeySignInResult> {
  const asked = await call('/auth/passkey/generate-authenticate-options');
  if (asked === null) return 'unavailable';
  if (asked.status === 429) return 'too_many_attempts';
  const options = asked.ok ? await requestOptionsOf(asked) : null;
  if (options === null) return 'unavailable';
  const gesture = await startAuthentication({ optionsJSON: options }).catch(() => null);
  if (gesture === null) return 'cancelled';
  const answer = await postGesture('/auth/passkey/verify-authentication', gesture);
  if (answer === null) return 'unavailable';
  if (answer.ok) return 'ok';
  if (answer.status === 401) return 'refused';
  if (answer.status === 429) return 'too_many_attempts';
  return 'unavailable';
}

export type PasskeyConfirmResult =
  | 'ok'
  | 'cancelled'
  | 'refused'
  /** The account holds no key: the password and the code only. */
  | 'no_passkey'
  | 'too_many_attempts'
  | 'session_expired'
  | 'unavailable';

/**
 * A fresh gesture before a sensitive action (ADR 0053 § 4): a challenge issued for this session and this confirmation,
 * used once. Confirmed, the action can be retried for 10 minutes, as after the password and the code. `excluding` is the
 * key being removed, which may not confirm its own removal (§ 5): the browser is not even offered it.
 */
export async function confirmWithPasskey(excluding?: string): Promise<PasskeyConfirmResult> {
  const asked = await call('/auth/passkey/confirm-options', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(excluding === undefined ? {} : { excluding }),
  });
  if (asked === null) return 'unavailable';
  if (asked.status === 404) return 'no_passkey';
  if (asked.status === 401) return 'session_expired';
  if (asked.status === 429) return 'too_many_attempts';
  const options = asked.ok ? await requestOptionsOf(asked) : null;
  if (options === null) return 'unavailable';
  const gesture = await startAuthentication({ optionsJSON: options }).catch(() => null);
  if (gesture === null) return 'cancelled';
  const answer = await postGesture('/auth/passkey/confirm', gesture);
  if (answer === null) return 'unavailable';
  if (answer.ok) return 'ok';
  if (answer.status === 429) return 'too_many_attempts';
  if (answer.status === 401) {
    const code = await errorCodeOf(answer);
    // An expired challenge is a gesture to make again, not a refusal.
    if (code === 'passkey_unauthenticated' || code === 'passkey_challenge_unauthenticated') return 'refused';
    return 'session_expired';
  }
  return 'unavailable';
}

export type AddPasskeyResult =
  | { readonly kind: 'ok'; readonly passkey: Passkey }
  /** The password and the code were not given in the last 5 minutes on this session: ask for them, then add. */
  | { readonly kind: 'reauth_required' }
  /** This device already holds a key of this account. */
  | { readonly kind: 'already' }
  | { readonly kind: 'cancelled' | 'refused' | 'session_expired' | 'unavailable' };

async function addRefusalOf(response: Response): Promise<AddPasskeyResult> {
  const code = await errorCodeOf(response);
  if (response.status === 403) return { kind: 'reauth_required' };
  if (code === 'passkey_conflict') return { kind: 'already' };
  if (code === 'passkey_unauthenticated' || code === 'passkey_challenge_unauthenticated')
    return { kind: 'refused' };
  if (response.status === 401) return { kind: 'session_expired' };
  return { kind: 'unavailable' };
}

/** Adds a key of this device to the signed-in account (ADR 0053 § 2), named by the server after the device. */
export async function addPasskey(): Promise<AddPasskeyResult> {
  const asked = await call('/auth/passkey/generate-register-options');
  if (asked === null) return { kind: 'unavailable' };
  if (!asked.ok) return addRefusalOf(asked);
  const body: unknown = await asked.json().catch(() => null);
  if (!isCreationOptions(body)) return { kind: 'unavailable' };
  let gesture: Awaited<ReturnType<typeof startRegistration>>;
  try {
    gesture = await startRegistration({ optionsJSON: body });
  } catch (failure) {
    if (failure instanceof WebAuthnError && failure.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
      return { kind: 'already' };
    }
    return { kind: 'cancelled' };
  }
  const answer = await postGesture('/auth/passkey/verify-registration', gesture);
  if (answer === null) return { kind: 'unavailable' };
  if (!answer.ok) return addRefusalOf(answer);
  const added = PasskeySchema.safeParse(await answer.json().catch(() => null));
  return added.success ? { kind: 'ok', passkey: added.data } : { kind: 'unavailable' };
}

/** The signed-in person's keys; `null` when the server cannot tell (the screen then offers the password only). */
export async function fetchPasskeys(): Promise<readonly Passkey[] | null> {
  const response = await call('/auth/passkeys');
  if (!response?.ok) return null;
  const parsed = PasskeysSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.passkeys : null;
}

const OFFERED_KEY = 'nv-passkey-offered';

/** Whether « Te connecter avec Face ID la prochaine fois ? » was already asked on this device (ADR 0053 § 2: once). */
export function passkeyOffered(): boolean {
  try {
    return localStorage.getItem(OFFERED_KEY) !== null;
  } catch {
    // Storage refused (private window): never asking again beats asking at every sign-in.
    return true;
  }
}

export function rememberPasskeyOffered(): void {
  try {
    localStorage.setItem(OFFERED_KEY, '1');
  } catch {
    // Nothing to remember it in: `passkeyOffered` already answers true there.
  }
}
