import type { PlatformAccountId } from '@impera/contracts';

import type { RevealRead, RevealSynced } from '../watch/protocol';

import type { Synced } from './api';
import { NO_PARTS, readRequest, sessionOf, type RequestHeader, type RevealSession } from './capture';

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

export function captureSession(
  tap: RequestTap,
  tabId: number,
  frame: { readonly userAgent: string; readonly now: () => Date },
  timing: { readonly nudgeMs: number; readonly waitMs: number } = {
    nudgeMs: NUDGE_AFTER_MS,
    waitMs: GIVE_UP_AFTER_MS,
  },
): Promise<RevealSession | null> {
  return new Promise((resolve) => {
    let parts = NO_PARTS;
    const listener = (request: SeenRequest): void => {
      parts = readRequest(parts, request.url, request.requestHeaders);
      const session = sessionOf(parts, frame.userAgent, frame.now());
      if (session !== null) finish(session);
    };
    const nudge = setTimeout(() => {
      tap.reload(tabId);
    }, timing.nudgeMs);
    const giveUp = setTimeout(() => {
      finish(null);
    }, timing.waitMs);
    function finish(session: RevealSession | null): void {
      clearTimeout(nudge);
      clearTimeout(giveUp);
      tap.stop(listener);
      resolve(session);
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
  readonly capture: () => Promise<RevealSession | null>;
  /** The model of this account's last sync, null before the first one. */
  readonly lastModel: (accountId: PlatformAccountId) => Promise<string | null>;
}

/** Reads the tab's session and holds it; the popup is told the model's id alone, to check it before sending. */
export async function readReveal(
  deps: ReadDeps,
  hold: SessionHold,
  accountId: PlatformAccountId,
): Promise<RevealRead> {
  hold.drop();
  if ((await deps.readLink()) === null) return { state: 'unlinked' };
  const session = await deps.capture();
  if (session === null) return { state: 'no-session' };
  hold.keep(accountId, session);
  const last = await deps.lastModel(accountId);
  return {
    state: 'held',
    modelId: session.modelId,
    seen: last === null ? 'unknown' : last === session.modelId ? 'same' : 'other',
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
