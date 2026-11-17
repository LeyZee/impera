import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createLineSigner } from '../line-signer';

const key = (version: string) => ({ version, key: randomBytes(32) });

describe('createLineSigner: keyed marks of the note lines (ADR 0117 § 3, relecture #775)', () => {
  it('marks a line with the newest key, and knows its own mark again, spaces aside', () => {
    const signer = createLineSigner([key('v2'), key('v1')], 'account-a');
    const mark = signer.sign('Âge : 25');
    expect(mark).toMatch(/^v2:[0-9a-f]{64}$/u);
    expect(signer.signs('  Âge :   25 ', mark)).toBe(true);
    expect(signer.signs('Âge : 26', mark)).toBe(false);
  });

  it('is not a plain hash: another account, or another key, never reads the same mark', () => {
    const keys = [key('v1')];
    const mark = createLineSigner(keys, 'account-a').sign('Âge : 25');
    expect(createLineSigner(keys, 'account-b').signs('Âge : 25', mark)).toBe(false);
    expect(createLineSigner([key('v1')], 'account-a').signs('Âge : 25', mark)).toBe(false);
  });

  it('reads a mark of an older key still kept, never one of a key dropped or a malformed one', () => {
    const old = key('v1');
    const mark = createLineSigner([old], 'account-a').sign('Métier : boulanger');
    expect(createLineSigner([key('v2'), old], 'account-a').signs('Métier : boulanger', mark)).toBe(true);
    expect(createLineSigner([key('v2')], 'account-a').signs('Métier : boulanger', mark)).toBe(false);
    expect(createLineSigner([old], 'account-a').signs('Métier : boulanger', 'nope')).toBe(false);
  });
});
