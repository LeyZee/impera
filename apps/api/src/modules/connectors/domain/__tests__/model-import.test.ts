import { CreatorIdSchema, type PlatformModel } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { importedNameOf, isPreselected, proposeImports } from '../model-import';

// Everything below is invented (ADR 0010).
const ANNA = CreatorIdSchema.parse('0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c01');
const BELLA = CreatorIdSchema.parse('0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c02');
const CREATORS = [
  { creatorId: ANNA, displayName: 'Anna Test' },
  { creatorId: BELLA, displayName: 'Béllà  Test' },
];

function model(id: string, overrides: Partial<PlatformModel> = {}): PlatformModel {
  return {
    platformModelId: id,
    handle: `${id}_handle`,
    displayName: `Nom ${id}`,
    isActive: true,
    status: 'validated',
    avatarUrl: null,
    ...overrides,
  };
}

const inputs = (models: PlatformModel[], extra: Partial<Parameters<typeof proposeImports>[0]> = {}) => ({
  models,
  linked: new Set<string>(),
  dismissed: new Set<string>(),
  accounts: [{ creatorId: ANNA, handle: 'anna_reveal' }],
  creators: CREATORS,
  ...extra,
});

describe('the import proposal (CRM-07, ADR 0069)', () => {
  it('skips a linked or dismissed model, in the platform’s order', () => {
    const proposed = proposeImports(
      inputs([model('m1'), model('m2'), model('m3')], {
        linked: new Set(['m1']),
        dismissed: new Set(['m3']),
      }),
    );
    expect(proposed.map((one) => one.model.platformModelId)).toEqual(['m2']);
  });

  it('links by an account’s handle first, any case, then by her name; creates otherwise', () => {
    const proposed = proposeImports(
      inputs([
        model('by_handle', { handle: 'ANNA_Reveal', displayName: 'Béllà Test' }),
        model('by_name', { displayName: ' bella test ' }),
        model('new_one', { displayName: 'Carla Test' }),
      ]),
    );
    expect(proposed.map((one) => one.proposal)).toEqual([
      { kind: 'link', creatorId: ANNA, creatorDisplayName: 'Anna Test', match: 'handle' },
      { kind: 'link', creatorId: BELLA, creatorDisplayName: 'Béllà  Test', match: 'name' },
      { kind: 'create' },
    ]);
  });

  it('never links by a handle two creators have', () => {
    const [proposed] = proposeImports(
      inputs([model('shared', { handle: 'twice', displayName: 'Nobody Test' })], {
        accounts: [
          { creatorId: ANNA, handle: 'twice' },
          { creatorId: BELLA, handle: 'TWICE' },
        ],
      }),
    );
    expect(proposed?.proposal).toEqual({ kind: 'create' });
  });

  it('ticks only a validated and active model', () => {
    expect(isPreselected(model('a'))).toBe(true);
    expect(isPreselected(model('b', { isActive: false }))).toBe(false);
    for (const status of ['pending', 'onboarding_changes_requested', 'refused', 'banned', 'other'] as const) {
      expect(isPreselected(model('c', { status }))).toBe(false);
    }
  });

  it('names her by the display name, else the handle, else not at all', () => {
    expect(importedNameOf({ displayName: '  Dana Test ', handle: 'dana' })).toBe('Dana Test');
    expect(importedNameOf({ displayName: '', handle: 'dana_reveal' })).toBe('dana_reveal');
    expect(importedNameOf({ displayName: '🌸', handle: '1234' })).toBeNull();
  });
});
