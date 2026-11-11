import type { PlatformAccountId } from '@impera/contracts';

import type { RevealSynced } from '../watch/protocol';

import type { Synced } from './api';
import { NO_PARTS, readRequest, sessionOf, type RequestHeader, type RevealSession } from './capture';

/**
 * The owner's « Sync » (P2-01), run by the service worker: listen to the open Reveal tab's requests to `api.reveal.me`
 * for a short while, compose the session, send it with the link, and forget it. The session lives in this function's
 * scope alone: never in `chrome.storage`, never in a log, never sent back to the popup.
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

export interface SyncDeps {
  readonly readLink: () => Promise<string | null>;
  readonly markRevoked: () => Promise<void>;
  readonly origin: () => Promise<string>;
  readonly capture: () => Promise<RevealSession | null>;
  readonly send: (
    origin: string,
    token: string,
    accountId: PlatformAccountId,
    session: RevealSession,
  ) => Promise<Synced>;
}

export async function syncReveal(deps: SyncDeps, accountId: PlatformAccountId): Promise<RevealSynced> {
  const token = await deps.readLink();
  if (token === null) return { state: 'unlinked' };
  const session = await deps.capture();
  if (session === null) return { state: 'no-session' };
  const synced = await deps.send(await deps.origin(), token, accountId, session);
  if (synced === 'revoked') await deps.markRevoked();
  return { state: synced };
}
