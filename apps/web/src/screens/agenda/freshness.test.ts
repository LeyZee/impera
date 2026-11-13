import { describe, expect, it } from 'vitest';

import { freshnessOf, readAtWords, type ReadState } from './freshness';

/* How fresh her agenda is (CRE-02): a copy is never passed off as the day's truth. Invented instants (ADR 0010). */

const YESTERDAY_21H = Date.parse('2026-11-03T20:00:00.000Z');
const base: ReadState = {
  shown: true,
  online: true,
  isError: false,
  isFetching: false,
  paused: false,
  dataUpdatedAt: 0,
  keptAt: YESTERDAY_21H,
};

describe('how fresh her agenda is (CRE-02)', () => {
  it('says « updating » while her kept copy is read again, and nothing once the server answered', () => {
    expect(freshnessOf({ ...base, isFetching: true })).toEqual({ kind: 'updating' });
    expect(freshnessOf({ ...base, dataUpdatedAt: Date.now() })).toEqual({ kind: 'fresh' });
    // A read again of what the server said in this session is not a copy: nothing to say.
    expect(freshnessOf({ ...base, isFetching: true, dataUpdatedAt: Date.now() })).toEqual({ kind: 'fresh' });
  });

  it('says the server is silent when the read fails with a network, never « offline »', () => {
    expect(freshnessOf({ ...base, isError: true })).toEqual({ kind: 'silent', readAt: YESTERDAY_21H });
  });

  it('says offline only when the browser says so, or the read waits for the network', () => {
    expect(freshnessOf({ ...base, online: false, isError: true })).toEqual({
      kind: 'offline',
      readAt: YESTERDAY_21H,
    });
    expect(freshnessOf({ ...base, paused: true })).toEqual({ kind: 'offline', readAt: YESTERDAY_21H });
  });

  it('says nothing when no agenda is shown: the screen says it does not load', () => {
    expect(freshnessOf({ ...base, shown: false, isError: true })).toEqual({ kind: 'fresh' });
  });

  it('dates her copy against her today, in her zone', () => {
    expect(readAtWords(YESTERDAY_21H, 'Europe/Paris', '2026-11-04')).toMatch(/^hier à 21\sh$/u);
    expect(readAtWords(Date.parse('2026-11-04T07:05:00.000Z'), 'Europe/Paris', '2026-11-04')).toMatch(
      /^aujourd’hui à 8\sh\s05$/u,
    );
    expect(readAtWords(Date.parse('2026-11-01T09:00:00.000Z'), 'Europe/Paris', '2026-11-04')).toMatch(
      /^le dimanche 1er novembre à 10\sh$/u,
    );
  });
});
