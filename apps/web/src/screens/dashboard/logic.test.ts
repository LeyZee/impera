import { describe, expect, it } from 'vitest';

import {
  chartTip,
  changePercent,
  eur,
  gaugeClass,
  agentRuns,
  foldOf,
  heroState,
  hoursMinutes,
  leverView,
  litParts,
  sharePercent,
  signed,
  trendSeries,
} from './logic';
import type { AgentCard, AgentState, Lever, Todo } from './model';

const agent: AgentState = {
  tone: 'warn',
  eyebrow: '3 conversations',
  headline: 'ignored',
  lead: 'Un fan est peut-être mineur.',
  action: 'Voir l’urgence',
  foldTitle: '',
  foldSummary: '',
  cards: [],
};
const todo = (id: string, tone: Todo['tone']): Todo => ({
  id,
  tone,
  kind: 'k',
  title: 't',
  why: 'w',
  waiting: 'depuis 3 min',
  late: false,
  at: 'Reçu à 23 h 00',
  conversationId: `c-${id}`,
});
const lever = (id: Lever['id'], current: number, previous: number): Lever => ({
  id,
  label: '',
  current,
  previous,
  tip: ['', ''],
});

describe('formatting', () => {
  it('writes euros, durations and signs the French way', () => {
    expect(eur(1846).replace(/\s/gu, ' ')).toBe('1 846 €');
    // The cents are never rounded away: 10,50 € is not 11 €.
    expect(eur(10.5)).toBe('10,50 €');
    expect(eur(1846.4).replace(/\s/gu, ' ')).toBe('1 846,40 €');
    expect(hoursMinutes(125)).toBe('2 h 05');
    expect(hoursMinutes(-3)).toBe('0 h 00');
    expect(signed(12)).toBe('+12');
    expect(signed(-6)).toBe('−6');
    expect(signed(0)).toBe('0');
  });

  it('computes changes and shares without dividing by zero', () => {
    expect(changePercent(412, 351)).toBe(17);
    expect(changePercent(10, 0)).toBe(0);
    expect(sharePercent(412, 186)).toBe(69);
    expect(sharePercent(0, 0)).toBe(0);
  });

  it('splits the lit part of a sentence', () => {
    expect(litParts('**3 choses** t’attendent')).toEqual([
      { text: '3 choses', lit: true },
      { text: ' t’attendent', lit: false },
    ]);
  });
});

describe('leverView', () => {
  it('moves a rate in points and a count of fans in fans, fewer blocked being better', () => {
    expect(leverView(lever('first-offer-bought', 31, 34))).toMatchObject({ delta: '−3 pts', better: false });
    expect(leverView(lever('blocked-at-payment', 4, 6))).toMatchObject({
      unit: 'fans',
      delta: '−2',
      better: true,
    });
  });

  it('judges the time before the first offer against 2 h 30, give or take 20 min', () => {
    expect(leverView(lever('time-to-first-offer', 140, 200))).toMatchObject({
      value: '2 h 20',
      delta: 'repère 2 h 30',
      better: true,
    });
    expect(leverView(lever('time-to-first-offer', 60, 150)).better).toBe(false);
  });
});

describe('trendSeries', () => {
  it('runs from the value before to the current one', () => {
    const trend = trendSeries(34, 31, 1);
    expect(trend).toHaveLength(12);
    expect(trend[0]).toBe(34);
    expect(trend[11]).toBe(31);
  });
});

describe('chartTip', () => {
  const series = { labels: ['0 h', '1 h'], agent: [10, 30], chatters: [10, 10], past: [5, 25] };
  it('compares with yesterday on the day view, gives the agent’s share otherwise', () => {
    expect(chartTip('day', series, 1)).toMatchObject({ title: 'De 0 h à 1 h' });
    expect(chartTip('day', series, 1).footer).toMatch(/^Agent hier à la même heure/u);
    expect(chartTip('week', series, 1).footer).toBe('75 % vendu par l’agent');
  });
});

describe('gaugeClass', () => {
  it('turns a spend amber at 70 % and neon at 90 %, a rate amber until it is ok', () => {
    expect(gaugeClass('spend', 37, 'ok')).toBe('');
    expect(gaugeClass('spend', 75, 'ok')).toBe('nv-gauge--amber');
    expect(gaugeClass('spend', 95, 'ok')).toBe('nv-gauge--neon');
    expect(gaugeClass('rate', 64, 'warn')).toBe('nv-gauge--amber');
  });
});

describe('agentRuns', () => {
  it('says the agent acts only when nothing stalls it, whatever the mode', () => {
    expect(agentRuns({ tone: 'ok' })).toBe(true);
    expect(agentRuns({ tone: 'warn' })).toBe(true);
    expect(agentRuns({ tone: 'warn', stalled: true })).toBe(false);
    expect(agentRuns({ tone: 'idle' })).toBe(false);
    expect(agentRuns({ tone: 'bad' })).toBe(false);
  });
});

describe('heroState', () => {
  it('says the agent is stopped before anything else', () => {
    const hero = heroState(agent, [todo('a', 'bad')], 'stop');
    expect(hero).toMatchObject({ tone: 'bad', action: 'Repasser en copilote' });
    expect(hero.headline).toContain('**arrêté**');
  });

  it('says on Arrêt that the grave lines still wait (choix de Charles, 28/10)', () => {
    expect(heroState(agent, [todo('a', 'bad')], 'stop').lead).toContain('Une urgence reste à traiter');
    expect(heroState(agent, [todo('a', 'bad'), todo('b', 'bad')], 'stop').lead).toContain(
      '2 urgences restent à traiter',
    );
    expect(heroState(agent, [], 'stop').lead).toContain('Les chatteurs gardent la main dans Reveal');
  });

  it('is calm when nothing waits', () => {
    expect(heroState(agent, [], 'copilot')).toMatchObject({ tone: 'ok' });
    expect(heroState(agent, [], 'copilot').action).toBeUndefined();
  });

  it('counts what waits and offers the action only when one is urgent', () => {
    expect(heroState(agent, [todo('a', 'warn')], 'copilot')).toMatchObject({
      headline: '**Une chose** t’attend',
    });
    expect(heroState(agent, [todo('a', 'warn')], 'copilot').action).toBeUndefined();
    expect(heroState(agent, [todo('a', 'bad'), todo('b', 'warn')], 'copilot')).toMatchObject({
      headline: '**2 choses** t’attendent, dont une urgente',
      action: 'Voir l’urgence',
    });
  });

  it('names urgencies as such when nothing else waits, and counts them', () => {
    expect(heroState(agent, [todo('a', 'bad')], 'copilot').headline).toBe('**Une urgence** t’attend');
    expect(heroState(agent, [todo('a', 'bad'), todo('b', 'bad')], 'copilot').headline).toBe(
      '**2 urgences** t’attendent',
    );
    expect(
      heroState(agent, [todo('a', 'bad'), todo('b', 'bad'), todo('c', 'warn')], 'copilot').headline,
    ).toBe('**3 choses** t’attendent, dont 2 urgentes');
  });

  it('keeps the sentence of an agent in trouble', () => {
    const broken: AgentState = { ...agent, tone: 'bad', headline: 'Reveal est **déconnecté**' };
    expect(heroState(broken, [], 'copilot').headline).toBe('Reveal est **déconnecté**');
  });
});

describe('heroState and the budget, the global stop', () => {
  it('says the AI budget past its alert in the hero, calm or not (DASH-06)', () => {
    const spending: AgentState = {
      ...agent,
      tone: 'ok',
      budgetNote: 'À 18,62 € sur 20 €, l’agent s’arrêtera bientôt.',
    };
    expect(heroState(spending, [], 'copilot').lead).toContain('À 18,62 € sur 20 €');
    expect(heroState(spending, [todo('a', 'warn')], 'copilot').lead).toContain('À 18,62 € sur 20 €');
    expect(heroState({ ...agent, tone: 'ok' }, [], 'copilot').lead).toContain('Les alertes arrivent ici');
  });

  it('says why under a global stop, in the hero (DASH-08)', () => {
    const hero = heroState(agent, [todo('a', 'bad')], 'stop', { globalStop: true });
    expect(hero.lead).toContain('Un arrêt général est posé pour toutes les créatrices');
    expect(hero.lead).toContain('Une urgence reste à traiter');
    expect(heroState(agent, [], 'stop').lead).not.toContain('arrêt général');
  });
});

describe('foldOf', () => {
  const card = (id: string, tone: AgentCard['tone'], alarm?: string): AgentCard => ({
    id,
    tone,
    title: id,
    value: '',
    sub: '',
    rows: [],
    ...(alarm === undefined ? {} : { alarm }),
  });
  const running: AgentState = { ...agent, tone: 'warn', foldTitle: 'L’agent fonctionne normalement' };

  it('follows the worst card that can alarm, never « normalement » over amber (DASH-06)', () => {
    const fold = foldOf(
      {
        ...running,
        cards: [card('relays', 'warn'), card('budget', 'warn', 'Le budget IA approche du plafond')],
      },
      false,
      false,
    );
    expect(fold).toEqual({ tone: 'warn', title: 'Le budget IA approche du plafond', live: false });
    expect(foldOf({ ...running, cards: [card('relays', 'warn')] }, false, false)).toMatchObject({
      tone: 'ok',
      title: 'L’agent fonctionne normalement',
    });
    expect(foldOf({ ...running, cards: [] }, true, false).title).toBe('Le reste fonctionne normalement');
  });

  it('keeps the agent’s own trouble, and tells a creator the agency handles it (DASH-21)', () => {
    const broken: AgentState = { ...agent, tone: 'bad', foldTitle: 'Quelque chose ne va pas' };
    expect(foldOf(broken, false, false)).toEqual({
      tone: 'bad',
      title: 'Quelque chose ne va pas',
      live: true,
    });
    expect(foldOf(broken, false, true).title).toBe('L’agence s’en occupe');
  });
});

describe('heroState for a creator', () => {
  it('names no conversation and offers no action, whatever waits', () => {
    const hero = heroState(agent, [todo('a', 'bad')], 'copilot', { forCreator: true });
    expect(hero).toMatchObject({ tone: 'ok', headline: 'Tout va bien. **Rien ne t’attend.**' });
    expect(hero.action).toBeUndefined();
    expect(hero.lead).toContain('L’agence suit les conversations');
  });

  it('leaves a stopped agent to the agency', () => {
    const hero = heroState(agent, [], 'stop', { forCreator: true });
    expect(hero.headline).toBe('L’agent est **arrêté**');
    expect(hero.action).toBeUndefined();
  });
});
