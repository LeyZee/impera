import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PersonaSchema, type Persona } from '@impera/contracts';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { startBubbleGuard, startFollowUpPlan, startKycSlots } from '../../index';
import { activePersonaForModels, type ActivePersonaSource } from '../active-persona';

/** The fictional demo persona of the repository (ADR 0010: never a real one in a test). */
const DEMO: Persona = PersonaSchema.parse(
  parse(
    readFileSync(
      fileURLToPath(new URL('../../../../../../../personas/demo/v0.2.0.yaml', import.meta.url)),
      'utf8',
    ),
  ),
);
const NOW = new Date('2026-10-29T10:00:00Z');

const sourceOf =
  (persona: Persona | null): ActivePersonaSource =>
  () =>
    Promise.resolve(persona === null ? null : { id: 'version-2', creatorName: 'Nora', persona });

describe('activePersonaForModels (recette G4)', () => {
  it('reads her active version for the models, her stored name standing in for a placeholder', async () => {
    const read = await activePersonaForModels(sourceOf(DEMO), 'creator-1', NOW);
    expect(read?.creatorName).toBe(DEMO.details.first_name);
    expect(read?.followUps.delaysHours).toEqual([12, 24]);

    const unnamed = { ...DEMO, details: { ...DEMO.details, first_name: '<à remplir>' } };
    expect((await activePersonaForModels(sourceOf(unnamed), 'creator-1', NOW))?.creatorName).toBe('Nora');
  });

  it('never lets her open it herself later than she would sell (audit du 16/11, B3)', async () => {
    const strategies = DEMO.strategies;
    const crossed = {
      ...DEMO,
      strategies: {
        ...strategies,
        sexualization: { ...strategies.sexualization, min_desire_to_open: 70 },
        script_launch: { ...strategies.script_launch, min_desire: 50 },
      },
    };
    const read = await activePersonaForModels(sourceOf(crossed), 'creator-1', NOW);
    expect(read?.sexualizationLimits.minDesireToOpen).toBe(50);
    expect(read?.offerLimits.minDesire).toBe(50);
  });

  it('names the version it was read from, for the draft to carry it', async () => {
    expect((await activePersonaForModels(sourceOf(DEMO), 'creator-1', NOW))?.versionId).toBe('version-2');
  });

  it('never takes her clock from the file: the creator’s own zone is read apart (Créatrices, P3-14)', async () => {
    const elsewhere = { ...DEMO, details: { ...DEMO.details, timezone: 'America/New_York' } };
    const read = await activePersonaForModels(sourceOf(elsewhere), 'creator-1', NOW);
    expect(read?.personaSheet).not.toContain('New_York');
    expect(JSON.stringify(read)).not.toContain('America/New_York');
  });

  it('gives nothing without an active version, and lets a failed read through', async () => {
    expect(await activePersonaForModels(sourceOf(null), 'creator-1', NOW)).toBeNull();
    await expect(
      activePersonaForModels(() => Promise.reject(new Error('unreadable')), 'creator-1', NOW),
    ).rejects.toThrow('unreadable');
  });
});

describe('startFollowUpPlan', () => {
  it('reads her delays from her active version at each call, none without one or with them off', async () => {
    let active: Persona | null = DEMO;
    const plan = startFollowUpPlan({ activePersona: () => sourceOf(active)('creator-1'), now: () => NOW });
    expect(await plan.delaysHours('creator-1')).toEqual([12, 24]);
    active = { ...DEMO, follow_ups: { ...DEMO.follow_ups, enabled: false } };
    expect(await plan.delaysHours('creator-1')).toEqual([]);
    active = null;
    expect(await plan.delaysHours('creator-1')).toEqual([]);
  });
});

describe('startBubbleGuard, at approval (recette G4)', () => {
  it('reads her active version’s limits, and gives no guard without one: nothing is approved', async () => {
    const withDisgust = { ...DEMO, limits: { ...DEMO.limits, disgusts: ['brocoli'] } };
    const guard = startBubbleGuard({ activePersona: sourceOf(withDisgust), now: () => NOW });
    const hers = await guard.forCreator('creator-1');
    expect(hers?.check(['J’adore le brocoli'])).toMatchObject({ isBlocked: true, codes: ['forbidden_term'] });
    expect(hers?.check(['Coucou toi'])).toEqual({ isBlocked: false, codes: [] });
    expect(await startBubbleGuard({ activePersona: sourceOf(null) }).forCreator('creator-1')).toBeNull();
    await expect(
      startBubbleGuard({ activePersona: () => Promise.reject(new Error('unreadable')) }).forCreator(
        'creator-1',
      ),
    ).rejects.toThrow('unreadable');
  });
});

describe('startBubbleGuard, her accounts at approval (ADR 0143 bound 21)', () => {
  const lives = { platform: 'tiktok', username: 'demo.lives', usage: 'lives' } as const;
  const hersWith = (shareable: readonly (typeof lives)[]) =>
    startBubbleGuard({
      activePersona: sourceOf(DEMO),
      socialAccounts: () => Promise.resolve({ shareable, usernames: ['demo.lives', 'demo_perso'] }),
      now: () => NOW,
    }).forCreator('creator-1');
  const answer = ['tape demo.lives sur tiktok 😊'];
  const blocked = { isBlocked: true, codes: ['contact_info'] };

  it('lets the account the draft gave pass, for its use, while nothing cuts it', async () => {
    const hers = await hersWith([lives]);
    expect(hers?.check(answer, {}, false, { usage: 'lives', cut: false })).toEqual({
      isBlocked: false,
      codes: [],
    });
  });

  it('blocks it when he is cut since the draft, when her switch was turned off, or with no account given', async () => {
    const hers = await hersWith([lives]);
    expect(hers?.check(answer, {}, false, { usage: 'lives', cut: true })).toMatchObject(blocked);
    expect(hers?.check(answer, {}, false, null)).toMatchObject(blocked);
    expect(hers?.check(answer)).toMatchObject(blocked);
    const off = await hersWith([]);
    expect(off?.check(answer, {}, false, { usage: 'lives', cut: false })).toMatchObject(blocked);
    // A human edit naming another account of hers, on a draft that gave one.
    expect(
      hers?.check(['mon perso c’est demo_perso'], {}, false, { usage: 'lives', cut: false }),
    ).toMatchObject(blocked);
  });
});

describe('startKycSlots (recette G4)', () => {
  it('gives the lines her active version collects, none read without one', async () => {
    expect(await startKycSlots({ activePersona: sourceOf(DEMO), now: () => NOW })('creator-1')).toEqual([
      'first_name',
      'age',
      'location',
      'job',
      'situation',
      'hobbies',
    ]);
    expect(await startKycSlots({ activePersona: sourceOf(null) })('creator-1')).toBeNull();
  });
});
