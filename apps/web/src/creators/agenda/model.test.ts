import { SuggestionIdSchema, type AgencySuggestion } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { followedOf, groupsOf, proposalSlotOf, suggestionBodyOf, summaryOf } from './model';

/* Invented suggestions of an invented creator. */
const ZONE = 'Europe/Paris';
const base: AgencySuggestion = {
  id: SuggestionIdSchema.parse('0192f3a0-0000-7000-8000-000000000101'),
  week: '2026-11-02',
  when: { kind: 'day', day: '2026-11-04' },
  minutes: null,
  category: 'post',
  title: 'Publication',
  purpose: null,
  essential: false,
  shootBrief: null,
  origin: 'agency',
  state: 'suggested',
  reason: null,
  decidedAt: null,
  createdAt: '2026-11-02T09:00:00.000Z',
  task: null,
};
const accepted = (
  task: AgencySuggestion['task'],
  over: Partial<AgencySuggestion> = {},
): AgencySuggestion => ({
  ...base,
  state: 'accepted',
  decidedAt: '2026-11-02T10:00:00.000Z',
  task,
  ...over,
});

describe('what became of a suggestion', () => {
  it('waits, or says her reason when she declined it', () => {
    expect(followedOf(base, ZONE)).toMatchObject({ standing: 'waiting', label: 'En attente' });
    expect(followedOf({ ...base, state: 'declined', reason: 'Pas ce jour-là' }, ZONE)).toEqual({
      standing: 'declined',
      label: 'Refusée',
      detail: '« Pas ce jour-là »',
    });
    expect(followedOf({ ...base, state: 'declined' }, ZONE).detail).toBe('Sans motif');
  });

  it('is done once ticked, and says where she moved it', () => {
    const same = { kind: 'day' as const, day: '2026-11-04' };
    expect(followedOf(accepted({ when: same, doneDays: 1, removed: false }), ZONE)).toEqual({
      standing: 'done',
      label: 'Faite',
      detail: null,
    });
    expect(followedOf(accepted({ when: same, doneDays: 0, removed: false }), ZONE).detail).toBe(
      'Pas encore cochée',
    );
    const moved = followedOf(
      accepted({ when: { kind: 'day', day: '2026-11-05' }, doneDays: 0, removed: false }),
      ZONE,
    );
    expect(moved.detail).toMatch(/^Déplacée : jeudi 5 novembre/u);
    // Undated, she placed it herself.
    const placed = followedOf(
      accepted({ when: same, doneDays: 0, removed: false }, { when: null, minutes: 60 }),
      ZONE,
    );
    expect(placed.detail).toMatch(/^Placée : /u);
  });

  it('counts her routine against its days, and says when she removed it', () => {
    const routine = { kind: 'routine' as const, weekdays: [1, 3, 5] };
    const partly = followedOf(
      accepted({ when: routine, doneDays: 2, removed: false }, { when: routine }),
      ZONE,
    );
    expect(partly).toMatchObject({ standing: 'accepted', detail: '2 sur 3 cette semaine' });
    expect(
      followedOf(accepted({ when: routine, doneDays: 3, removed: false }, { when: routine }), ZONE).standing,
    ).toBe('done');
    expect(
      followedOf(accepted({ when: routine, doneDays: 1, removed: true }, { when: routine }), ZONE),
    ).toEqual({ standing: 'removed', label: 'Retirée', detail: 'Faite 1 jour, puis retirée de son agenda' });
  });
});

describe('the week at a glance', () => {
  it('groups and counts only what there is', () => {
    const done = accepted({ when: { kind: 'day', day: '2026-11-04' }, doneDays: 1, removed: false });
    const items = [base, done, { ...base, state: 'declined' as const }];
    expect(groupsOf(items)).toEqual({ waiting: [base], accepted: [done], declined: [items[2]] });
    expect(summaryOf(items, ZONE)).toBe('3 proposées · 1 acceptée · 1 faite · 1 refusée');
    expect(summaryOf([base], ZONE)).toBe('1 proposée');
  });
});

describe('the body sent', () => {
  it('reads the hours in her zone and leaves an empty purpose out', () => {
    expect(
      suggestionBodyOf(
        {
          title: ' Live ',
          category: 'live',
          kind: 'timed',
          day: '2026-11-04',
          start: 21 * 60,
          end: 22 * 60,
          weekdays: [3],
          purpose: '  ',
          reminderMinutes: null,
        },
        ZONE,
        base.id,
      ),
    ).toEqual({
      id: base.id,
      when: { kind: 'timed', startsAt: '2026-11-04T20:00:00.000Z', endsAt: '2026-11-04T21:00:00.000Z' },
      category: 'live',
      title: 'Live',
      purpose: null,
    });
  });
});

describe('proposalSlotOf', () => {
  // 05/11/2026 in Paris is UTC+1: 17:40 UTC is 18 h 40 there.
  const at = (utc: string): Date => new Date(`2026-11-05T${utc}:00Z`);

  it('opens on 18 h to 19 h while that hour is still ahead', () => {
    expect(proposalSlotOf('2026-11-05', at('09:00'), ZONE)).toEqual({
      day: '2026-11-05',
      start: 1080,
      end: 1140,
    });
    expect(proposalSlotOf('2026-11-09', at('17:40'), ZONE)).toEqual({
      day: '2026-11-09',
      start: 1080,
      end: 1140,
    });
  });

  it('never opens on an hour already begun (Chantier 7, 05/11)', () => {
    expect(proposalSlotOf('2026-11-05', at('17:40'), ZONE)).toEqual({
      day: '2026-11-05',
      start: 1140,
      end: 1200,
    });
    expect(proposalSlotOf('2026-11-05', at('18:00'), ZONE)).toEqual({
      day: '2026-11-05',
      start: 1170,
      end: 1230,
    });
  });

  it('moves to tomorrow evening once the hour would cross midnight, and a past day to today', () => {
    expect(proposalSlotOf('2026-11-05', at('22:10'), ZONE)).toEqual({
      day: '2026-11-06',
      start: 1080,
      end: 1140,
    });
    expect(proposalSlotOf('2026-11-02', at('09:00'), ZONE)).toEqual({
      day: '2026-11-05',
      start: 1080,
      end: 1140,
    });
  });
});
