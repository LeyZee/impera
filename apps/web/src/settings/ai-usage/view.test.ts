import { describe, expect, it } from 'vitest';

import { usageFixture } from './fixture';
import {
  capNote,
  capShare,
  creditText,
  dayColumns,
  eurText,
  hourColumns,
  modelSlices,
  runwayShare,
  runwayText,
  sinceText,
  tokensText,
  useSlices,
} from './view';

const NBSP = ' ';

describe('Consommation IA, what the screen says (ADR 0091)', () => {
  it('writes euros to the cent, and a cheap call never as free', () => {
    expect(eurText(3.4)).toBe(`3,40${NBSP}€`);
    expect(eurText(0.0042)).toBe(`0,004${NBSP}€`);
    expect(eurText(0)).toBe(`0,00${NBSP}€`);
    expect(creditText(1240, 'USD')).toBe(`12,40${NBSP}$`);
    expect(tokensText(21_400_000)).toBe(`21,4${NBSP}M`);
    expect(tokensText(34_200)).toBe(`34${NBSP}k`);
  });

  it('measures today against the cap and says the room left by state', () => {
    const usage = usageFixture();
    expect(capShare(usage)).toBeCloseTo(21);
    expect(capNote(usage)).toBe(`15,80${NBSP}€ de marge avant le plafond du jour (20,00${NBSP}€).`);
    const alert = usageFixture({ today: { ...usage.today, eur: 17, state: 'alert' } });
    expect(capNote(alert)).toBe(`Plus que 3,00${NBSP}€ avant le plafond du jour.`);
    const reached = usageFixture({ today: { ...usage.today, eur: 20.1, state: 'reached' } });
    expect(capShare(reached)).toBe(100);
    expect(capNote(reached)).toContain('Plafond atteint');
  });

  it('says how fresh the last call is', () => {
    const now = new Date('2026-11-11T13:30:00Z');
    expect(sinceText('2026-11-11T13:29:48Z', now, 'Europe/Paris')).toBe('dernier appel il y a 12 s');
    expect(sinceText('2026-11-11T13:20:00Z', now, 'Europe/Paris')).toBe('dernier appel il y a 10 min');
    expect(sinceText('2026-11-11T08:05:00Z', now, 'Europe/Paris')).toBe('dernier appel à 09:05');
    expect(sinceText(null, now, 'Europe/Paris')).toBe('aucun appel ces 30 derniers jours');
  });

  it('stacks each column by provider in a fixed order, today named', () => {
    const usage = usageFixture();
    const days = dayColumns(usage);
    expect(days).toHaveLength(30);
    expect(days.at(-1)?.title).toMatch(/^Aujourd’hui, /u);
    // xAI first, Mistral empty, Google third, Venice empty: the colours never move.
    expect(days[0]?.parts).toEqual([2, 0, 0.4, 0]);
    expect(hourColumns(usage)[14]?.title).toBe('14h–15h');
  });

  it('colours each model by its provider and each use by itself, the most expensive first', () => {
    const usage = usageFixture();
    const models = modelSlices(usage);
    expect(models.map((m) => m.colour)).toEqual([
      'var(--nv-series-1)',
      'var(--nv-series-3)',
      'var(--nv-series-2)',
    ]);
    expect(models[2]?.note).toContain('64 en secours');
    expect(useSlices(usage).map((u) => u.label)).toEqual([
      'Écrire les messages',
      'Décider quoi répondre',
      'Regarder les médias',
    ]);
  });

  it('tells the runway of the credits in days and until when', () => {
    const [card] = usageFixture().credits;
    if (card === undefined) throw new Error('fixture has a card');
    expect(runwayText(card)).toBe('Environ 3 jours au rythme actuel, jusqu’au samedi 14 novembre.');
    expect(runwayShare(card)).toBeCloseTo((3.26 / 30) * 100);
    expect(runwayText({ ...card, state: 'empty', balanceMinor: -20 })).toContain('Épuisés');
    expect(runwayShare({ ...card, state: 'empty' })).toBe(0);
    expect(runwayText({ ...card, daysLeft: 0.4 })).toContain('moins d’un jour');
    expect(runwayText({ ...card, perDayMinor: 0, daysLeft: null, runsOutOn: null, state: 'ok' })).toContain(
      'le solde ne baisse pas',
    );
    expect(runwayText({ ...card, daysLeft: null, runsOutOn: null, state: 'unknown_pace' })).toContain(
      'Pas encore de rythme',
    );
  });

  it('tells a subscription holds its quota, or since when it is used up (ADR 0091 § 6)', () => {
    const plan = usageFixture().credits.find((c) => c.mode === 'subscription');
    if (plan === undefined) throw new Error('fixture has a subscription');
    expect(runwayText(plan)).toContain('Les appels passent sur le quota de ton abonnement');
    expect(runwayShare(plan)).toBe(100);
    const reached = { ...plan, state: 'quota_reached', quotaRefusedAt: '2026-11-12T22:35:00.000Z' } as const;
    expect(runwayText(reached)).toBe(
      'Quota épuisé depuis jeudi 12 novembre à 23:35 : l’agent répond avec son modèle de repli jusqu’à la remise à zéro.',
    );
    expect(runwayShare(reached)).toBe(0);
  });
});
