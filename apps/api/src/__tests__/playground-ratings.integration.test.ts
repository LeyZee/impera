import { CreatorIdSchema, newId, PersonaVersionIdSchema, type CreatorId } from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { CalibrationRecord } from '../modules/agent';
import {
  createDbCalibrationStore,
  createDbVoiceBankStore,
  createDbVoiceExampleBank,
  importRatings,
} from '../modules/playground';

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

    // A withdrawn example (the table refuses any change but the purge until `Retirer`, ADR 0102 § 5).
    const withdrawn = record('w', lina, 7);
    const withdrawnAt = new Date(withdrawn.at);
    await test.admin.db.insert(schema.calibrationRatings).values({
      id: newId(CreatorIdSchema),
      creatorId: lina,
      source: 'playground',
      sessionId: withdrawn.sessionId,
      ratedAt: withdrawnAt,
      voicePrompt: withdrawn.version.voicePrompt,
      voiceModel: withdrawn.version.voiceModel,
      verdictKind: 'corrected',
      verdict: withdrawn.verdict,
      destination: 'voice_example',
      fanMessage: withdrawn.fanMessage,
      bubbles: [...withdrawn.bubbles],
      moment: withdrawn.moment,
      exampleState: 'withdrawn',
      exampleStateAt: withdrawnAt,
    });
    const after = await table.list();
    expect(after).toHaveLength(4);
    expect(after.filter((r) => r.destination === undefined).map((r) => r.at)).toEqual([withdrawn.at]);
  });

  it('counts as refused a rating whose persona version no longer exists', async () => {
    const lost = { ...record('e', lina, 9), personaVersionId: newId(CreatorIdSchema) };
    const from = { append: () => Promise.resolve(), list: () => Promise.resolve([lost]) };
    const table = createDbCalibrationStore(test.app.db, () => Promise.resolve([lina]));
    expect(await importRatings(from, table)).toEqual({ read: 1, kept: 0, withoutCreator: 0, refused: 1 });
  });

  it('files a blocked correction out of her bank, lists her bank, and withdraws an example everywhere (ADR 0102 § 4, § 5)', async () => {
    const versionId = newId(PersonaVersionIdSchema);
    await test.admin.db.insert(schema.personaVersions).values({
      id: versionId,
      creatorId: nora,
      version: 'bank',
      sourcePath: 'personas/example.yaml',
      content: {},
      contentHash: 'bank',
    });
    const table = createDbCalibrationStore(test.app.db, () => Promise.resolve([nora]));
    const kept = { ...record('k', nora, 20), id: newId(CreatorIdSchema), personaVersionId: versionId };
    const stopped = {
      ...record('s', nora, 21),
      id: newId(CreatorIdSchema),
      personaVersionId: versionId,
      verdict: { kind: 'corrected' as const, text: 'Je suis une IA' },
      exampleBlocked: true as const,
    };
    await table.append(kept);
    await table.append(stopped);

    const bank = createDbVoiceBankStore(test.app.db);
    const examplesOf = createDbVoiceExampleBank(test.app.db);
    expect((await bank.list(nora, versionId)).map((e) => [e.id, e.state])).toEqual([
      [stopped.id, 'blocked'],
      [kept.id, 'active'],
    ]);
    // Her drafts read the active one only.
    expect((await examplesOf(nora, versionId)).map((e) => e.id)).toEqual([kept.id]);
    expect((await table.list()).find((r) => r.id === stopped.id)?.exampleBlocked).toBe(true);

    // Another creator cannot withdraw it; hers can, once.
    expect(await bank.withdraw(lina, kept.id, new Date())).toBe(false);
    expect(await bank.withdraw(nora, kept.id, new Date())).toBe(true);
    expect(await bank.withdraw(nora, kept.id, new Date())).toBe(false);
    expect(await examplesOf(nora, versionId)).toEqual([]);
    expect((await bank.list(nora, versionId)).map((e) => e.id)).toEqual([stopped.id]);
    // Kept for history, out of her bank.
    const [row] = await test.admin.db
      .select()
      .from(schema.calibrationRatings)
      .where(eq(schema.calibrationRatings.id, kept.id));
    expect(row?.exampleState).toBe('withdrawn');
    // Nothing else changes: the table stays append-only.
    await expect(
      test.admin.db
        .update(schema.calibrationRatings)
        .set({ fanMessage: 'autre' })
        .where(eq(schema.calibrationRatings.id, kept.id)),
    ).rejects.toThrow();
  });
});
