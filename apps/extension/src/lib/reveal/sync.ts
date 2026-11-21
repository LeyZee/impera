import type { PlatformAccountId } from '@impera/contracts';

import type { RevealRead, RevealSynced } from '../watch/protocol';

import type { Synced } from './api';
import {
  NO_PARTS,
  readRequest,
  sessionOf,
  type Captured,
  type RequestHeader,
  type RevealSession,
} from './capture';

/**
 * The owner's « Sync » (P2-01), run by the service worker: listen to the open Reveal tab's requests to `api.reveal.me`
 * for a short while, compose the session, hold it until the owner confirms, send it with the link, and forget it. The
 * session lives in the service worker's memory alone: never in `chrome.storage`, never in a log, never sent back to
 * the popup.
 */

export interface SeenRequest {
  readonly url: string;
  readonly requestHeaders?: readonly RequestHeader[];
}

/** The browser's `webRequest.onBeforeSendHeaders`, for one tab, as the service worker wires it. */
export interface RequestTap {
  readonly listen: (tabId: number, listener: (request: SeenRequest) => void) => void;
  readonly stop: (listener: (request: SeenRequest) => void) => void;
  /** Reloads the tab, so Reveal's page asks again for what it reads at its start. */
  readonly reload: (tabId: number) => void;
}

/** Reveal asks every few seconds; a tab that asked nothing is reloaded once, then the « Sync » gives up. */
const NUDGE_AFTER_MS = 4_000;
const GIVE_UP_AFTER_MS = 30_000;
/** Once a session can be made and the account's model is not seen yet, how long the tab may still name it. */
const SETTLE_MS = 2_500;

/**
 * Listens to the tab until the account's model shows (`expected`), then reads at once. Without it, or while the tab
 * names others, it listens a little longer, so that a tab reading several creators is seen as such (19/11, 409).
 */
export function captureSession(
  tap: RequestTap,
  tabId: number,
  expected: string | null,
  frame: { readonly userAgent: string; readonly now: () => Date },
  timing: { readonly nudgeMs: number; readonly waitMs: number; readonly settleMs: number } = {
    nudgeMs: NUDGE_AFTER_MS,
    waitMs: GIVE_UP_AFTER_MS,
    settleMs: SETTLE_MS,
  },
): Promise<Captured | null> {
  return new Promise((resolve) => {
    let parts = NO_PARTS;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const now = (): Captured | null => sessionOf(parts, expected, frame.userAgent, frame.now());
    const listener = (request: SeenRequest): void => {
      parts = readRequest(parts, request.url, request.requestHeaders);
      const captured = now();
      if (captured === null) return;
      if (expected !== null && captured.state === 'session' && captured.session.modelId === expected) {
        finish(captured);
        return;
      }
      settle ??= setTimeout(() => {
        finish(now());
      }, timing.settleMs);
    };
    const nudge = setTimeout(() => {
      tap.reload(tabId);
    }, timing.nudgeMs);
    const giveUp = setTimeout(() => {
      finish(now());
    }, timing.waitMs);
    function finish(captured: Captured | null): void {
      clearTimeout(nudge);
      clearTimeout(giveUp);
      clearTimeout(settle);
      tap.stop(listener);
      resolve(captured);
    }
    tap.listen(tabId, listener);
  });
}

/** A session read stays held one minute at most, then it is forgotten (demande de Sécurité). */
const HOLD_MS = 60_000;

/**
 * The session read in a Reveal tab, between the reading and the owner's « Envoyer la session ». It lives in the
 * service worker's memory alone, never in `chrome.storage`: dropped when sent, cancelled, after a minute, and when
 * the popup closes. One at a time.
 */
export interface SessionHold {
  readonly keep: (accountId: PlatformAccountId, session: RevealSession) => void;
  /** The session held for this account, once: it is forgotten as it is taken. */
  readonly take: (accountId: PlatformAccountId) => RevealSession | null;
  readonly drop: () => void;
}

export function sessionHold(ttlMs: number = HOLD_MS): SessionHold {
  let held: { readonly accountId: PlatformAccountId; readonly session: RevealSession } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const drop = (): void => {
    clearTimeout(timer);
    held = null;
  };
  return {
    keep: (accountId, session) => {
      drop();
      held = { accountId, session };
      timer = setTimeout(drop, ttlMs);
    },
    take: (accountId) => {
      const session = held?.accountId === accountId ? held.session : null;
      drop();
      return session;
    },
    drop,
  };
}

export interface ReadDeps {
  readonly readLink: () => Promise<string | null>;
  /** Reads the tab, waiting for `expected` when it is known. */
  readonly capture: (expected: string | null) => Promise<Captured | null>;
  /** The account's model: the CRM's `modelId`, else the model of this account's last sync; null before the first. */
  readonly expectedModel: (accountId: PlatformAccountId) => Promise<string | null>;
  /** Another account of the CRM whose model this is (its `modelId`, or its last sync's); null when none (EXT-05). */
  readonly accountOfModel: (modelId: string, except: PlatformAccountId) => Promise<PlatformAccountId | null>;
}

/** Reads the tab's session and holds it; the popup is told the model's id alone, to check it before sending. */
export async function readReveal(
  deps: ReadDeps,
  hold: SessionHold,
  accountId: PlatformAccountId,
): Promise<RevealRead> {
  hold.drop();
  if ((await deps.readLink()) === null) return { state: 'unlinked' };
  const expected = await deps.expectedModel(accountId);
  const captured = await deps.capture(expected);
  if (captured === null) return { state: 'no-session' };
  if (captured.state === 'several') return { state: 'several' };
  const { session } = captured;
  // The tab shows another account's creator: said before anything is held or sent (EXT-05).
  if (expected !== session.modelId) {
    const other = await deps.accountOfModel(session.modelId, accountId);
    if (other !== null) return { state: 'other-account', accountId: other };
  }
  hold.keep(accountId, session);
  return {
    state: 'held',
    modelId: session.modelId,
    seen: expected === null ? 'unknown' : expected === session.modelId ? 'same' : 'other',
  };
}

export interface SendDeps {
  readonly readLink: () => Promise<string | null>;
  readonly markRevoked: () => Promise<void>;
  readonly origin: () => Promise<string>;
  readonly send: (
    origin: string,
    token: string,
    accountId: PlatformAccountId,
    session: RevealSession,
  ) => Promise<Synced>;
  /** Keeps the model of a session the CRM took, to compare the next reading with. */
  readonly remember: (accountId: PlatformAccountId, modelId: string) => Promise<void>;
}

/** Sends the session held for this account, then forgets it whatever the answer. */
export async function sendHeld(
  deps: SendDeps,
  hold: SessionHold,
  accountId: PlatformAccountId,
): Promise<RevealSynced> {
  const session = hold.take(accountId);
  if (session === null) return { state: 'expired' };
  const token = await deps.readLink();
  if (token === null) return { state: 'unlinked' };
  const synced = await deps.send(await deps.origin(), token, accountId, session);
  if (synced.state === 'revoked') await deps.markRevoked();
  if (synced.state !== 'synced') return { state: synced.state };
  await deps.remember(accountId, session.modelId);
  return { state: 'synced', ...synced.stored };
}
