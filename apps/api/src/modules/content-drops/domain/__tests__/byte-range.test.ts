import { describe, expect, it } from 'vitest';

import { byteRangeOf } from '../byte-range';

describe('content-drops › the bytes a video player asks (SC-04 lot c4)', () => {
  it('sends the whole medium without a range, or with one it does not serve', () => {
    expect(byteRangeOf(undefined, 1000)).toEqual({ kind: 'whole' });
    expect(byteRangeOf('bytes=0-10,20-30', 1000)).toEqual({ kind: 'whole' });
    expect(byteRangeOf('items=0-10', 1000)).toEqual({ kind: 'whole' });
    expect(byteRangeOf('bytes=-', 1000)).toEqual({ kind: 'whole' });
    expect(byteRangeOf('bytes=30-10', 1000)).toEqual({ kind: 'whole' });
  });

  it('reads an open range, a closed one cut at the end, and a suffix', () => {
    expect(byteRangeOf('bytes=0-', 1000)).toEqual({ kind: 'part', start: 0, end: 999 });
    expect(byteRangeOf('bytes=100-199', 1000)).toEqual({ kind: 'part', start: 100, end: 199 });
    expect(byteRangeOf('bytes=900-5000', 1000)).toEqual({ kind: 'part', start: 900, end: 999 });
    expect(byteRangeOf('bytes=-300', 1000)).toEqual({ kind: 'part', start: 700, end: 999 });
    expect(byteRangeOf('bytes=-5000', 1000)).toEqual({ kind: 'part', start: 0, end: 999 });
  });

  it('says what lies past the end cannot be served', () => {
    expect(byteRangeOf('bytes=1000-', 1000)).toEqual({ kind: 'unsatisfiable' });
    expect(byteRangeOf('bytes=-0', 1000)).toEqual({ kind: 'unsatisfiable' });
    expect(byteRangeOf('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' });
  });
});
