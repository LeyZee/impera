import { describe, expect, it } from 'vitest';

import { DEFAULT_GUARD_SETTINGS } from '../../../agent/index';
import { createVoiceBankView } from '../bank';
import type { BankEntry, VoiceBankStore } from '../db/rating-store';

const AT = new Date('2026-11-16T15:00:00.000Z');
const entry = (id: string, text: string, state: BankEntry['state'] = 'active'): BankEntry => ({
  id,
  text,
  fanMessage: 'Salut toi',
  ratedAt: AT,
  state,
});

function store(entries: BankEntry[]): VoiceBankStore & { readonly withdrawn: string[] } {
  const withdrawn: string[] = [];
  return {
    withdrawn,
    list: () => Promise.resolve(entries.filter((e) => !withdrawn.includes(e.id))),
    withdraw: (_creatorId, id) => {
      const found = entries.some((e) => e.id === id) && !withdrawn.includes(id);
      if (found) withdrawn.push(id);
      return Promise.resolve(found);
    },
  };
}

describe('her bank in Entraîner (ADR 0102 § 5)', () => {
  const entries = [
    entry('00000000-0000-4000-8000-000000000001', 'Hey toi, le plus récent'),
    entry('00000000-0000-4000-8000-000000000002', 'Je suis une IA'),
    entry('00000000-0000-4000-8000-000000000003', 'Je suis une IA, rangée arrêtée', 'blocked'),
    ...Array.from({ length: 12 }, (_, i) =>
      entry(`00000000-0000-4000-8000-1000000000${String(i).padStart(2, '0')}`, `Coucou ${String(i)}`),
    ),
  ];

  it('says which twelve her voice reads, and which guard stops the others', async () => {
    const view = createVoiceBankView({
      store: store(entries),
      guardsOf: () => Promise.resolve(DEFAULT_GUARD_SETTINGS),
      now: () => AT,
    });
    const { examples } = await view.list('creator-1', 'version-1');
    expect(examples).toHaveLength(15);
    expect(examples.filter((e) => e.isRead)).toHaveLength(12);
    expect(examples[0]).toMatchObject({ isRead: true, state: 'active', blockedBy: [] });
    // Active, but her guards stop it now: never read, and the screen says why.
    expect(examples[1]).toMatchObject({ isRead: false, state: 'blocked' });
    expect(examples[1]?.blockedBy[0]?.severity).toBe('blocking');
    expect(examples[2]).toMatchObject({ isRead: false, state: 'blocked' });
    // The thirteenth plain example waits behind the twelve.
    expect(examples.at(-1)?.isRead).toBe(false);
  });

  it('lists nothing for a version that is not hers', async () => {
    const view = createVoiceBankView({
      store: store(entries),
      guardsOf: () => Promise.resolve(null),
      now: () => AT,
    });
    expect(await view.list('creator-1', 'version-x')).toEqual({ examples: [] });
  });

  it('withdraws once, then says it is no longer in her bank', async () => {
    const kept = store(entries);
    const view = createVoiceBankView({
      store: kept,
      guardsOf: () => Promise.resolve(DEFAULT_GUARD_SETTINGS),
      now: () => AT,
    });
    const id = '00000000-0000-4000-8000-000000000001';
    await view.withdraw('creator-1', id);
    expect(kept.withdrawn).toEqual([id]);
    await expect(view.withdraw('creator-1', id)).rejects.toMatchObject({ code: 'voice_example_not_found' });
  });
});
