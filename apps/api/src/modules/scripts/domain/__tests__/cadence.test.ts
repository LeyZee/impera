import {
  newId,
  ScriptStructureIdSchema,
  ScriptStructureVersionIdSchema,
  type PersonaLimits,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { chooseStructure, scriptReason } from '../cadence';
import type { QueuedStructure } from '../ports';

const limits: PersonaLimits = { never_do: [], never_show: ['pieds'], never_say: [], disgusts: [] };

const queued = (name: string, stageName: string): QueuedStructure => ({
  structureId: newId(ScriptStructureIdSchema),
  current: {
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
  },
});

describe('the structure the cadence asks of her (SC-02)', () => {
  const salon = queued('Salon', 'Canapé');
  const feet = queued('Pieds', 'Pieds nus');
  const room = queued('Chambre', 'Lit');

  it('asks nothing without an active persona: a limit unknown is not a limit absent', () => {
    expect(chooseStructure([salon], null, null)).toEqual({ outcome: 'no_persona', skipped: [] });
  });

  it('takes the first that touches none of her limits, naming each one passed over', () => {
    const choice = chooseStructure([feet, salon, room], null, limits);
    expect(choice).toMatchObject({ outcome: 'asked', structureId: salon.structureId });
    expect(choice.skipped).toEqual([
      {
        structureId: feet.structureId,
        name: 'Pieds',
        blocks: [{ key: 'a', stageName: 'Pieds nus', term: 'pieds' }],
      },
    ]);
  });

  it('says « blocked » when every structure of her queue touches a limit, even with a last one', () => {
    expect(chooseStructure([feet], room, limits)).toMatchObject({ outcome: 'blocked' });
  });

  it('asks the last one again when her queue is empty, unless it touches a limit now', () => {
    expect(chooseStructure([], room, limits)).toEqual({
      outcome: 'reused',
      structureId: room.structureId,
      skipped: [],
    });
    expect(chooseStructure([], feet, limits)).toMatchObject({ outcome: 'blocked' });
    expect(chooseStructure([], null, limits)).toEqual({ outcome: 'queue_empty', skipped: [] });
  });

  it('says the request in her words', () => {
    expect(scriptReason('Chambre')).toBe('Ton prochain script : Chambre');
  });
});
