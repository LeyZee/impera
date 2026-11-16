import { ContentDropFileIdSchema, ContentDropIdSchema, type DropFileUpload } from '@impera/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dropOf } from './fixtures';
import { forgetSends, holds, queueSend, retryNow, sendAgain } from './sends';
import { ServerTrouble, UploadStopped, type UploadDoors } from './upload';

const DROP = ContentDropIdSchema.parse('00000000-0000-4000-8000-00000000e001');
const FILE = ContentDropFileIdSchema.parse('00000000-0000-4000-8000-00000000e002');

const whole: DropFileUpload = { fileId: FILE, sent: true, partBytes: 4, stored: [], missing: [] };

/** Doors whose plan answers from `plans` in turn, and whose pauses wait until « Réessayer » (never by the clock). */
const doorsOf = (plans: (() => Promise<DropFileUpload>)[]): UploadDoors => {
  let call = 0;
  return {
    plan: () => {
      const next = plans[Math.min(call, plans.length - 1)];
      call += 1;
      return next === undefined ? Promise.resolve(whole) : next();
    },
    put: () => Promise.resolve('"e"'),
    complete: () => Promise.resolve(dropOf()),
    pause: () => new Promise<void>(() => undefined),
  };
};

afterEach(() => {
  forgetSends();
});

describe('the sends this phone runs (recette CRE-10)', () => {
  it('tries again at once on « Réessayer » while the server answers with an error', async () => {
    const settled = vi.fn();
    const done = queueSend(
      DROP,
      FILE,
      new Blob(['abcd']),
      settled,
      doorsOf([() => Promise.reject(new ServerTrouble('503')), () => Promise.resolve(whole)]),
    );
    await vi.waitFor(() => {
      expect(holds(FILE)).toBe(true);
    });
    // The pause never ends by itself here: only « Réessayer » lets the send go on.
    await new Promise((resolve) => setTimeout(resolve, 0));
    retryNow(FILE);
    await done;
    expect(settled).toHaveBeenCalledTimes(1);
    expect(holds(FILE)).toBe(false);
  });

  it('forgets the file of a send the server refused for good: sending it again would change nothing', async () => {
    await queueSend(
      DROP,
      FILE,
      new Blob(['abcd']),
      () => undefined,
      doorsOf([() => Promise.reject(new UploadStopped('withdrawn'))]),
    );
    expect(holds(FILE)).toBe(false);
    const settled = vi.fn();
    sendAgain([FILE], settled);
    expect(settled).not.toHaveBeenCalled();
  });
});
