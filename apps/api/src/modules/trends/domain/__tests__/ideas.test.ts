import {
  newId,
  normaliseWords,
  TrendSignalIdSchema,
  type ContentIdeaDraft,
  type PersonaLimits,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { filterIdeas, tooClose, type IdeaFilterContext } from '../ideas';

/** A creator invented for the tests (ADR 0010): her limits, nothing else. */
const LIMITS: PersonaLimits = {
  never_do: ['plan à trois'],
  never_show: ['visage'],
  never_say: ['mon adresse'],
  disgusts: ['pieds'],
};

// A plain whole-word reading, enough for the domain: the application hands the agent's `touchesTerm`.
const touches = (text: string, term: string) =>
  ` ${normaliseWords(text)} `.includes(` ${normaliseWords(term)} `);

const live = newId(TrendSignalIdSchema);
const other = newId(TrendSignalIdSchema);

const idea = (values: Partial<ContentIdeaDraft> = {}): ContentIdeaDraft => ({
  title: 'Transition miroir avant sortie',
  category: 'instagram_reel',
  toShoot: 'Deux plans devant le miroir, tenue de jour puis tenue de soirée, sur le son du moment.',
  signalId: live,
  reason: 'Le format monte cette semaine.',
  shootMinutes: 20,
  ...values,
});

const context = (values: Partial<IdeaFilterContext> = {}): IdeaFilterContext => ({
  limits: LIMITS,
  touches,
  recent: [],
  refused: [],
  liveSignals: new Set([live, other]),
  ...values,
});

const reasons = (candidates: ContentIdeaDraft[], ctx: IdeaFilterContext) =>
  filterIdeas(candidates, ctx).dropped.map(({ drop }) => drop.reason);

describe('the code’s filters on the morning ideas (ADR 0060 § 4)', () => {
  it('keeps an idea that passes them all', () => {
    expect(filterIdeas([idea()], context()).kept).toEqual([idea()]);
  });

  it('drops an idea that touches one of her limits, and says which', () => {
    const touching = idea({ toShoot: 'Gros plan sur les pieds au réveil.' });
    expect(filterIdeas([touching], context()).dropped).toEqual([
      { idea: touching, drop: { reason: 'limit', term: 'pieds' } },
    ]);
    expect(reasons([idea({ title: 'Mon visage au réveil' })], context())).toEqual(['limit']);
  });

  it('drops everything without an active persona', () => {
    expect(reasons([idea()], context({ limits: null }))).toEqual(['no_persona']);
  });

  it('drops an idea that cites no live signal', () => {
    expect(reasons([idea({ signalId: newId(TrendSignalIdSchema) })], context())).toEqual(['no_live_signal']);
  });

  it('never proposes again an idea close to one refused, whatever its date', () => {
    expect(reasons([idea()], context({ refused: [idea({ signalId: other })] }))).toEqual(['refused_before']);
  });

  it('drops an idea too close to one of the last 30 days, or to one kept before it today', () => {
    expect(
      reasons([idea()], context({ recent: [idea({ title: 'Autre titre', toShoot: 'Autre chose' })] })),
    ).toEqual(['too_close']);
    expect(reasons([idea(), idea({ signalId: other })], context())).toEqual(['too_close']);
  });

  it('says « jamais de nu » for a public output only', () => {
    const nude = { toShoot: 'Une photo topless de dos, lumière douce.' };
    expect(reasons([idea(nude)], context())).toEqual(['nudity']);
    expect(reasons([idea({ ...nude, category: 'feed_shoot' })], context())).toEqual(['nudity']);
    expect(filterIdeas([idea({ ...nude, category: 'script' })], context()).kept).toHaveLength(1);
  });

  it('holds the Instagram guard for an Instagram output only', () => {
    const priced = { toShoot: 'Annonce du pack à 15 € avec le lien en bio.' };
    expect(reasons([idea(priced)], context())).toEqual(['instagram_guard']);
    expect(filterIdeas([idea({ ...priced, category: 'mass_dm' })], context()).kept).toHaveLength(1);
  });

  it('keeps three ideas a day at most', () => {
    const four: ContentIdeaDraft[] = [
      idea({ title: 'Café du matin', toShoot: 'tasse fumante', category: 'instagram_reel' }),
      idea({ title: 'Balade en forêt', toShoot: 'feuilles mortes', category: 'instagram_post' }),
      idea({ title: 'Recette de crêpes', toShoot: 'poêle chaude', category: 'feed_video' }),
      idea({ title: 'Séance de yoga', toShoot: 'tapis violet', category: 'instagram_story' }),
    ];
    const { kept, dropped } = filterIdeas(four, context());
    expect(kept).toHaveLength(3);
    expect(dropped.map(({ drop }) => drop.reason)).toEqual(['over_daily_cap']);
  });
});

describe('« trop proche »', () => {
  it('is the same category and signal, or most words shared', () => {
    expect(tooClose(idea(), idea({ title: 'X', toShoot: 'Y' }))).toBe(true);
    expect(tooClose(idea(), idea({ category: 'instagram_post', signalId: other }))).toBe(true);
    expect(
      tooClose(
        idea(),
        idea({ category: 'instagram_post', signalId: other, title: 'Café', toShoot: 'Tasse' }),
      ),
    ).toBe(false);
  });
});
