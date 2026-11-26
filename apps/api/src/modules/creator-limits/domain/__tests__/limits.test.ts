import { CreatorIdSchema, NewAbsenceBodySchema, NewStopBodySchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { absenceOn, canTellAbsence, limitsOf } from '../limits';
import { readsLimits } from '../reader';

const CREATOR = CreatorIdSchema.parse('00000000-0000-4000-8000-0000000000c1');
const OTHER = CreatorIdSchema.parse('00000000-0000-4000-8000-0000000000c2');
const at = '2026-11-20T10:00:00.000Z';
const absence = (id: string, startsOn: string, endsOn: string, cancelled = false) => ({
  id: `00000000-0000-4000-8000-00000000000${id}`,
  startsOn,
  endsOn,
  note: null,
  createdAt: at,
  cancelled,
});

describe('her absences and what she no longer does (Charles, 21/11)', () => {
  it('lists the absences not over, the nearest first, never one taken back', () => {
    const limits = limitsOf(
      CREATOR,
      '2026-11-21',
      [
        absence('1', '2026-12-01', '2026-12-03'),
        absence('2', '2026-11-20', '2026-11-22'),
        absence('3', '2026-11-10', '2026-11-12'),
        absence('4', '2026-11-25', '2026-11-26', true),
      ],
      [
        {
          id: '00000000-0000-4000-8000-0000000000a1',
          what: 'Plus de vidéos en public',
          createdAt: at,
          withdrawn: false,
        },
        { id: '00000000-0000-4000-8000-0000000000a2', what: 'Plus de pieds', createdAt: at, withdrawn: true },
      ],
    );
    expect(limits.absences.map((a) => a.startsOn)).toEqual(['2026-11-20', '2026-12-01']);
    expect(limits.absences[0]).not.toHaveProperty('cancelled');
    expect(limits.stops.map((s) => s.what)).toEqual(['Plus de vidéos en public']);
  });

  it('takes an absence told ahead or on the day, never one begun before', () => {
    expect(canTellAbsence({ startsOn: '2026-11-21' }, '2026-11-21')).toBe(true);
    expect(canTellAbsence({ startsOn: '2026-11-20' }, '2026-11-21')).toBe(false);
  });

  it('refuses a return before the leave, and more than sixty days', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(NewAbsenceBodySchema.safeParse({ id, startsOn: '2026-11-22', endsOn: '2026-11-21' }).success).toBe(
      false,
    );
    expect(NewAbsenceBodySchema.safeParse({ id, startsOn: '2026-11-22', endsOn: '2027-01-20' }).success).toBe(
      true,
    );
    expect(NewAbsenceBodySchema.safeParse({ id, startsOn: '2026-11-22', endsOn: '2027-01-21' }).success).toBe(
      false,
    );
  });

  it('keeps her words on one line, never empty', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(NewStopBodySchema.parse({ id, what: '  plus de\n vidéos  ' }).what).toBe('plus de vidéos');
    expect(NewStopBodySchema.safeParse({ id, what: '   ' }).success).toBe(false);
  });

  it('opens them to the owner, her list, and a chatter on shift for her', () => {
    const none = { creatorIds: [], shiftCreatorIds: [] };
    expect(readsLimits({ role: 'owner', ...none }, CREATOR)).toBe(true);
    expect(readsLimits({ role: 'operator', creatorIds: [CREATOR], shiftCreatorIds: [] }, CREATOR)).toBe(true);
    expect(readsLimits({ role: 'operator', creatorIds: [], shiftCreatorIds: [CREATOR] }, CREATOR)).toBe(true);
    expect(readsLimits({ role: 'operator', creatorIds: [OTHER], shiftCreatorIds: [] }, CREATOR)).toBe(false);
  });
});

describe('absenceOn: she is away, and until when (Charles, 26/11)', () => {
  const away = (startsOn: string, endsOn: string) => ({
    id: '00000000-0000-4000-8000-00000000000a',
    startsOn,
    endsOn,
    note: null,
    createdAt: '2026-11-20T10:00:00.000Z',
  });
  it('is null when no absence covers today, even one starting tomorrow', () => {
    expect(absenceOn({ today: '2026-11-26', absences: [] })).toBeNull();
    expect(absenceOn({ today: '2026-11-26', absences: [away('2026-11-27', '2026-11-29')] })).toBeNull();
  });
  it('gives her last day away, on the first and on the last day', () => {
    const one = [away('2026-11-26', '2026-11-28')];
    expect(absenceOn({ today: '2026-11-26', absences: one })).toEqual({ until: '2026-11-28' });
    expect(absenceOn({ today: '2026-11-28', absences: one })).toEqual({ until: '2026-11-28' });
  });
  it('carries through the absences that follow without a day between, never past a gap', () => {
    const chained = [
      away('2026-12-03', '2026-12-05'),
      away('2026-11-25', '2026-11-28'),
      away('2026-11-29', '2026-11-30'),
    ];
    expect(absenceOn({ today: '2026-11-26', absences: chained })).toEqual({ until: '2026-11-30' });
  });
});
