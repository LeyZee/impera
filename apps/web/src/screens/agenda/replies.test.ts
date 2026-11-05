import type { CreatorAccountShift } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { repliesOn, repliesText, shiftRangeOf } from './replies';

/* Invented shifts (ADR 0010), read in Paris. */
const ZONE = 'Europe/Paris';
const shift = (
  displayName: string,
  startsAt: string,
  endsAt: string,
  platform: CreatorAccountShift['platform'] = 'reveal',
): CreatorAccountShift => ({
  displayName,
  platform,
  startsAt,
  endsAt,
});

describe('« Qui répond à tes fans » (CR-05 c3)', () => {
  it('reads her days from 0 h in her zone, across a change of clock', () => {
    // Sunday 25 October 2026: Paris goes back from UTC+2 to UTC+1.
    expect(shiftRangeOf({ from: '2026-10-19', to: '2026-10-25' }, ZONE)).toEqual({
      from: '2026-10-18T22:00:00.000Z',
      to: '2026-10-25T23:00:00.000Z',
    });
  });

  it('gives a shift past midnight its range on the day it starts, and its end the day after', () => {
    const shifts = [
      shift('Kofi', '2026-11-04T13:00:00.000Z', '2026-11-04T17:00:00.000Z'),
      shift('Awa', '2026-11-04T21:00:00.000Z', '2026-11-05T01:00:00.000Z'),
    ];
    const wednesday = repliesOn(shifts, '2026-11-04', ZONE);
    expect(wednesday.map((line) => [line.label, repliesText(line)])).toEqual([
      ['Reveal', 'Kofi 14 h – 18 h, Awa 22 h – 2 h'],
    ]);
    expect(repliesOn(shifts, '2026-11-05', ZONE).map(repliesText)).toEqual(['Awa jusqu’à 2 h']);
    expect(repliesOn(shifts, '2026-11-06', ZONE)).toEqual([]);
  });

  it('says « toute la journée » for a shift that covers her whole day', () => {
    const shifts = [shift('Yao', '2026-11-03T20:00:00.000Z', '2026-11-05T08:00:00.000Z')];
    expect(repliesOn(shifts, '2026-11-04', ZONE).map(repliesText)).toEqual(['Yao toute la journée']);
  });

  it('makes a line per platform, named from the account', () => {
    const shifts = [
      shift('Kofi', '2026-11-04T13:00:00.000Z', '2026-11-04T17:00:00.000Z'),
      shift('Ama', '2026-11-04T15:00:00.000Z', '2026-11-04T19:00:00.000Z', 'onlyfans'),
    ];
    expect(repliesOn(shifts, '2026-11-04', ZONE).map((line) => line.label)).toEqual(['Reveal', 'OnlyFans']);
  });

  it('leaves out a shift that ends at the very start of her day', () => {
    const shifts = [shift('Kofi', '2026-11-03T19:00:00.000Z', '2026-11-03T23:00:00.000Z')];
    expect(repliesOn(shifts, '2026-11-04', ZONE)).toEqual([]);
  });
});
