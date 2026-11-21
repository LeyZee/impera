import { describe, expect, it } from 'vitest';

import { currentIdentity, identityInputHash, type IdentitySource } from '../script-identity';

/** An invented script of two steps, one photo each, both described. */
const source = (): IdentitySource => ({
  name: 'Script inventé',
  steps: [0, 1].map((platformIndex) => ({
    platformIndex,
    name: `Étape ${String(platformIndex + 1)}`,
    text: 'Texte inventé',
    media: [
      {
        ref: `media_${String(platformIndex)}`,
        kind: 'image' as const,
        descriptionId: `d_${String(platformIndex)}`,
      },
    ],
    previewMedia: [],
  })),
});

describe('the version of a script its identity is written for', () => {
  it('is the same for the same texts, media and descriptions', () => {
    expect(identityInputHash(source())).toBe(identityInputHash(source()));
    expect(identityInputHash(source())).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('changes with a text, a media, a description or a rank, never with what it does not hold', () => {
    const base = identityInputHash(source());
    const changed = (edit: (script: IdentitySource) => IdentitySource) => identityInputHash(edit(source()));
    expect(changed((s) => ({ ...s, name: 'Autre nom' }))).not.toBe(base);
    expect(
      changed((s) => ({ ...s, steps: s.steps.map((step) => ({ ...step, text: 'Autre texte' })) })),
    ).not.toBe(base);
    expect(
      changed((s) => ({
        ...s,
        steps: s.steps.map((step) => ({
          ...step,
          media: step.media.map((media) => ({ ...media, descriptionId: 'd_corrected' })),
        })),
      })),
    ).not.toBe(base);
    expect(
      changed((s) => ({ ...s, steps: s.steps.map((step) => ({ ...step, platformIndex: 0 })) })),
    ).not.toBe(base);
  });
});

describe('the identity shown for the current version', () => {
  const at = (minute: number) => new Date(`2026-11-15T10:${String(minute).padStart(2, '0')}:00Z`);
  const row = (id: string, inputHash: string, minute: number, validated: boolean) => ({
    id,
    inputHash,
    createdAt: at(minute),
    validatedAt: validated ? at(minute + 1) : null,
  });

  it('is the latest validated of the version, else its latest written, never one of another version', () => {
    const rows = [
      row('old_validated', 'v1', 0, true),
      row('validated', 'v2', 1, true),
      row('newer_to_validate', 'v2', 5, false),
    ];
    expect(currentIdentity(rows, 'v2')?.id).toBe('validated');
    expect(currentIdentity([row('a', 'v2', 1, false), row('b', 'v2', 2, false)], 'v2')?.id).toBe('b');
    expect(currentIdentity(rows, 'v3')).toBeNull();
  });
});
