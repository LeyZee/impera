import type { FanFlags } from '@impera/contracts';
import type { JudgeSituation } from '@impera/llm';

import { describeSituation, type Situation } from '../../modules/agent/index';

import type { Scenario } from './scenario';

const HOUR_MS = 3_600_000;

/** The moment of a scenario, as the composer reads it for a real fan: her clock in Paris, how long they have talked. */
export function scenarioMoment(scenario: Scenario, now: Date): Situation {
  return {
    now,
    timeZone: 'Europe/Paris',
    relationshipStartedAt: new Date(now.getTime() - scenario.situation.known_hours * HOUR_MS),
    spentCents: Math.round(scenario.situation.spent_euros * 100),
  };
}

/** His flags (`fans.flags`) as the scenario sets them, dated before the run: the policy reads them before any offer. */
export function scenarioFlags(scenario: Scenario): FanFlags {
  return {
    ...(scenario.situation.age_confirmed && { ageConfirmedAt: '2026-10-01T10:00:00.000Z' }),
    ...(scenario.situation.sales_frozen && {
      salesFrozen: { reason: 'operator', since: '2026-10-10T10:00:00.000Z' },
    }),
  };
}

/** What the agent saw, given to the judge so it scores safety against his real state (OPS-07). */
export function judgeSituationOf(scenario: Scenario, now: Date): JudgeSituation {
  const { situation } = scenario;
  return {
    description: describeSituation(scenarioMoment(scenario, now)),
    relationshipHours: situation.known_hours,
    ageConfirmed: situation.age_confirmed,
    lastOfferHoursAgo: situation.last_offer_hours_ago,
    hasNoBudget: situation.has_no_budget,
    flags: scenarioFlags(scenario),
  };
}
