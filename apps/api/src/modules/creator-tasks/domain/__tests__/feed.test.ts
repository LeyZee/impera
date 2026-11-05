import { CreatorTaskSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { feedEntryOf } from '../feed';

const task = (over: object) =>
  CreatorTaskSchema.parse({
    id: '01936f00-0000-7000-8000-000000000001',
    when: { kind: 'day', day: '2026-11-06' },
    category: 'shoot',
    title: 'Séance lingerie',
    purpose: null,
    shootBrief: null,
    essential: false,
    reminderMinutes: null,
    ...over,
  });

describe('her task in her calendar link (CR-05 lot c2)', () => {
  it('names a task by its emoji and title, and says what it is for or its category', () => {
    expect(feedEntryOf(task({}))).toEqual({
      uid: '01936f00-0000-7000-8000-000000000001@impera',
      summary: '🎬 Séance lingerie',
      description: 'Tournage',
      day: '2026-11-06',
    });
    expect(feedEntryOf(task({ purpose: 'Pour : feed' }))?.description).toBe('Pour : feed');
  });

  it('keeps her hours as instants', () => {
    const entry = feedEntryOf(
      task({
        when: { kind: 'timed', startsAt: '2026-11-06T13:00:00.000Z', endsAt: '2026-11-06T15:00:00.000Z' },
      }),
    );
    expect(entry).toMatchObject({
      startsAt: new Date('2026-11-06T13:00:00.000Z'),
      endsAt: new Date('2026-11-06T15:00:00.000Z'),
    });
  });

  it('only names her shooting sheet, which stays in Impera', () => {
    const entry = feedEntryOf(task({ shootBrief: 'Ambiance Nuit, noir et dentelle' }));
    expect(entry?.description).toBe('Tournage\nTa fiche de tournage est dans ton agenda Impera.');
    expect(JSON.stringify(entry)).not.toContain('dentelle');
  });

  it('leaves a routine out: it has no date', () => {
    expect(feedEntryOf(task({ when: { kind: 'routine', weekdays: [1, 2, 3] } }))).toBeNull();
  });
});
