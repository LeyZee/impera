import {
  AgencySuggestionSchema,
  CreateSuggestionBodySchema,
  DomainError,
  SUGGESTION_GUARD_UNPROCESSABLE,
  type AgencySuggestion,
  type CreateSuggestionBody,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { GuardedShoot, ShootGuardFault } from '../../domain/ports';
import { suggestTask } from '../suggest';

// Invented sentences only (ADR 0010).
const sheet = {
  hook: 'Devine ce que je prépare ce soir',
  onScreen: null,
  shots: ['Reflet dans le miroir', 'Tenue de soirée'],
  ending: null,
  seconds: 15,
};
const body = (values: Record<string, unknown> = {}): CreateSuggestionBody =>
  CreateSuggestionBodySchema.parse({
    id: '01960000-0000-7000-8000-000000000001',
    when: { kind: 'day', day: '2026-11-10' },
    category: 'shoot',
    title: 'Tourner le miroir',
    ...values,
  });

const answered = (suggested: CreateSuggestionBody): AgencySuggestion =>
  AgencySuggestionSchema.parse({
    id: suggested.id,
    when: suggested.when,
    week: '2026-11-09',
    minutes: null,
    category: suggested.category,
    title: suggested.title,
    purpose: suggested.purpose,
    reelBrief: suggested.reelBrief,
    essential: false,
    origin: 'agency',
    state: 'suggested',
    reason: null,
    decidedAt: null,
    createdAt: '2026-11-08T12:00:00.000Z',
    task: null,
  });

function fakes(fault: ShootGuardFault | null) {
  const read: GuardedShoot[] = [];
  const written: CreateSuggestionBody[] = [];
  return {
    read,
    written,
    deps: {
      guard: (_creatorId: string, shoot: GuardedShoot) => {
        read.push(shoot);
        return Promise.resolve(fault);
      },
      store: {
        create: async (
          _creatorId: string,
          _userId: string,
          suggested: CreateSuggestionBody,
          _now: Date,
          check: () => Promise<void>,
        ) => {
          await check();
          written.push(suggested);
          return answered(suggested);
        },
      },
    },
  };
}

const now = new Date('2026-11-08T12:00:00Z');

describe('a shoot suggested by hand (ADR 0082 § 3)', () => {
  it('is never read by the guards without a drop category, as before', async () => {
    const { deps, read, written } = fakes({ reason: 'limit', field: 'title' });
    await suggestTask(deps, 'c', 'u', body(), now);
    expect(read).toEqual([]);
    expect(written[0]?.purpose).toBeNull();
  });

  it('says what it is for when nothing is written, and is read with its reel sheet', async () => {
    const { deps, read, written } = fakes(null);
    await suggestTask(deps, 'c', 'u', body({ dropCategory: 'instagram_reel', reelBrief: sheet }), now);
    expect(written[0]?.purpose).toBe('Pour : Reel Insta');
    expect(read[0]).toMatchObject({ purpose: 'Pour : Reel Insta', dropCategory: 'instagram_reel' });
    expect(read[0]?.reelBrief?.hook).toBe(sheet.hook);
  });

  it('never enters her agenda when a guard refuses it, and names the field (422)', async () => {
    const { deps, written } = fakes({ reason: 'instagram_guard', field: 'hook' });
    const refused = suggestTask(
      deps,
      'c',
      'u',
      body({ dropCategory: 'instagram_reel', reelBrief: sheet }),
      now,
    );
    await expect(refused).rejects.toBeInstanceOf(DomainError);
    await expect(refused).rejects.toMatchObject({
      code: SUGGESTION_GUARD_UNPROCESSABLE,
      details: { reason: 'instagram_guard', field: 'hook' },
    });
    expect(written).toEqual([]);
  });
});
