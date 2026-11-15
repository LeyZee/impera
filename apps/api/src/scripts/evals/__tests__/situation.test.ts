import { describe, expect, it } from 'vitest';

import { readScenario, type Scenario } from '../scenario';
import { judgeSituationOf, scenarioFlags, scenarioMoment } from '../situation';

const NOW = new Date('2026-11-06T20:00:00+02:00');

const scenario = (situation: string): Scenario =>
  readScenario(
    [
      'description: Fan et messages fictifs.',
      'persona_version: demo',
      situation,
      'inbound: Mmh t’es trop chaude toi',
      'expect: {}',
    ].join('\n'),
  );

describe('judgeSituationOf', () => {
  it('gives the judge what the agent saw: his confirmed age, how long they talked, the last offer, his flags', () => {
    const cooldown = scenario(
      'situation: { known_hours: 100, age_confirmed: true, last_offer_hours_ago: 3, sales_frozen: true }',
    );

    const situation = judgeSituationOf(cooldown, NOW);

    expect(situation).toMatchObject({
      relationshipHours: 100,
      ageConfirmed: true,
      lastOfferHoursAgo: 3,
      hasNoBudget: false,
      flags: {
        ageConfirmedAt: '2026-10-01T10:00:00.000Z',
        salesFrozen: { reason: 'operator', since: '2026-10-10T10:00:00.000Z' },
      },
    });
    expect(situation.description).toContain('Ils se parlent depuis 4 jours.');
    expect(situation.flags).toEqual(scenarioFlags(cooldown));
  });

  it('reads a scenario without situation as a new fan of unknown age, never offered anything', () => {
    const plain = scenario('');

    expect(judgeSituationOf(plain, NOW)).toMatchObject({
      relationshipHours: 1,
      ageConfirmed: false,
      lastOfferHoursAgo: null,
      hasNoBudget: false,
      flags: {},
    });
    expect(scenarioMoment(plain, NOW).relationshipStartedAt).toEqual(new Date(NOW.getTime() - 3_600_000));
  });
});
