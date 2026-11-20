import { describe, expect, it } from 'vitest';

import type { CalibrationRecord, CalibrationStore } from '../../../agent/index';
import { importRatings, ratingRowId } from '../db/rating-store';

function record(id: string, creatorId?: string): CalibrationRecord {
  return {
    id,
    ...(creatorId !== undefined && { creatorId }),
    sessionId: 's1',
    at: '2026-10-17T19:00:00.000Z',
    version: { voicePrompt: '1.4.0', voiceModel: 'grok-4.7' },
    verdict: { kind: 'validated' },
    fanMessage: 'Salut toi',
    bubbles: ['Coucou toi, ça va ?'],
    moment: {
      history: [{ from: 'fan', text: 'Salut toi' }],
      fanNotes: '',
      situation: {
        now: new Date('2026-10-17T21:30:00Z'),
        timeZone: 'Europe/Paris',
        relationshipStartedAt: new Date('2026-10-14T21:30:00Z'),
        spentCents: 0,
      },
    },
  };
}

function memory(
  records: readonly CalibrationRecord[] = [],
  refuse = new Set<string>(),
): CalibrationStore & {
  readonly kept: CalibrationRecord[];
} {
  const kept: CalibrationRecord[] = [...records];
  return {
    kept,
    append(r) {
      if (refuse.has(r.id)) return Promise.reject(new Error('refused'));
      kept.push(r);
      return Promise.resolve();
    },
    list: () => Promise.resolve([...kept]),
  };
}

describe('the ratings’ table ids (AGE-06)', () => {
  it('keeps a UUID and derives the same UUID from any other id, every time', () => {
    const uuid = '0f8b3c1e-7a2d-4c5e-9b1a-3d4e5f6a7b8c';
    expect(ratingRowId(uuid.toUpperCase())).toBe(uuid);
    const derived = ratingRowId('a');
    expect(derived).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(ratingRowId('a')).toBe(derived);
    expect(ratingRowId('b')).not.toBe(derived);
  });
});

describe('the one-time import of the JSON lines (AGE-06)', () => {
  it('copies hers, leaves the invented persona’s out, counts what the table refused, and empties nothing', async () => {
    const lines = memory([record('a', 'creator-1'), record('b'), record('c', 'creator-1')]);
    const table = memory([], new Set(['c']));

    expect(await importRatings(lines, table)).toEqual({ read: 3, kept: 1, withoutCreator: 1, refused: 1 });
    expect(table.kept.map((r) => r.id)).toEqual(['a']);
    expect(lines.kept).toHaveLength(3);
  });
});
