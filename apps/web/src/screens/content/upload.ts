import type { CompleteDropFileBody, ContentDrop, DropFileUpload } from '@impera/contracts';

/*
 * One file's send, straight to the storage (ADR 0055 § 3, ADR 0070 § 3): its parts four at a time, each tried again
 * after a cut, and when the network stays down the plan is asked again, so that the parts already stored are kept and
 * the addresses that expired are signed anew. A file of 10 Go survives the metro: it starts again where it stopped.
 */

/** Parts in flight at once: enough to fill a phone's link, few enough not to choke it. */
export const PARALLEL_PARTS = 4;
/** Tries of one part before its round gives up and the plan is asked again. */
const PART_TRIES = 3;
/** Rounds (a plan, then its parts) before the send stops and says « Envoi interrompu ». */
const MAX_ROUNDS = 12;
const MAX_PAUSE_MS = 60_000;

/** The send cannot go on whatever the network does: the drop was withdrawn, or the file refused or settled. */
export class UploadStopped extends Error {}

/** What a send needs from the outside: the API, the storage and the clock. Tests give their own. */
export interface UploadDoors {
  /** `POST …/upload`: the parts stored and those still missing. Throws `UploadStopped` on a 4xx. */
  readonly plan: () => Promise<DropFileUpload>;
  /** A part's `PUT` to its signed address; its `ETag`. Reports the bytes sent so far for this part. */
  readonly put: (
    url: string,
    body: Blob,
    onSent: (bytes: number) => void,
    signal: AbortSignal,
  ) => Promise<string>;
  /** `POST …/complete`. Throws `UploadStopped` on a 4xx. */
  readonly complete: (body: CompleteDropFileBody) => Promise<ContentDrop>;
  readonly pause: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Where a send is: bytes of the file stored or on their way, and whether it is waiting for the network. */
export interface SendProgress {
  readonly sent: number;
  readonly phase: 'sending' | 'waiting';
}

/** 1 s, 2 s, 4 s … at most a minute. */
export const pauseOf = (attempt: number): number => Math.min(MAX_PAUSE_MS, 1000 * 2 ** attempt);

/** The bytes of part `number` (from 1) of a file of `bytes`, in parts of `partBytes`. */
const partSize = (number: number, partBytes: number, bytes: number): number =>
  Math.max(0, Math.min(partBytes, bytes - (number - 1) * partBytes));

/**
 * Sends `file` and completes it: the drop as it is then, or `null` when the server says the file is already whole.
 * Throws `UploadStopped` when the server refuses it, and the last error after `MAX_ROUNDS` rounds without the network.
 */
export async function sendFile(
  file: Blob,
  doors: UploadDoors,
  onProgress: (progress: SendProgress) => void,
  signal: AbortSignal,
): Promise<ContentDrop | null> {
  let lastError: unknown = null;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (round > 0) {
      onProgress({ sent: 0, phase: 'waiting' });
      await doors.pause(pauseOf(round - 1), signal);
    }
    signal.throwIfAborted();
    let plan: DropFileUpload;
    try {
      plan = await doors.plan();
    } catch (error) {
      if (error instanceof UploadStopped || signal.aborted) throw error;
      lastError = error;
      continue;
    }
    if (plan.sent) return null;

    const etags = new Map(plan.stored.map((part) => [part.number, part.etag]));
    const storedBytes = plan.stored.reduce(
      (sum, part) => sum + partSize(part.number, plan.partBytes, file.size),
      0,
    );
    const inFlight = new Map<number, number>();
    let doneBytes = storedBytes;
    const report = (): void => {
      let flying = 0;
      for (const bytes of inFlight.values()) flying += bytes;
      onProgress({ sent: doneBytes + flying, phase: 'sending' });
    };
    report();

    const queue = [...plan.missing];
    let failed: unknown = null;
    const worker = async (): Promise<void> => {
      for (let part = queue.shift(); part !== undefined && failed === null; part = queue.shift()) {
        const start = (part.number - 1) * plan.partBytes;
        const body = file.slice(start, start + part.bytes);
        for (let attempt = 0; ; attempt += 1) {
          try {
            const { number } = part;
            const etag = await doors.put(
              part.url,
              body,
              (bytes) => {
                inFlight.set(number, bytes);
                report();
              },
              signal,
            );
            inFlight.delete(number);
            etags.set(number, etag);
            doneBytes += part.bytes;
            report();
            break;
          } catch (error) {
            inFlight.delete(part.number);
            if (signal.aborted) throw error;
            if (attempt + 1 >= PART_TRIES) {
              failed = error;
              return;
            }
            await doors.pause(pauseOf(attempt), signal);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, queue.length) }, worker));
    if (failed !== null) {
      lastError = failed;
      continue;
    }

    const parts = [...etags].map(([number, etag]) => ({ number, etag })).sort((a, b) => a.number - b.number);
    try {
      return await doors.complete({ parts });
    } catch (error) {
      if (error instanceof UploadStopped || signal.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('upload: the network never came back');
}

/** A pause that ends early, with an abort, when the send is stopped. */
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
      },
      { once: true },
    );
  });
}

/** A part's `PUT` with its progress (`fetch` has none for uploads): the `ETag` the storage answers, or an error. */
export function putPart(
  url: string,
  body: Blob,
  onSent: (bytes: number) => void,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.upload.onprogress = (event) => {
      onSent(event.loaded);
    };
    request.onload = () => {
      const etag = request.getResponseHeader('etag');
      if (request.status >= 200 && request.status < 300 && etag !== null) resolve(etag);
      else reject(new Error(`PUT part: ${String(request.status)}`));
    };
    request.onerror = () => {
      reject(new Error('PUT part: network'));
    };
    request.ontimeout = () => {
      reject(new Error('PUT part: timeout'));
    };
    // 8 Mo should go in well under five minutes, even on a poor link; beyond, the part is tried again.
    request.timeout = 5 * 60_000;
    signal.addEventListener(
      'abort',
      () => {
        request.abort();
      },
      { once: true },
    );
    request.send(body);
  });
}
