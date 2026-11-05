import { describe, expect, it } from 'vitest';

import { createScratchRoom } from '../room';

describe('content-drops › the room on the worker’s disk (ADR 0070 § 4)', () => {
  it('never lets two jobs take the same free bytes, and gives them back once', async () => {
    const room = createScratchRoom('/scratch', () => Promise.resolve(100));
    const [first, second] = await Promise.all([room.take(60), room.take(60)]);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await room.take(40)).not.toBeNull();
    first?.();
    first?.();
    expect(await room.take(60)).not.toBeNull();
    expect(await room.take(1)).toBeNull();
  });

  it('reads the real disk by default', async () => {
    const room = createScratchRoom(process.cwd());
    expect(await room.take(1)).not.toBeNull();
    expect(await room.take(Number.MAX_SAFE_INTEGER)).toBeNull();
  });
});
