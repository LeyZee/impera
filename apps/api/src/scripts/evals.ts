/**
 * `pnpm evals`: every scenario of `evals/` through the production path (brain, policy, voice, hard guards), then the
 * judge on what she wrote. Fails unless every scenario passes its own checks and each criterion reaches its
 * threshold (`evals/thresholds.json`). Nothing is sent. The persona is the fictional demo one (ADR 0010), or with
 * `--persona-from-crm` her active version read from the database, which stays on that machine (OPS-11).
 * Each scenario is drawn `--draws` times (3 by default) and fails if any draw fails (OPS-11).
 * Usage: `pnpm evals [--full] [--draws 3] [--file evals/adversarial/asks-if-bot.yaml] [--persona-from-crm
 * [--creator <id>]]` (the path from the repository root), with
 * LLM_XAI_API_KEY in the environment, or `--key-from-crm`: the keys saved in Réglages › Modèles IA of the database
 * DATABASE_ADMIN_URL names, opened with CREDENTIALS_ENCRYPTION_KEYS (`readSavedProviderKeys`), kept in memory only.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  AiProviderSchema,
  CreatorIdSchema,
  desireBandOf,
  MessageIdSchema,
  newId,
  StoredPersonaSchema,
} from '@impera/contracts';
import { createDbClient, eq, parseEncryptionKeys, schema } from '@impera/db';
import {
  brainAlertId,
  createInMemoryCallLog,
  createLlmGateway,
  createModelResolver,
  DEFAULT_LLM_CONFIG,
  JudgeCriterionSchema,
  PROVIDERS,
  readProviderCredentials,
  type ConversationTurn,
} from '@impera/llm';
import { z } from 'zod';

import { READ_ONLY_POOL_OPTIONS } from '../key-check';
import {
  activePersonaForModels,
  composeTurn,
  guardSettingsOf,
  holdDecision,
  measureDesire,
  readPersonaFile,
  type PersonaForModels,
} from '../modules/agent/index';
import { proposalsOfRead } from '../modules/fans/index';
import { readSavedProviderKeys } from '../modules/providers/index';

import { checkCardScenario, readCardScenario, type CardScenario } from './evals/card-scenario';
import { checkScenario, judgeSuite, type Outcome, type ScenarioResult } from './evals/check';
import { DEFAULT_DRAWS, mergeDraws, type Draw } from './evals/draws';
import { EVALS_CAP_EUR, evalsConfig } from './evals/judge-model';
import { readScenario, ThresholdsSchema, type Scenario } from './evals/scenario';
import { judgeSituationOf, scenarioFlags, scenarioMoment } from './evals/situation';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const EVALS = resolve(ROOT, 'evals');
const SUITES = ['scenarios', 'adversarial', 'regression'] as const;
/** His card read in his messages (ADR 0085 § 7): its own scenarios, checked without the judge. */
const CARD_SUITE = 'card';
const HOUR_MS = 3_600_000;

const { values } = parseArgs({
  // pnpm forwards a bare `--` through each script hop.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    full: { type: 'boolean', default: false },
    file: { type: 'string' },
    'key-from-crm': { type: 'boolean', default: false },
    'persona-from-crm': { type: 'boolean', default: false },
    creator: { type: 'string' },
    draws: { type: 'string', default: String(DEFAULT_DRAWS) },
  },
});
const drawsArg = z.coerce.number().int().min(1).max(5).safeParse(values.draws);
if (!drawsArg.success) {
  console.error('evals --draws : un nombre de 1 à 5.');
  process.exit(1);
}
const draws = drawsArg.data;

/** The admin database named in `.env`, on a connection that cannot write. */
function readOnlyAdmin(flag: string, needsSealing: boolean): ReturnType<typeof createDbClient> {
  const adminUrl = z.url({ protocol: /^postgres(ql)?$/ }).safeParse(process.env['DATABASE_ADMIN_URL']);
  const sealing = process.env['CREDENTIALS_ENCRYPTION_KEYS'];
  if (!adminUrl.success || (needsSealing && (sealing === undefined || sealing === ''))) {
    console.error(
      `evals ${flag} : DATABASE_ADMIN_URL${needsSealing ? ' ou CREDENTIALS_ENCRYPTION_KEYS' : ''} manque dans .env.`,
    );
    process.exit(1);
  }
  return createDbClient(adminUrl.data, READ_ONLY_POOL_OPTIONS);
}

/**
 * The keys saved in the CRM, under the names the gateway reads (`LLM_XAI_API_KEY`…): read once on a read-only
 * connection, never shown. Only the services found are said, by name.
 */
async function crmKeys(): Promise<Record<string, string>> {
  const admin = readOnlyAdmin('--key-from-crm', true);
  try {
    const saved = await readSavedProviderKeys(
      admin.db,
      parseEncryptionKeys(process.env['CREDENTIALS_ENCRYPTION_KEYS'] ?? '', 'CREDENTIALS_ENCRYPTION_KEYS'),
    );
    const found = PROVIDERS.flatMap((provider) => {
      const id = AiProviderSchema.safeParse(provider.id);
      const key = id.success ? saved[id.data] : undefined;
      return key === undefined ? [] : [{ provider, key }];
    });
    const names = found.map(({ provider }) => provider.label).join(', ');
    console.log(`Clés lues dans le CRM : ${names === '' ? 'aucune' : names}`);
    return Object.fromEntries(found.map(({ provider, key }) => [provider.apiKeyEnv, key]));
  } finally {
    await admin.close();
  }
}

const credentials = readProviderCredentials(
  values['key-from-crm'] ? { ...process.env, ...(await crmKeys()) } : process.env,
);
if (credentials.LLM_XAI_API_KEY === undefined) {
  console.error(
    values['key-from-crm']
      ? 'evals: no xAI key saved in Réglages › Modèles IA, nothing can be measured.'
      : 'evals: no LLM_XAI_API_KEY in the environment, nothing can be measured.',
  );
  process.exit(1);
}
const tier = ThresholdsSchema.parse(JSON.parse(readFileSync(resolve(EVALS, 'thresholds.json'), 'utf8')))[
  values.full ? 'full' : 'smoke'
];

const files =
  values.file === undefined
    ? [CARD_SUITE, ...SUITES].flatMap((suite) => {
        let names: string[];
        try {
          names = readdirSync(resolve(EVALS, suite));
        } catch {
          names = [];
        }
        return names.filter((name) => /\.ya?ml$/.test(name)).map((name) => resolve(EVALS, suite, name));
      })
    : [resolve(ROOT, values.file)];

const today = '2026-11-06';

/**
 * Her active persona version, as the agent reads it at each draft (OPS-11): the only creator with one, or the one
 * `--creator` names. Read on a connection that cannot write; only her name and version number are printed.
 */
async function crmPersona(): Promise<PersonaForModels> {
  const admin = readOnlyAdmin('--persona-from-crm', false);
  try {
    const rows = await admin.db
      .select({
        id: schema.personaVersions.id,
        creatorId: schema.personaVersions.creatorId,
        version: schema.personaVersions.version,
        content: schema.personaVersions.content,
        creatorName: schema.creators.displayName,
      })
      .from(schema.personaVersions)
      .innerJoin(schema.creators, eq(schema.creators.id, schema.personaVersions.creatorId))
      .where(eq(schema.personaVersions.isActive, true));
    const wanted = values.creator === undefined ? undefined : CreatorIdSchema.parse(values.creator);
    const among = wanted === undefined ? rows : rows.filter((row) => row.creatorId === wanted);
    const [row, other] = among;
    if (row === undefined || (wanted === undefined && other !== undefined)) {
      console.error(
        row === undefined
          ? 'evals --persona-from-crm : aucune persona active pour cette créatrice.'
          : `evals --persona-from-crm : précise --creator parmi ${among.map((r) => `${r.creatorName} (${r.creatorId})`).join(', ')}.`,
      );
      process.exit(1);
    }
    const stored = {
      id: row.id,
      creatorName: row.creatorName,
      persona: StoredPersonaSchema.parse(row.content),
    };
    const persona = await activePersonaForModels(
      () => Promise.resolve(stored),
      row.creatorId,
      new Date(`${today}T12:00:00Z`),
    );
    if (persona === null) throw new Error('active persona read as none');
    console.log(`Persona : ${row.creatorName}, version ${row.version} (en vigueur dans le CRM)`);
    return persona;
  } finally {
    await admin.close();
  }
}

const persona = values['persona-from-crm']
  ? await crmPersona()
  : readPersonaFile(readFileSync(resolve(ROOT, 'personas/demo/v0.4.0.yaml'), 'utf8'), 'Elena', today);
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

/** A card scenario, on the path a real read takes: the read, then the code's checks (§ 3, § 8). */
async function readCard(scenario: CardScenario): Promise<{ failures: string[]; values: string[] }> {
  const messages = [
    ...scenario.history.map((turn) => ({ ...turn, isNew: false })),
    ...scenario.inbound.map((text) => ({ from: 'fan' as const, text, isNew: true })),
  ].map((message, index) => ({ ...message, number: index + 1 }));
  const result = await gateway.readCard({ card: scenario.card, messages });
  if (!result.ok) return { failures: [`lecture refusée : ${result.error.code}`], values: [] };
  const at = new Date(`${today}T20:00:00+01:00`);
  const sources = messages
    .filter((message) => message.isNew)
    .map((message) => ({ number: message.number, messageId: newId(MessageIdSchema), at }));
  const proposals = proposalsOfRead(result.value.output, sources).map((p) => ({
    field: p.key,
    kind: p.kind,
    value: p.value,
  }));
  return {
    failures: checkCardScenario(scenario, { proposals }),
    values: proposals.map((p) => `${p.field} : ${p.value} (${p.kind})`),
  };
}

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
      situation: scenarioMoment(scenario, now),
      // The policy decides on the brain's offer, as for a real fan: refused, the voice writes a plain answer.
      offer: {
        now,
        lastOfferAt:
          situation.last_offer_hours_ago === null
            ? null
            : new Date(now.getTime() - situation.last_offer_hours_ago * HOUR_MS),
        hasNoBudget: situation.has_no_budget,
        flags: scenarioFlags(scenario),
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
      // The care mode as the composer runs it (ADR 0088): the voice writes the care brief, a human validates.
      care: (brief) => brief !== undefined && holdDecision(brief).kind === 'care',
      skipVoice: (brief) => {
        if (brief === undefined) return true;
        const kind = holdDecision(brief).kind;
        return kind === 'handoff' || kind === 'no_reply';
      },
      customOrder: {
        chatterOnShift: situation.chatter_on_shift,
        orderOpen: situation.custom_order_open,
        flags: {
          ...(situation.age_confirmed && { ageConfirmedAt: '2026-10-01T10:00:00.000Z' }),
          ...(situation.sales_frozen && {
            salesFrozen: { reason: 'operator', since: '2026-10-10T10:00:00.000Z' },
          }),
        },
      },
      objections: {
        bank: persona.objectionReplies,
        usedReplyIds: new Set(situation.objection_replies_used),
      },
      ...(alerts.length > 0 && { alerts: alerts.map(({ id, phrase }) => ({ id, phrase })) }),
    },
  );
  const { brief } = composed;
  const handoff =
    composed.handoff !== undefined ||
    composed.customOrder?.kind === 'handoff' ||
    (brief !== undefined && holdDecision(brief).kind === 'handoff');
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
        ...(brief.objection !== undefined && { objection: brief.objection }),
        alertsSeen: alerts.filter((a) => brief.alertsSeen?.includes(a.id) === true).map((a) => a.name),
      },
    }),
    handoff,
    offer,
    desireBand: desireBandOf(composed.desire?.score ?? situation.desire),
    customOrder: composed.customOrder?.kind ?? 'none',
    objectionReply: composed.objectionReply?.replyId ?? null,
    bubbles: composed.bubbles,
    blocking,
  };
  const scores: Record<string, number> = {};
  if (bubbles.length > 0) {
    const judged = await gateway.judge({
      creatorName: persona.creatorName,
      personaSheet: persona.personaSheet,
      fanNotes: scenario.fan_facts.join('\n'),
      // What the agent saw: without it, the judge read every fan as one whose age is unknown (OPS-07).
      situation: judgeSituationOf(scenario, now),
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
  // Always with `/`: Windows writes `card\…`, and the card suite is told by its prefix.
  const file = relative(EVALS, path).split(sep).join('/');
  if (gateway.health().budget.state === 'reached') {
    isCapReached = true;
    break;
  }
  if (file.startsWith(`${CARD_SUITE}/`)) {
    let card: CardScenario;
    try {
      card = readCardScenario(readFileSync(path, 'utf8'));
    } catch (error) {
      results.push({
        file,
        failures: [`fichier illisible : ${error instanceof Error ? error.message : 'erreur'}`],
        scores: {},
      });
      continue;
    }
    if (card.tier === 'full' && !values.full && values.file === undefined) continue;
    const { failures, values: read } = await readCard(card);
    results.push({ file, failures, scores: {} });
    console.log(`${failures.length === 0 ? 'ok ' : 'KO '} ${file}`);
    for (const line of read) console.log(`      ${line}`);
    for (const failure of failures) console.log(`      ✗ ${failure}`);
    continue;
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
  const drawn: Draw[] = [];
  const lines: string[] = [];
  for (let index = 0; index < draws; index += 1) {
    if (index > 0 && gateway.health().budget.state === 'reached') {
      isCapReached = true;
      break;
    }
    const { outcome, scores } = await run(scenario);
    const failures = checkScenario(scenario, outcome);
    // A written answer nobody scored is not a pass.
    if (outcome.bubbles.length > 0 && !outcome.handoff && Object.keys(scores).length === 0) {
      failures.push('le juge n’a pas répondu');
    }
    drawn.push({ failures, scores });
    const prefix = draws > 1 ? `[${String(index + 1)}] ` : '';
    for (const bubble of outcome.bubbles) lines.push(`      ${prefix}« ${bubble} »`);
    const noted = Object.entries(scores).map(([c, s]) => `${c} ${s.toFixed(2)}`);
    if (noted.length > 0) lines.push(`      ${prefix}${noted.join(' · ')}`);
  }
  const result = mergeDraws(file, drawn);
  results.push(result);
  const passed = drawn.filter((draw) => draw.failures.length === 0).length;
  const mark = result.failures.length === 0 ? 'ok ' : 'KO ';
  console.log(`${mark} ${file}${draws > 1 ? ` (${String(passed)}/${String(drawn.length)} tirages)` : ''}`);
  for (const line of lines) console.log(line);
  for (const failure of result.failures) console.log(`      ✗ ${failure}`);
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
