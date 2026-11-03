import {
  CreatorIdSchema,
  newId,
  ScriptStructureIdSchema,
  ScriptStructureVersionIdSchema,
  type PersonaLimits,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import type { QueuedStructure } from '../ports';
import { queueRefusals, queueView } from '../queue';

const limits: PersonaLimits = { never_do: [], never_show: ['pieds'], never_say: [], disgusts: [] };

const queued = (name: string, stageName: string): QueuedStructure => ({
  structureId: newId(ScriptStructureIdSchema),
  current: {
    id: newId(ScriptStructureVersionIdSchema),
    version: 2,
    name,
    moment: 'day',
    frozen: false,
    updatedAt: '2026-11-03T10:00:00.000Z',
    segments: [
      {
        kind: 'stage',
        key: 'a',
        name: stageName,
        intention: 'Elle se dévoile',
        mood: null,
        mediaSlots: [{ kind: 'image', optional: false, hint: null }],
        variants: [],
      },
    ],
  },
});

describe('queueRefusals', () => {
  it('keeps out a structure whose stage touches her limits', () => {
    const fine = queued('Salon', 'Canapé');
    const feet = queued('Bain', 'Pieds dans l’eau');
    expect(queueRefusals([fine, feet], limits)).toEqual([
      { structureId: feet.structureId, blocks: [{ key: 'a', stageName: 'Pieds dans l’eau', term: 'pieds' }] },
    ]);
  });

  it('refuses nothing without an active persona', () => {
    expect(queueRefusals([queued('Bain', 'Pieds')], null)).toEqual([]);
  });
});

describe('queueView', () => {
  it('says whether her persona was read, and what blocks each entry', () => {
    const creatorId = newId(CreatorIdSchema);
    const feet = queued('Bain', 'Pieds');
    const view = queueView(creatorId, [feet], limits);
    expect(view.personaChecked).toBe(true);
    expect(view.entries).toEqual([
      {
        structureId: feet.structureId,
        name: 'Bain',
        moment: 'day',
        version: 2,
        blocks: [expect.objectContaining({ term: 'pieds' })],
      },
    ]);
    expect(queueView(creatorId, [feet], null).personaChecked).toBe(false);
  });
});
