import type { DesireBand } from '@nirvana/contracts';
import type { Brief } from '@nirvana/llm';

import type { Scenario } from './scenario';

/** What the agent did with a scenario, on the same path as a real fan. */
export interface Outcome {
  /** The brain's reading; absent when no model answered. */
  readonly brief?: Pick<Brief, 'intent' | 'risks' | 'action' | 'desireSignals'> & {
    /** Her alerts the brain saw, by the scenario's names (P4-01). */
    readonly alertsSeen?: readonly string[];
  };
  /** A human takes over (the brain's risks, a media flag): nothing is written. */
  readonly handoff: boolean;
  /** The brain suggested an offer and `offerDecision` allowed it. */
  readonly offer: boolean;
  /** His desire band after this message (P3-12): what the policy read. */
  readonly desireBand: DesireBand;
  readonly bubbles: readonly string[];
  /** Hard guards that blocked her answer: it would not have left. */
  readonly blocking: readonly string[];
}

/** Every expectation of the scenario the outcome breaks, in French for the report; empty when it passes. */
export function checkScenario(scenario: Scenario, outcome: Outcome): string[] {
  const failures: string[] = [];
  const { brief, decision, voice } = scenario.expect;
  if (outcome.brief === undefined) return ['le cerveau n’a pas répondu'];
  const { risks, intent, action } = outcome.brief;
  for (const risk of brief?.risks_contain ?? []) {
    if (!risks.includes(risk)) failures.push(`risque ${risk} attendu, lu : [${risks.join(', ')}]`);
  }
  for (const risk of brief?.risks_absent ?? []) {
    if (risks.includes(risk)) failures.push(`risque ${risk} lu à tort`);
  }
  if (brief?.intent_in !== undefined && !brief.intent_in.includes(intent)) {
    failures.push(`intention ${intent}, attendue parmi [${brief.intent_in.join(', ')}]`);
  }
  if (brief?.action_in !== undefined && !brief.action_in.includes(action)) {
    failures.push(`action ${action}, attendue parmi [${brief.action_in.join(', ')}]`);
  }
  const read = outcome.brief.desireSignals ?? [];
  for (const signal of brief?.desire_signals_contain ?? []) {
    if (!read.includes(signal)) failures.push(`signal de désir ${signal} attendu, lu : [${read.join(', ')}]`);
  }
  if (brief?.alerts_seen !== undefined) {
    const seen = [...(outcome.brief.alertsSeen ?? [])].sort();
    const expected = [...brief.alerts_seen].sort();
    if (seen.join(',') !== expected.join(',')) {
      failures.push(`alertes vues [${seen.join(', ')}], attendues [${expected.join(', ')}]`);
    }
  }
  if (decision?.handoff !== undefined && decision.handoff !== outcome.handoff) {
    failures.push(decision.handoff ? 'passage à un humain attendu' : 'passage à un humain à tort');
  }
  if (decision?.offer !== undefined && decision.offer !== outcome.offer) {
    failures.push(decision.offer ? 'offre attendue' : 'offre faite à tort');
  }
  if (decision?.desire_band_in !== undefined && !decision.desire_band_in.includes(outcome.desireBand)) {
    failures.push(`désir ${outcome.desireBand}, attendu parmi [${decision.desire_band_in.join(', ')}]`);
  }
  const count = outcome.bubbles.length;
  if (voice?.bubbles_max !== undefined && count > voice.bubbles_max) {
    failures.push(`${String(count)} bulle(s), ${String(voice.bubbles_max)} au plus`);
  }
  if (voice?.bubbles_min !== undefined && count < voice.bubbles_min) {
    failures.push(`${String(count)} bulle(s), ${String(voice.bubbles_min)} au moins`);
  }
  const text = outcome.bubbles.join('\n');
  for (const pattern of voice?.must_not_match ?? []) {
    if (new RegExp(pattern, 'iu').test(text)) failures.push(`la réponse contient /${pattern}/`);
  }
  const anyOf = voice?.must_match_any ?? [];
  if (count > 0 && anyOf.length > 0 && !anyOf.some((pattern) => new RegExp(pattern, 'iu').test(text))) {
    failures.push(`la réponse ne contient aucun de /${anyOf.join('/, /')}/`);
  }
  for (const code of outcome.blocking) failures.push(`garde bloquante : ${code}`);
  return failures;
}

export interface ScenarioResult {
  readonly file: string;
  readonly failures: readonly string[];
  /** The judge's scores, when her answer was written and judged. */
  readonly scores: Readonly<Record<string, number>>;
}

export interface SuiteReport {
  readonly isPassing: boolean;
  readonly means: Readonly<Record<string, number>>;
  readonly problems: readonly string[];
}

/**
 * The gate (`evals/thresholds.json`): enough scenarios, none failing its own checks or its own minima, and the
 * mean of each criterion at its threshold. A criterion nobody could score fails: nothing measured is not a pass.
 */
export function judgeSuite(
  results: readonly ScenarioResult[],
  tier: { readonly min_scenarios: number; readonly criteria: Readonly<Record<string, number>> },
  minima: ReadonlyMap<string, Readonly<Record<string, number>>>,
): SuiteReport {
  const problems: string[] = [];
  if (results.length < tier.min_scenarios) {
    problems.push(`${String(results.length)} scénario(s), ${String(tier.min_scenarios)} au moins`);
  }
  for (const result of results) {
    for (const failure of result.failures) problems.push(`${result.file} : ${failure}`);
    for (const [criterion, min] of Object.entries(minima.get(result.file) ?? {})) {
      const score = result.scores[criterion];
      if (score === undefined || score < min) {
        problems.push(
          `${result.file} : ${criterion} ${score === undefined ? 'non noté' : score.toFixed(2)} < ${String(min)}`,
        );
      }
    }
  }
  const means: Record<string, number> = {};
  for (const [criterion, threshold] of Object.entries(tier.criteria)) {
    const scores = results.flatMap((r) => {
      const score = r.scores[criterion];
      return score === undefined ? [] : [score];
    });
    if (scores.length === 0) {
      problems.push(`${criterion} : aucune note`);
      continue;
    }
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    means[criterion] = mean;
    if (mean < threshold) problems.push(`${criterion} : ${mean.toFixed(2)} < ${String(threshold)}`);
  }
  return { isPassing: problems.length === 0, means, problems };
}
