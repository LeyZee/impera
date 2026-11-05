import type { ContentDropFileId, ContentDropId } from '@impera/contracts';
import { useSyncExternalStore } from 'react';

import { completeFile, uploadPlan } from './api';
import type { LiveSend } from './model';
import { pause, putPart, sendFile, type UploadDoors } from './upload';

/*
 * The sends this phone runs, one file after the other, each in parts (`upload.ts`). Their progress lives here only:
 * a page reloaded forgets it, and the file shows « Envoi interrompu » with « Reprendre » (the server keeps the parts
 * already stored). While a send runs, the screen is kept on when the phone allows it (ADR 0070 § 5).
 */

const listeners = new Set<() => void>();
let live: ReadonlyMap<ContentDropFileId, LiveSend> = new Map();
let queue: Promise<void> = Promise.resolve();

function set(fileId: ContentDropFileId, send: LiveSend): void {
  const next = new Map(live);
  next.set(fileId, send);
  live = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The progress of every file this phone sends or sent since the page opened. */
export const useLiveSends = (): ReadonlyMap<ContentDropFileId, LiveSend> =>
  useSyncExternalStore(subscribe, () => live);

/** Whether a send is running: the page warns before it is left. */
export const isSending = (): boolean =>
  [...live.values()].some((send) => send.phase !== 'done' && send.phase !== 'failed');

/* ---- The screen kept on ---- */

interface Lock {
  release: () => Promise<void>;
}
interface WakeLockNavigator {
  wakeLock?: { request: (type: 'screen') => Promise<Lock> };
}

let lock: Lock | null = null;

async function keepAwake(on: boolean): Promise<void> {
  const nav: WakeLockNavigator = navigator;
  if (on && lock === null && nav.wakeLock !== undefined) {
    // Refused when the page is hidden or the battery saver is on: the send goes on, the screen may sleep.
    lock = await nav.wakeLock.request('screen').catch(() => null);
  } else if (!on && lock !== null) {
    const held = lock;
    lock = null;
    await held.release().catch(() => undefined);
  }
}

/* ---- One send ---- */

/** Bytes a second, smoothed: a phone's link goes up and down, the time left should not jump with it. */
const SMOOTHING = 0.2;

/** The doors of a real send; a test gives its own. */
const doorsOf = (dropId: ContentDropId, fileId: ContentDropFileId): UploadDoors => ({
  plan: () => uploadPlan(dropId, fileId),
  put: putPart,
  complete: (body) => completeFile(dropId, fileId, body),
  pause,
});

/**
 * Sends `file` as file `fileId` of drop `dropId`, after the sends already queued: one file at a time, so that the
 * first one is whole as soon as possible. Resolves when it is sent or failed; `onSettled` then reads the drop again.
 */
export function queueSend(
  dropId: ContentDropId,
  fileId: ContentDropFileId,
  file: Blob,
  onSettled: () => void,
  doors: UploadDoors = doorsOf(dropId, fileId),
): Promise<void> {
  set(fileId, { sent: 0, total: file.size, rate: null, phase: 'queued' });
  const run = async (): Promise<void> => {
    await keepAwake(true);
    let last = { at: performance.now(), sent: 0 };
    let rate: number | null = null;
    try {
      await sendFile(
        file,
        doors,
        ({ sent, phase }) => {
          const now = performance.now();
          if (phase === 'sending' && now - last.at >= 1000) {
            const sample = ((sent - last.sent) * 1000) / (now - last.at);
            if (sample > 0) rate = rate === null ? sample : rate + SMOOTHING * (sample - rate);
            last = { at: now, sent };
          }
          const before = live.get(fileId)?.sent ?? 0;
          set(fileId, { sent: phase === 'waiting' ? before : sent, total: file.size, rate, phase });
        },
        new AbortController().signal,
      );
      set(fileId, { sent: file.size, total: file.size, rate, phase: 'done' });
    } catch {
      set(fileId, { sent: live.get(fileId)?.sent ?? 0, total: file.size, rate: null, phase: 'failed' });
    } finally {
      if (!isSending()) await keepAwake(false);
      onSettled();
    }
  };
  queue = queue.then(run);
  return queue;
}

/** Tests only: forgets every send. */
export function forgetSends(): void {
  live = new Map();
  queue = Promise.resolve();
  for (const listener of listeners) listener();
}
