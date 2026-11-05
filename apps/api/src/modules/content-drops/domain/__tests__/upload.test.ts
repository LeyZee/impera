import { DROP_PART_BYTES } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { completionRefusal, partPlan, partsSplit, rawKeyOf } from '../upload';

const MIB = 1024 * 1024;

describe('content-drops › the parts a file goes up in (CR-06 b)', () => {
  it('cuts a file in parts of 8 Mio, the last one the rest; a small file in one', () => {
    expect(partPlan(MIB)).toEqual([{ number: 1, bytes: MIB }]);
    expect(partPlan(DROP_PART_BYTES)).toEqual([{ number: 1, bytes: DROP_PART_BYTES }]);
    expect(partPlan(DROP_PART_BYTES + 1)).toEqual([
      { number: 1, bytes: DROP_PART_BYTES },
      { number: 2, bytes: 1 },
    ]);
    // The heaviest video: 500 Mo in 63 parts.
    const video = partPlan(500 * MIB);
    expect(video).toHaveLength(63);
    expect(video.reduce((sum, part) => sum + part.bytes, 0)).toBe(500 * MIB);
  });

  it('sends again only what the storage does not hold whole', () => {
    const bytes = 2 * DROP_PART_BYTES + 5;
    expect(
      partsSplit(bytes, [
        { number: 1, etag: '"a"', bytes: DROP_PART_BYTES },
        { number: 2, etag: '"b"', bytes: 12 },
        { number: 9, etag: '"z"', bytes: 5 },
      ]),
    ).toEqual({
      missing: [
        { number: 2, bytes: DROP_PART_BYTES },
        { number: 3, bytes: 5 },
      ],
      kept: [{ number: 1, etag: '"a"', bytes: DROP_PART_BYTES }],
    });
  });

  it('finishes a file only with each of its parts, once', () => {
    const bytes = 2 * DROP_PART_BYTES;
    expect(completionRefusal(bytes, [{ number: 2 }, { number: 1 }])).toBeNull();
    for (const parts of [[{ number: 1 }], [{ number: 1 }, { number: 1 }], [{ number: 1 }, { number: 3 }]])
      expect(completionRefusal(bytes, parts)).toBe('Il manque une partie du fichier : relance l’envoi');
  });

  it('keeps the raw bytes under their own prefix, named by her creator and the file only', () => {
    expect(rawKeyOf('c-1', 'f-1')).toBe('incoming/c-1/f-1');
  });
});
