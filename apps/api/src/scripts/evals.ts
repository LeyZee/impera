/**
 * `pnpm evals`: every scenario of `evals/` through the production path (brain, policy, voice, hard guards), then the
 * judge on what she wrote. Fails unless every scenario passes its own checks and each criterion reaches its
 * threshold (`evals/thresholds.json`). Nothing is sent, the persona is the fictional demo one (ADR 0010).
 * Usage: `pnpm evals [--full] [--file evals/adversarial/asks-if-bot.yaml]` (the path from the repository root) (LLM_XAI_API_KEY in the environment).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { desireBandOf } from '@nirvana/contracts';
import {
  brainAlertId,
  createInMemoryCallLog,
  createLlmGateway,
  createModelResolver,
  DEFAULT_LLM_CONFIG,
  JudgeCriterionSchema,
  readProviderCredentials,
  type ConversationTurn,
} from '@nirvana/llm';

import {
  composeTurn,
  guardSettingsOf,
  holdDecision,
  measureDesire,
  readPersonaFile,
} from '../modules/agent/index';

import { checkScenario, judgeSuite, type Outcome, type ScenarioResult } from './evals/check';
import { EVALS_CAP_EUR, evalsConfig } from './evals/judge-model';
import { readScenario, ThresholdsSchema, type Scenario } from './evals/scenario';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const EVALS = resolve(ROOT, 'evals');
const SUITES = ['scenarios', 'adversarial', 'regression'] as const;
const HOUR_MS = 3_600_000;

const { values } = parseArgs({
  // pnpm forwards a bare `--` through each script hop.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { full: { type: 'boolean', default: false }, file: { type: 'string' } },
});
const credentials = readProviderCredentials(process.env);
if (credentials.LLM_XAI_API_KEY === undefined) {
  console.error('evals: no LLM_XAI_API_KEY in the environment, nothing can be measured.');
  process.exit(1);
}
const tier = ThresholdsSchema.parse(JSON.parse(readFileSync(resolve(EVALS, 'thresholds.json'), 'utf8')))[
  values.full ? 'full' : 'smoke'
];

const files =
  values.file === undefined
    ? SUITES.flatMap((suite) => {
        let names: string[];
        try {
          names = readdirSync(resolve(EVALS, suite));
        } catch {
          names = [];
        }
        return names.filter((name) => /\.ya?ml$/.test(name)).map((name) => resolve(EVALS, suite, name));
      })
    : [resolve(ROOT, values.file)];

const today = '2026-10-20';
const persona = readPersonaFile(
  readFileSync(resolve(ROOT, 'personas/demo/v0.2.0.yaml'), 'utf8'),
  'Elena',
  today,
);
const { config, isIndependent } = evalsConfig(DEFAULT_LLM_CONFIG, credentials);
const gateway = createLlmGateway({
  config,
  credentials,
  resolveModel: createModelResolver(credentials),
  log: createInMemoryCallLog(),
  // Its own cap: an eval run never eats into the fans' day, and stops at a few euros.
  dailyCapEur: () => EVALS_CAP_EUR,
});
console.log(
  `Juge : ${config.roles.judge.provider} ${config.roles.judge.model}` +
    (isIndependent
      ? ''
      : ' (même fournisseur que la voix : notes à lire avec ce biais, voir evals/README.md)'),
);
const criteria = JudgeCriterionSchema.options;

/** One scenario, on the path a real fan's message takes; nothing leaves. */
async function run(scenario: Scenario): Promise<{ outcome: Outcome; scores: Record<string, number> }> {
  const { situation } = scenario;
  // Paris in October is UTC+2: her local time as the scenario says.
  const now = new Date(`${today}T${situation.local_time}:00+02:00`);
  const inbound = Array.isArray(scenario.inbound) ? scenario.inbound : [scenario.inbound];
  const history: ConversationTurn[] = [
    ...scenario.history,
    ...inbound.map((text): ConversationTurn => ({ from: 'fan', text })),
  ];
  // Her alerts as the composer gives them: short ids, in her order (P4-01).
  const alerts = scenario.alerts.map(({ name, phrase }, index) => ({
    name,
    id: brainAlertId(index),
    phrase,
  }));
  const composed = await composeTurn(
    gateway,
    {
      creatorName: persona.creatorName,
      personaSheet: persona.personaSheet,
      guardSettings: guardSettingsOf(persona),
      splitMessages: persona.splitMessages,
    },
    {
      history,
      fanText: inbound.join('\n'),
      media: [],
      fanNotes: scenario.fan_facts.join('\n'),
      situation: {
        now,
        timeZone: 'Europe/Paris',
        relationshipStartedAt: new Date(now.getTime() - situation.known_hours * HOUR_MS),
        spentCents: Math.round(situation.spent_euros * 100),
      },
      // The policy decides on the brain's offer, as for a real fan: refused, the voice writes a plain answer.
      offer: {
        now,
        lastOfferAt:
          situation.last_offer_hours_ago === null
            ? null
            : new Date(now.getTime() - situation.last_offer_hours_ago * HOUR_MS),
        hasNoBudget: situation.has_no_budget,
        flags: {
          ...(situation.age_confirmed && { ageConfirmedAt: '2026-10-01T10:00:00.000Z' }),
          ...(situation.sales_frozen && {
            salesFrozen: { reason: 'operator', since: '2026-10-10T10:00:00.000Z' },
          }),
        },
        limits: persona.offerLimits,
      },
      sexualization: {
        limits: persona.sexualizationLimits,
        ageConfirmed: situation.age_confirmed,
        noExplicit: false,
      },
      // His score as stored just before; no clock per message here, so his reply speed is not measured.
      desire: {
        previous: { score: situation.desire, at: now },
        measured: {
          ...measureDesire(
            history.map((turn) => ({ fromFan: turn.from === 'fan', text: turn.text, at: now })),
          ),
          replySeconds: null,
        },
        ageDisputed: false,
        counted: false,
      },
      skipVoice: (brief) => brief === undefined || holdDecision(brief).kind !== 'answer',
      ...(alerts.length > 0 && { alerts: alerts.map(({ id, phrase }) => ({ id, phrase })) }),
    },
  );
  const { brief } = composed;
  const handoff =
    composed.handoff !== undefined || (brief !== undefined && holdDecision(brief).kind === 'handoff');
  const offer = composed.voiceBrief?.action === 'offer';
  const blocking = composed.violations.filter((v) => v.severity === 'blocking').map((v) => v.code);
  const bubbles = handoff || composed.isBlocked ? [] : composed.bubbles;
  const outcome: Outcome = {
    ...(brief !== undefined && {
      brief: {
        intent: brief.intent,
        risks: brief.risks,
        action: brief.action,
        ...(brief.desireSignals !== undefined && { desireSignals: brief.desireSignals }),
        alertsSeen: alerts.filter((a) => brief.alertsSeen?.includes(a.id) === true).map((a) => a.name),
      },
    }),
    handoff,
    offer,
    desireBand: desireBandOf(composed.desire?.score ?? situation.desire),
    bubbles: composed.bubbles,
    blocking,
  };
  const scores: Record<string, number> = {};
  if (bubbles.length > 0) {
    const judged = await gateway.judge({
      creatorName: persona.creatorName,
      personaSheet: persona.personaSheet,
      fanNotes: scenario.fan_facts.join('\n'),
      history,
      reply: bubbles,
      criteria,
    });
    if (judged.ok) for (const { criterion, score } of judged.value.output.scores) scores[criterion] = score;
  }
  return { outcome, scores };
}

const results: ScenarioResult[] = [];
const minima = new Map<string, Readonly<Record<string, number>>>();
let isCapReached = false;
for (const path of files) {
  const file = relative(EVALS, path);
  if (gateway.health().budget.state === 'reached') {
    isCapReached = true;
    break;
  }
  let scenario: Scenario;
  try {
    scenario = readScenario(readFileSync(path, 'utf8'));
  } catch (error) {
    results.push({
      file,
      failures: [`fichier illisible : ${error instanceof Error ? error.message : 'erreur'}`],
      scores: {},
    });
    continue;
  }
  if (scenario.tier === 'full' && !values.full && values.file === undefined) continue;
  minima.set(file, scenario.expect.voice?.judge ?? {});
  const { outcome, scores } = await run(scenario);
  const failures = checkScenario(scenario, outcome);
  // A written answer nobody scored is not a pass.
  if (outcome.bubbles.length > 0 && !outcome.handoff && Object.keys(scores).length === 0) {
    failures.push('le juge n’a pas répondu');
  }
  results.push({ file, failures, scores });
  const mark = failures.length === 0 ? 'ok ' : 'KO ';
  console.log(`${mark} ${file}`);
  for (const bubble of outcome.bubbles) console.log(`      « ${bubble} »`);
  for (const failure of failures) console.log(`      ✗ ${failure}`);
  const noted = Object.entries(scores).map(([c, s]) => `${c} ${s.toFixed(2)}`);
  if (noted.length > 0) console.log(`      ${noted.join(' · ')}`);
}

if (isCapReached) {
  console.error(
    `\nevals : plafond de ${String(EVALS_CAP_EUR)} € atteint, suite arrêtée après ${String(results.length)} scénarios.`,
  );
}
const report = judgeSuite(results, values.file === undefined ? tier : { ...tier, min_scenarios: 1 }, minima);
const means = Object.entries(report.means);
if (means.length > 0)
  console.log(`\nMoyennes : ${means.map(([c, m]) => `${c} ${m.toFixed(2)}`).join(' · ')}`);
if (!report.isPassing || isCapReached) {
  console.error(`\nevals ${values.full ? 'full' : 'smoke'} : en échec`);
  for (const problem of report.problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`\nevals ${values.full ? 'full' : 'smoke'} : ${String(results.length)} scénarios, tout passe.`);
