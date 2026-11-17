import {
  CreatorIdSchema,
  FanCardReadSchema,
  FanIdSchema,
  UserIdSchema,
  type CreatorId,
  type FanId,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { StoredFact } from '../../domain/facts';
import { told, type ToldWrites } from '../told';

/** `onFactsChanged` after each write the platform's note follows (ADR 0117 § 5). Invented values only. */
const creatorId = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000bb');
const fanId = FanIdSchema.parse('0199f2a0-0000-7000-8000-0000000000dd');
const author = UserIdSchema.parse('0199f2a0-0000-7000-8000-0000000000ee');
const at = new Date('2026-11-17T08:00:00Z');
const command = { author: `human:${author}` as const, correlationId: 'test' };

const fact: StoredFact = {
  id: 'fact_01',
  category: 'identity',
  key: 'job',
  value: 'boulanger',
  kind: 'declared',
  confidence: 0.9,
  sourceMessageId: null,
  observedAt: at,
  expiresAt: null,
  supersededBy: null,
};

function setUp(written: StoredFact[]) {
  const calls: [CreatorId, FanId][] = [];
  const base: ToldWrites = {
    proposeFacts: () => Promise.resolve(written),
    proposeRead: () => Promise.resolve(written),
    editCard: () => Promise.resolve({ fields: [], others: [] }),
    setFlag: () => Promise.resolve({ flags: {}, mayConfirmDisputedAge: true }),
  };
  const service = told(base, (creator, fan) => {
    calls.push([creator, fan]);
    return Promise.resolve();
  });
  return { service, calls };
}

const read = FanCardReadSchema.parse({ facts: [] });

describe('told: his client note follows his facts', () => {
  it('after facts written, a chatter’s edit and his age confirmed', async () => {
    const { service, calls } = setUp([fact]);
    await service.proposeFacts(creatorId, fanId, []);
    await service.proposeRead(creatorId, fanId, read, []);
    await service.editCard(creatorId, fanId, 'job', { clear: true }, author);
    await service.setFlag(creatorId, fanId, { flag: 'ageConfirmedAt', value: at.toISOString() }, command);
    expect(calls).toEqual(Array.from({ length: 4 }, () => [creatorId, fanId]));
  });

  it('not when nothing was written, nor for another limit', async () => {
    const { service, calls } = setUp([]);
    await service.proposeFacts(creatorId, fanId, []);
    await service.proposeRead(creatorId, fanId, read, []);
    await service.setFlag(
      creatorId,
      fanId,
      { flag: 'salesFrozen', value: { reason: 'operator', since: at.toISOString() } },
      command,
    );
    expect(calls).toEqual([]);
  });
});
