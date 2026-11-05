import { ContentDropFileIdSchema, type DropFileUpload } from '@impera/contracts';
import { describe, expect, it, vi } from 'vitest';

import { dropOf } from './fixtures';
import { PARALLEL_PARTS, UploadStopped, sendFile, type UploadDoors } from './upload';

const FILE_ID = ContentDropFileIdSchema.parse('00000000-0000-4000-8000-0000000000ff');
const PART = 4;

/** A plan for a file of `bytes` in parts of 4 bytes, the parts `stored` already in the storage. */
const planOf = (bytes: number, stored: readonly number[] = []): DropFileUpload => {
  const count = Math.ceil(bytes / PART);
  const numbers = Array.from({ length: count }, (_, index) => index + 1);
  return {
    fileId: FILE_ID,
    sent: false,
    partBytes: PART,
    stored: stored.map((number) => ({ number, etag: `"stored-${String(number)}"` })),
    missing: numbers
      .filter((number) => !stored.includes(number))
      .map((number) => ({
        number,
        bytes: Math.min(PART, bytes - (number - 1) * PART),
        url: `https://bucket.test/part/${String(number)}`,
      })),
  };
};

const blob = (bytes: number): Blob => new Blob([new Uint8Array(bytes)]);

function doors(overrides: Partial<UploadDoors> & Pick<UploadDoors, 'plan'>): UploadDoors & {
  complete: ReturnType<typeof vi.fn>;
} {
  const complete = vi.fn(() => Promise.resolve(dropOf()));
  return {
    put: (url, body, onSent) => {
      onSent(body.size);
      return Promise.resolve(`"${url.split('/').at(-1) ?? ''}"`);
    },
    pause: () => Promise.resolve(),
    ...overrides,
    complete,
  };
}

const signal = new AbortController().signal;

describe('One file’s send, in parts (CR-06 d, ADR 0070 § 3)', () => {
  it('sends every part, at most four at a time, and completes with their ETags in order', async () => {
    let flying = 0;
    let most = 0;
    const plan = planOf(30);
    const sent: number[] = [];
    const d = doors({
      plan: () => Promise.resolve(plan),
      put: async (url, body, onSent) => {
        flying += 1;
        most = Math.max(most, flying);
        await new Promise((resolve) => setTimeout(resolve, 1));
        onSent(body.size);
        flying -= 1;
        return `"${url.split('/').at(-1) ?? ''}"`;
      },
    });
    await sendFile(blob(30), d, ({ sent: bytes }) => sent.push(bytes), signal);
    expect(most).toBe(PARALLEL_PARTS);
    expect(d.complete).toHaveBeenCalledWith({
      parts: Array.from({ length: 8 }, (_, index) => ({ number: index + 1, etag: `"${String(index + 1)}"` })),
    });
    expect(sent.at(-1)).toBe(30);
  });

  it('resumes where it stopped: the parts already stored are neither sent again nor forgotten', async () => {
    const put = vi.fn((url: string) => Promise.resolve(`"${url.split('/').at(-1) ?? ''}"`));
    const progress: number[] = [];
    const d = doors({ plan: () => Promise.resolve(planOf(12, [1, 2])), put });
    await sendFile(blob(12), d, ({ sent }) => progress.push(sent), signal);
    expect(put).toHaveBeenCalledTimes(1);
    expect(progress[0]).toBe(8);
    expect(d.complete).toHaveBeenCalledWith({
      parts: [
        { number: 1, etag: '"stored-1"' },
        { number: 2, etag: '"stored-2"' },
        { number: 3, etag: '"3"' },
      ],
    });
  });

  it('after a cut that lasts, asks the plan again and goes on with fresh addresses', async () => {
    let cut = true;
    const plan = vi.fn(() => Promise.resolve(planOf(8)));
    const phases: string[] = [];
    const d = doors({
      plan,
      put: (url) => (cut ? Promise.reject(new Error('network')) : Promise.resolve(`"${url.slice(-1)}"`)),
      pause: () => {
        cut = plan.mock.calls.length < 2;
        return Promise.resolve();
      },
    });
    await sendFile(blob(8), d, ({ phase }) => phases.push(phase), signal);
    expect(plan).toHaveBeenCalledTimes(2);
    expect(phases).toContain('waiting');
    expect(d.complete).toHaveBeenCalledTimes(1);
  });

  it('stops at once when the server refuses the file (withdrawn, settled)', async () => {
    const d = doors({ plan: () => Promise.reject(new UploadStopped('withdrawn')) });
    await expect(sendFile(blob(8), d, () => undefined, signal)).rejects.toBeInstanceOf(UploadStopped);
    expect(d.complete).not.toHaveBeenCalled();
  });

  it('sends nothing when the file is already whole', async () => {
    const d = doors({ plan: () => Promise.resolve({ ...planOf(8), sent: true, missing: [] }) });
    expect(await sendFile(blob(8), d, () => undefined, signal)).toBeNull();
    expect(d.complete).not.toHaveBeenCalled();
  });

  it('gives up after its rounds when the network never comes back', async () => {
    const plan = vi.fn(() => Promise.reject(new Error('offline')));
    await expect(sendFile(blob(8), doors({ plan }), () => undefined, signal)).rejects.toThrow('offline');
    expect(plan).toHaveBeenCalledTimes(12);
  });
});
