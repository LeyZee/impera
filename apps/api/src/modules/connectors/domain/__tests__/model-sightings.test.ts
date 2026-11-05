import { describe, expect, it } from 'vitest';

import { sightingChanges, type ModelSighting } from '../model-sightings';
import type { ListedModel } from '../sales-feed';

/** Invented models (ADR 0010): never a real one. */
const listed = (platformModelId: string, status: ListedModel['status'] = 'validated'): ListedModel => ({
  platformModelId,
  handle: `handle-${platformModelId}`,
  displayName: `Modèle ${platformModelId}`,
  isActive: true,
  status,
  rawStatus: status,
  avatarUrl: null,
});

const seen = (platformModelId: string, marks: Partial<ModelSighting> = {}): [string, ModelSighting] => [
  platformModelId,
  { platformModelId, status: 'validated', goneSignalledAt: null, bannedSignalledAt: null, ...marks },
];

const AT = new Date('2026-11-05T10:00:00Z');

describe('what a reading of the model list changes (CRM-07 a2, ADR 0069 § 5)', () => {
  it('signals a linked model gone or banned once, and an unlinked one never', () => {
    const changes = sightingChanges(
      new Map([seen('m1'), seen('m2'), seen('m3')]),
      [listed('m2', 'banned'), listed('m4', 'banned')],
      new Set(['m1', 'm2']),
    );
    expect(changes.gone).toEqual(['m1']);
    expect(changes.banned).toEqual(['m2']);
    expect(changes.signals).toEqual([
      { kind: 'model_gone', platformModelId: 'm1' },
      { kind: 'model_banned', platformModelId: 'm2' },
    ]);
  });

  it('says nothing again while the mark holds, and clears it when she comes back', () => {
    const previous = new Map([
      seen('m1', { goneSignalledAt: AT }),
      seen('m2', { status: 'banned', bannedSignalledAt: AT }),
    ]);
    const still = sightingChanges(previous, [listed('m2', 'banned'), listed('m9')], new Set(['m1', 'm2']));
    expect(still.signals).toEqual([]);
    expect(still.back).toEqual([]);

    const back = sightingChanges(previous, [listed('m1'), listed('m2')], new Set(['m1', 'm2']));
    expect(back.back).toEqual(['m1']);
    expect(back.unbanned).toEqual(['m2']);
    expect(back.signals).toEqual([]);
  });

  it('takes an empty list for no answer: nobody counts as gone', () => {
    expect(sightingChanges(new Map([seen('m1')]), [], new Set(['m1'])).gone).toEqual([]);
  });

  it('signals a linked model never listed since the sightings began as gone', () => {
    expect(sightingChanges(new Map(), [listed('m2')], new Set(['m1'])).gone).toEqual(['m1']);
  });
});
