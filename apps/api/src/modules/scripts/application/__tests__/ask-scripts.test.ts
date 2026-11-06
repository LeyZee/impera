import {
  CreatorIdSchema,
  newId,
  ScriptStructureIdSchema,
  ScriptStructureVersionIdSchema,
  type CreatorId,
  type PersonaLimits,
  type ScriptCadenceOutcome,
  type ScriptStructureId,
  type ScriptStructureVersion,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { CadenceStore, QueuedStructure, ScriptRequests } from '../../domain/ports';
import { askScripts } from '../ask-scripts';

const LIMITS: PersonaLimits = { never_do: [], never_show: ['pieds'], never_say: [], disgusts: [] };

const version = (name: string, stageName: string): ScriptStructureVersion => ({
  id: newId(ScriptStructureVersionIdSchema),
  version: 1,
  name,
  moment: 'night',
  color: { primary: '#5c1029', secondary: '#911e42', accent: '#b03a78' },
  frozen: false,
  updatedAt: '2026-11-03T10:00:00.000Z',
  segments: [
    {
      kind: 'stage',
      key: 'a',
      name: stageName,
      intention: 'Elle se dévoile',
      access: 'paid',
      mood: null,
      outfit: null,
      place: null,
      mediaSlots: [{ kind: 'image', optional: false, hint: null }],
      variants: [],
    },
  ],
});

interface Asked {
  readonly creatorId: CreatorId;
  readonly dueOn: string;
  readonly structureId: ScriptStructureId;
  readonly structureVersionId: string;
  readonly askedAt: Date;
}

/** One creator, her queue, the library and the requests, in memory: what the database holds, as the job sees it. */
function world(options: { readonly limits: PersonaLimits | null; readonly failure?: Error }) {
  const creatorId = newId(CreatorIdSchema);
  const library = new Map<ScriptStructureId, ScriptStructureVersion>();
  let queue: ScriptStructureId[] = [];
  /** The database's clock, never the job's: a row's `created_at` is `now()` where it is written. */
  let queuedAt = new Date();
  const asked: Asked[] = [];
  const outcomes: ScriptCadenceOutcome[] = [];
  /** The library changed between the reading and the freezing (a save by the owner). */
  let onFreeze: (() => void) | null = null;

  const entry = (structureId: ScriptStructureId): QueuedStructure => {
    const current = library.get(structureId);
    if (current === undefined) throw new Error('unknown structure');
    return { structureId, current };
  };
  const cadences: CadenceStore = {
    read: () => Promise.resolve(null),
    setDays: () => Promise.resolve(null),
    creators: () => Promise.resolve([{ id: creatorId, timeZone: 'Europe/Paris' }]),
    days: () => Promise.resolve(14),
    queue: () => Promise.resolve(queue.map(entry)),
    usable: (_creator, structureId) => Promise.resolve(library.has(structureId) ? entry(structureId) : null),
    freeze: (structureId) => {
      onFreeze?.();
      const current = library.get(structureId);
      if (current === undefined) return Promise.resolve(null);
      const frozen = { ...current, frozen: true };
      library.set(structureId, frozen);
      return Promise.resolve(frozen);
    },
    dequeue: (_creator, structureId, askedAt) => {
      if (askedAt !== null && queuedAt > askedAt) return Promise.resolve();
      queue = queue.filter((id) => id !== structureId);
      return Promise.resolve();
    },
    record: (_creator, outcome) => {
      outcomes.push(outcome);
      return Promise.resolve();
    },
  };
  const requests: ScriptRequests = {
    ask: (request) => {
      // `content_requests_cadence_unique`: one per due day.
      if (!asked.some((row) => row.dueOn === request.dueOn)) asked.push({ ...request, askedAt: new Date() });
      return Promise.resolve();
    },
    last: () => Promise.resolve(asked.at(-1) ?? null),
  };
  const add = (name: string, stageName: string): ScriptStructureId => {
    const id = newId(ScriptStructureIdSchema);
    library.set(id, version(name, stageName));
    return id;
  };
  return {
    add,
    library,
    asked,
    outcomes,
    setQueue: (ids: ScriptStructureId[]) => {
      queue = ids;
      queuedAt = new Date();
    },
    queue: () => queue,
    onFreeze: (fn: () => void) => {
      onFreeze = fn;
    },
    creatorId,
    run: (at: string, onFailure?: (creator: CreatorId, error: unknown) => void) => {
      const limitsOf = () =>
        options.failure === undefined ? Promise.resolve(options.limits) : Promise.reject(options.failure);
      return askScripts(
        { cadences, requests, limitsOf, ...(onFailure === undefined ? {} : { onFailure }) },
        new Date(at),
      );
    },
  };
}

describe('scripts.ask_scripts (SC-02)', () => {
  it('counts a creator whose run failed and tells its cause, for the log', async () => {
    const failure = new Error('persona store down');
    const w = world({ limits: LIMITS, failure });
    w.setQueue([w.add('Salon', 'Canapé')]);
    const heard: [CreatorId, unknown][] = [];
    expect(await w.run('2026-11-05T10:00:00Z', (creator, error) => heard.push([creator, error]))).toEqual({
      asked: 0,
      warned: 0,
      failed: 1,
    });
    expect(heard).toEqual([[w.creatorId, failure]]);
  });

  it('asks nothing without an active persona', async () => {
    const w = world({ limits: null });
    w.setQueue([w.add('Salon', 'Canapé')]);
    expect(await w.run('2026-11-05T10:00:00Z')).toEqual({ asked: 0, warned: 1, failed: 0 });
    expect(w.asked).toEqual([]);
    expect(w.outcomes).toEqual(['no_persona']);
  });

  it('asks the version it froze, a week ahead in her day, and takes it out of her queue', async () => {
    const w = world({ limits: LIMITS });
    const salon = w.add('Salon', 'Canapé');
    const room = w.add('Chambre', 'Lit');
    w.setQueue([salon, room]);
    // Paris is an hour ahead: 23:30 UTC on the 5th is already her 6th.
    await w.run('2026-11-05T23:30:00Z');
    expect(w.asked).toMatchObject([{ dueOn: '2026-11-13', structureId: salon }]);
    expect(w.asked[0]?.structureVersionId).toBe(w.library.get(salon)?.id);
    expect(w.library.get(salon)?.frozen).toBe(true);
    expect(w.queue()).toEqual([room]);
  });

  it('makes no second request when replayed', async () => {
    const w = world({ limits: LIMITS });
    w.setQueue([w.add('Salon', 'Canapé'), w.add('Chambre', 'Lit')]);
    await w.run('2026-11-05T10:00:00Z');
    await w.run('2026-11-05T10:00:00Z');
    await w.run('2026-11-06T10:00:00Z');
    expect(w.asked).toHaveLength(1);
    expect(w.queue()).toHaveLength(1);
  });

  it('refuses at the freezing a structure changed since the reading to touch a limit', async () => {
    const w = world({ limits: LIMITS });
    const salon = w.add('Salon', 'Canapé');
    w.setQueue([salon]);
    w.onFreeze(() => {
      w.library.set(salon, version('Salon', 'Pieds nus'));
    });
    expect(await w.run('2026-11-05T10:00:00Z')).toEqual({ asked: 0, warned: 1, failed: 0 });
    expect(w.asked).toEqual([]);
    expect(w.outcomes).toEqual(['blocked']);
    expect(w.queue()).toEqual([salon]);
  });

  it('asks the next one 14 days after the last, and the last one again when her queue is empty', async () => {
    const w = world({ limits: LIMITS });
    const salon = w.add('Salon', 'Canapé');
    w.setQueue([salon]);
    await w.run('2026-11-05T10:00:00Z');
    await w.run('2026-11-18T10:00:00Z');
    expect(w.asked).toHaveLength(1);
    await w.run('2026-11-19T10:00:00Z');
    expect(w.asked.map((row) => [row.dueOn, row.structureId])).toEqual([
      ['2026-11-12', salon],
      ['2026-11-26', salon],
    ]);
    expect(w.outcomes).toEqual(['asked', 'reused']);
  });
});
