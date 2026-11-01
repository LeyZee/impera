import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PersonaSchema, type Persona } from '@nirvana/contracts';
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
