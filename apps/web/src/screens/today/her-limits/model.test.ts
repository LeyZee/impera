import { CreatorIdSchema, type CreatorLimits } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { absenceWords, limitLinesOf } from './model';

const at = '2026-11-20T10:00:00.000Z';
const limits = (over: Partial<CreatorLimits> = {}): CreatorLimits => ({
  creatorId: CreatorIdSchema.parse('00000000-0000-4000-8000-0000000000c1'),
  today: '2026-11-21',
  absences: [],
  stops: [],
  ...over,
});

describe('her absences and what she no longer does, in words', () => {
  it('says an absence ahead, one day, or now', () => {
    expect(absenceWords({ startsOn: '2026-11-24', endsOn: '2026-11-26' }, '2026-11-21')).toMatch(
      /^Absente du mar\. 24 nov\./u,
    );
    expect(absenceWords({ startsOn: '2026-11-24', endsOn: '2026-11-24' }, '2026-11-21')).toMatch(
      /^Absente le mar\. 24 nov\./u,
    );
    expect(absenceWords({ startsOn: '2026-11-20', endsOn: '2026-11-23' }, '2026-11-21')).toMatch(
      /^Absente jusqu’au lun\. 23 nov\./u,
    );
    expect(absenceWords({ startsOn: '2026-11-20', endsOn: '2026-11-21' }, '2026-11-21')).toBe(
      'Absente aujourd’hui',
    );
  });

  it('gives the chatter her next absence, then what she no longer does', () => {
    const lines = limitLinesOf(
      limits({
        absences: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            startsOn: '2026-11-24',
            endsOn: '2026-11-24',
            note: 'Voyage',
            createdAt: at,
          },
        ],
        stops: [
          { id: '00000000-0000-4000-8000-0000000000a1', what: 'les vidéos en extérieur', createdAt: at },
        ],
      }),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/: Voyage$/u);
    expect(lines[1]).toBe('Ne fait plus : les vidéos en extérieur');
    expect(limitLinesOf(undefined)).toEqual([]);
  });
});
