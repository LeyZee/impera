import { randomUUID } from 'node:crypto';

import {
  ContentRequestIdSchema,
  CreatorIdSchema,
  newId,
  SuggestionIdSchema,
  UserIdSchema,
} from '@impera/contracts';
import { schema, withAdmin } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createCreatorNoticeSource } from '../modules/notifications/infra/db/creator-notices';

/**
 * What the agency asked of a creator, read for her phone (trou 9 du 21/11) on a real base, through the service role.
 * Everything is invented (ADR 0010): the creators, their accounts, the requests.
 */
describe('creator notices (trou 9 du 21/11)', () => {
  let test: TestDb;
  const nora = newId(CreatorIdSchema);
  const zoe = newId(CreatorIdSchema);
  const owner = newId(UserIdSchema);
  const noraPhone = newId(UserIdSchema);
  const noraTablet = newId(UserIdSchema);
  const at = (value: string) => new Date(value);
  const ids = {
    asked: newId(ContentRequestIdSchema),
    fromAnIdea: newId(ContentRequestIdSchema),
    old: newId(ContentRequestIdSchema),
    cancelled: newId(ContentRequestIdSchema),
    archived: newId(ContentRequestIdSchema),
    proposed: newId(SuggestionIdSchema),
    byTheAi: newId(SuggestionIdSchema),
    frame: newId(SuggestionIdSchema),
  };

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await withAdmin(test.admin.db, async (tx) => {
      for (const [creatorId, name, archivedAt] of [
        [nora, 'nora', null],
        [zoe, 'zoe', at('2026-11-01T00:00:00Z')],
      ] as const)
        await tx.insert(schema.creators).values({
          id: creatorId,
          nameKey: `creatrice_${name}`,
          displayName: `Créatrice ${name}`,
          timezone: 'Europe/Paris',
          archivedAt,
        });
      await tx.insert(schema.user).values([
        { id: owner, name: 'Owner', email: 'owner@example.test', role: 'owner' },
        { id: noraPhone, name: 'Nora', email: 'nora@example.test', role: 'creator', creatorIds: [nora] },
        { id: noraTablet, name: 'Nora 2', email: 'nora2@example.test', role: 'creator', creatorIds: [nora] },
      ]);
      const request = (id: string, creatorId: string, createdAt: string, extra: object = {}) => ({
        id,
        creatorId,
        category: 'feed_shoot',
        dueOn: '2026-12-03',
        reason: 'Une demande inventée',
        origin: 'agency',
        createdBy: owner,
        createdAt: at(createdAt),
        ...extra,
      });
      await tx.insert(schema.contentRequests).values([
        request(ids.asked, nora, '2026-11-27T10:50:00Z'),
        request(ids.old, nora, '2026-11-27T10:20:00Z'),
        request(ids.cancelled, nora, '2026-11-27T10:51:00Z', {
          state: 'cancelled',
          decidedAt: at('2026-11-27T10:52:00Z'),
        }),
        request(ids.archived, zoe, '2026-11-27T10:50:00Z'),
        // A trend idea's request (VEI-01 d2), written by its job: no author. A script needs a structure; its words
        // are the domain's test.
        request(ids.fromAnIdea, nora, '2026-11-27T10:55:00Z', {
          category: 'feed_video',
          origin: 'idea',
          createdBy: null,
        }),
      ]);
      const suggestion = (id: string, createdAt: string, extra: object = {}) => ({
        id,
        creatorId: nora,
        origin: 'agency',
        kind: 'day',
        category: 'post',
        title: 'Story du matin',
        day: '2026-12-01',
        week: '2026-11-30',
        createdBy: owner,
        createdAt: at(createdAt),
        ...extra,
      });
      await tx
        .insert(schema.creatorSuggestions)
        .values([
          suggestion(ids.proposed, '2026-11-27T10:56:00Z'),
          suggestion(ids.byTheAi, '2026-11-27T10:56:00Z', { origin: 'ai', createdBy: null }),
          suggestion(ids.frame, '2026-11-27T10:56:00Z', { category: 'shoot', weekRole: 'shoot_day' }),
        ]);
      await tx.insert(schema.creatorWeeks).values([
        {
          id: randomUUID(),
          creatorId: nora,
          week: '2026-11-30',
          state: 'validated',
          plan: {},
          computedAt: at('2026-11-27T09:00:00Z'),
          validatedBy: owner,
          validatedAt: at('2026-11-27T10:58:00Z'),
        },
        {
          id: randomUUID(),
          creatorId: nora,
          week: '2026-12-07',
          plan: {},
          computedAt: at('2026-11-27T10:58:00Z'),
        },
      ]);
    });
  });

  afterAll(async () => {
    await test.close();
  });

  it('reads the last half hour: her open requests, the agency’s propositions, her week validated, with her accounts', async () => {
    const notices = await createCreatorNoticeSource(test.service.db).between(
      at('2026-11-27T10:30:00Z'),
      at('2026-11-27T11:00:00Z'),
    );
    expect(notices.map((notice) => notice.subject)).toEqual([
      { kind: 'content_request', requestId: ids.asked, script: false, dueOn: '2026-12-03' },
      { kind: 'content_request', requestId: ids.fromAnIdea, script: false, dueOn: '2026-12-03' },
      { kind: 'proposition', suggestionId: ids.proposed },
      { kind: 'week', week: '2026-11-30' },
    ]);
    for (const notice of notices) {
      expect(notice.timeZone).toBe('Europe/Paris');
      expect(notice.accounts).toEqual([noraPhone, noraTablet].sort());
    }
  });

  it('reads nothing outside the window', async () => {
    expect(
      await createCreatorNoticeSource(test.service.db).between(
        at('2026-11-27T11:00:00Z'),
        at('2026-11-27T11:30:00Z'),
      ),
    ).toEqual([]);
  });
});
