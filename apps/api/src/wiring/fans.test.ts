import { CreatorIdSchema, FanIdSchema, PlatformAccountIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { FansModule } from '../modules/fans';

import { fanNoteSourceOf } from './fans';

/** What `connector.sync_fan_note` reads of a fan (ADR 0117 § 4). Invented values only. */
const creatorId = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000bb');
const fanId = FanIdSchema.parse('0199f2a0-0000-7000-8000-0000000000dd');
const at = new Date('2026-11-16T12:00:00Z');

type Card = Awaited<ReturnType<FansModule['card']>>;
type Flags = Awaited<ReturnType<FansModule['flags']>>;

function value(items: string[], source: 'declared' | 'inferred' | 'noted') {
  return { items, source, observedAt: at, notedBy: null, notedByName: null, sourceMessageId: null };
}

function source(flags: Flags) {
  const card: Card = {
    fields: [
      { field: 'age', current: value(['31'], 'declared'), toCheck: [] },
      { field: 'job', current: value(['boulanger'], 'inferred'), toCheck: [] },
      { field: 'location', current: value(['Ville A'], 'noted'), toCheck: [] },
    ],
    others: [],
  };
  return fanNoteSourceOf({
    getFan: () =>
      Promise.resolve({
        id: fanId,
        creatorId,
        platformAccountId: PlatformAccountIdSchema.parse('0199f2a0-0000-7000-8000-0000000000aa'),
        platformFanId: 'fan_01',
        displayName: 'Fan test',
        firstSeenAt: at,
        lastSeenAt: at,
      }),
    card: () => Promise.resolve(card),
    flags: () => Promise.resolve(flags),
  });
}

describe('fanNoteSourceOf', () => {
  it('hands over what he said or a chatter noted, never a guess', async () => {
    const read = await source({}).read(creatorId, fanId);
    expect(read?.values.map((one) => one.slot)).toEqual(['age', 'location']);
  });

  it('leaves his age out while it is disputed: a human settles it (relecture d’Agent, #775)', async () => {
    const read = await source({ ageDisputed: { since: at.toISOString(), by: 'policy' } }).read(
      creatorId,
      fanId,
    );
    expect(read?.values.map((one) => one.slot)).toEqual(['location']);
  });
});
