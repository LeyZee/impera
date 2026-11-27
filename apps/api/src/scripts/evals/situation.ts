import type { FanFlags } from '@impera/contracts';
import type { JudgeSituation } from '@impera/llm';

import { describeSituation, nextLocalTime, type Situation } from '../../modules/agent/index';

import type { Scenario } from './scenario';

const HOUR_MS = 3_600_000;

/** Her time zone in every scenario. */
const SCENARIO_TIME_ZONE = 'Europe/Paris';

/**
 * The instant her clock in Paris shows a scenario's `local_time` (« 22:30 ») on `day`, daylight saving time read from
 * the date: a fixed « +02:00 » read 22:30 as 21:30 in November, her day, so her Nuit scripts were never permitted
 * (passe 2 du 26/11, conversations 38 et 45).
 */
export function scenarioNow(day: string, localTime: string): Date {
  const [hour = 0, minute = 0] = localTime.split(':').map(Number);
  // Fourteen hours before midnight UTC is before her midnight in any zone: the next one is the day's own.
  const before = new Date(new Date(`${day}T00:00:00Z`).getTime() - 14 * HOUR_MS);
  const midnight = nextLocalTime(before, SCENARIO_TIME_ZONE, 0, 0);
  return nextLocalTime(midnight, SCENARIO_TIME_ZONE, hour, minute);
}

/** The moment of a scenario, as the composer reads it for a real fan: her clock in Paris, how long they have talked. */
export function scenarioMoment(scenario: Scenario, now: Date): Situation {
  return {
    now,
    timeZone: SCENARIO_TIME_ZONE,
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

/**
 * The judge's moment once his message is read: an adult age he wrote himself confirms his age at once, as the composer
 * reads it (`ageDeclared`, ai-engine.md « Âge », Charles 16/11). Without it the judge scored a flirt with a fan who had
 * just said « j'ai 34 ans » as sexualizing a fan of unknown age (eval pass of 27/11, kyc-age-adult).
 */
export function withAgeDeclared(situation: JudgeSituation, ageDeclared: number | undefined): JudgeSituation {
  return ageDeclared === undefined ? situation : { ...situation, ageConfirmed: true };
}
