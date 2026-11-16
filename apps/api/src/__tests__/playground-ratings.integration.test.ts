import { CreatorIdSchema, newId, type CreatorId } from '@impera/contracts';
import { schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { CalibrationRecord } from '../modules/agent';
import { createDbCalibrationStore, importRatings } from '../modules/playground';

function record(id: string, creatorId: CreatorId | undefined, minutes: number): CalibrationRecord {
  const at = new Date(Date.UTC(2026, 10, 12, 20, minutes)).toISOString();
  return {
    id,
    ...(creatorId !== undefined && { creatorId }),
    sessionId: 'session-1',
    at,
    version: { voicePrompt: '1.4.0', voiceModel: 'grok-4.7' },
    verdict: { kind: 'corrected', text: 'Coucou toi 😊' },
    destination: 'voice_example',
    fanMessage: 'Salut toi',
    bubbles: ['Bonjour, comment allez-vous ?'],
    moment: {
      history: [{ from: 'fan', text: 'Salut toi' }],
      fanNotes: '',
      situation: {
        now: new Date(at),
        timeZone: 'Europe/Paris',
        relationshipStartedAt: new Date('2026-11-10T21:30:00.000Z'),
        spentCents: 0,
      },
    },
  };
}

describe('playground ratings in the database (ADR 0103, AGE-06)', () => {
  let test: TestDb;
  let nora: CreatorId;
  let lina: CreatorId;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    nora = newId(CreatorIdSchema);
    lina = newId(CreatorIdSchema);
    await test.admin.db.insert(schema.creators).values([
      { id: nora, nameKey: nora, displayName: 'Nora Vidal', timezone: 'Europe/Paris' },
      { id: lina, nameKey: lina, displayName: 'Lina Morel', timezone: 'Europe/Paris' },
    ]);
  });

  afterAll(async () => {
    await test.close();
  });

  it('imports the JSON lines once, reads each creator’s back in order, and keeps a withdrawn example out of her bank', async () => {
    const lines = [
      record('a', nora, 5),
      record('b', undefined, 6),
      record('c', lina, 1),
      record('d', nora, 2),
    ];
    const from = { append: () => Promise.resolve(), list: () => Promise.resolve(lines) };
    const table = createDbCalibrationStore(test.app.db, () => Promise.resolve([nora, lina]));

    expect(await importRatings(from, table)).toEqual({ read: 4, kept: 3, withoutCreator: 1, refused: 0 });
    // Again: the derived ids are the same, nothing is added.
    expect(await importRatings(from, table)).toEqual({ read: 4, kept: 3, withoutCreator: 1, refused: 0 });

    const read = await table.list();
    expect(read.map((r) => r.creatorId)).toEqual([lina, nora, nora]);
    expect(read[2]?.moment.situation.now).toEqual(new Date(lines[0]?.at ?? ''));
    expect(read.every((r) => r.destination === 'voice_example')).toBe(true);

    const rows = await test.admin.db.select().from(schema.calibrationRatings);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.exampleState === 'active' && r.source === 'playground')).toBe(true);

    await test.admin.db.update(schema.calibrationRatings).set({ exampleState: 'withdrawn' });
    expect((await table.list()).some((r) => r.destination !== undefined)).toBe(false);
  });

  it('counts as refused a rating whose persona version no longer exists', async () => {
    const lost = { ...record('e', lina, 9), personaVersionId: newId(CreatorIdSchema) };
    const from = { append: () => Promise.resolve(), list: () => Promise.resolve([lost]) };
    const table = createDbCalibrationStore(test.app.db, () => Promise.resolve([lina]));
    expect(await importRatings(from, table)).toEqual({ read: 1, kept: 0, withoutCreator: 0, refused: 1 });
  });
});
