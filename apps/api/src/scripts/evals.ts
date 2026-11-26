/**
 * `pnpm evals`: every scenario of `evals/` through the production path (brain, policy, voice, hard guards), then the
 * judge on what she wrote. Fails unless every scenario passes its own checks and each criterion reaches its
 * threshold (`evals/thresholds.json`). Nothing is sent. The persona is the fictional demo one (ADR 0010), or with
 * `--persona-from-crm` her active version read from the database, which stays on that machine (OPS-11).
 * Each scenario is drawn `--draws` times (3 by default) and fails if any draw fails (OPS-11).
 * Usage: `pnpm evals [--full] [--draws 3] [--cap-eur 6] [--transcripts <dir>] [--file evals/adversarial/asks-if-bot.yaml]
 * [--match compliment-]
 * [--persona-from-crm [--creator <id>]]` (the path from the repository root), with
 * LLM_XAI_API_KEY in the environment, or `--key-from-crm`: the keys saved in Réglages › Modèles IA of the database
 * DATABASE_ADMIN_URL names, opened with CREDENTIALS_ENCRYPTION_KEYS (`readSavedProviderKeys`), kept in memory only.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  CreatorIdSchema,
  desireBandOf,
  MessageIdSchema,
  newId,
  StoredPersonaSchema,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import {
  brainAlertId,
  createInMemoryCallLog,
  createLlmGateway,
  createModelResolver,
  DEFAULT_LLM_CONFIG,
  JudgeCriterionSchema,
  readProviderCredentials,
  type ConversationTurn,
} from '@impera/llm';
import { z } from 'zod';

import {
  activePersonaForModels,
  composeTurn,
  type ComposedTurn,
  guardSettingsOf,
  holdDecision,
  measureDesire,
  readPersonaFile,
  UNKNOWN_AVAILABILITY,
  type FanAvailabilityRecord,
  type PersonaForModels,
  type SaleTroubleSeen,
} from '../modules/agent/index';
import { proposalsOfRead } from '../modules/fans/index';

import { crmKeys, readOnlyAdminDb } from './crm-read';
import { checkCardScenario, readCardScenario, type CardScenario } from './evals/card-scenario';
import { checkScenario, judgeSuite, type Outcome, type ScenarioResult } from './evals/check';
import { afterTurn, beforeTurn, type DialogueState, type TurnLeft } from './evals/dialogue';
import { DEFAULT_DRAWS, mergeDraws, type Draw } from './evals/draws';
import { EVALS_CAP_EUR, evalsConfig } from './evals/judge-model';
import { readScenario, ThresholdsSchema, type Scenario } from './evals/scenario';
import { scriptsInputOf } from './evals/scripts-input';
import { judgeSituationOf, scenarioFlags, scenarioMoment, scenarioNow } from './evals/situation';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const EVALS = resolve(ROOT, 'evals');
const SUITES = ['scenarios', 'adversarial', 'regression'] as const;
/** His card read in his messages (ADR 0085 § 7): its own scenarios, checked without the judge. */
const CARD_SUITE = 'card';
const HOUR_MS = 3_600_000;
const MAX_CAP_EUR = 25;

const { values } = parseArgs({
  // pnpm forwards a bare `--` through each script hop.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    full: { type: 'boolean', default: false },
    file: { type: 'string' },
    /** Only the scenarios whose file name holds it: a set replayed alone (« compliment- », Charles 20/11). */
    match: { type: 'string' },
    'key-from-crm': { type: 'boolean', default: false },
    'persona-from-crm': { type: 'boolean', default: false },
    creator: { type: 'string' },
    draws: { type: 'string', default: String(DEFAULT_DRAWS) },
    'cap-eur': { type: 'string', default: String(EVALS_CAP_EUR) },
    transcripts: { type: 'string' },
  },
});
const drawsArg = z.coerce.number().int().min(1).max(5).safeParse(values.draws);
if (!drawsArg.success) {
  console.error('evals --draws : un nombre de 1 à 5.');
  process.exit(1);
}
const draws = drawsArg.data;
/** What a run may spend, at most the agency's daily ceiling for paid AI (Charles: 25 € a day since 21/11). */
const capArg = z.coerce.number().positive().max(MAX_CAP_EUR).safeParse(values['cap-eur']);
if (!capArg.success) {
  console.error(`evals --cap-eur : un montant en euros, ${String(MAX_CAP_EUR)} au plus.`);
  process.exit(1);
}
const capEur = capArg.data;

const credentials = readProviderCredentials(
  values['key-from-crm'] ? { ...process.env, ...(await crmKeys('evals --key-from-crm')) } : process.env,
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
        return names
          .filter(
            (name) => /\.ya?ml$/.test(name) && (values.match === undefined || name.includes(values.match)),
          )
          .map((name) => resolve(EVALS, suite, name));
      })
    : [resolve(ROOT, values.file)];

const today = '2026-11-06';

/**
 * Her active persona version, as the agent reads it at each draft (OPS-11): the only creator with one, or the one
 * `--creator` names. Read on a connection that cannot write; only her name and version number are printed.
 */
async function crmPersona(): Promise<PersonaForModels> {
  const admin = readOnlyAdminDb('evals --persona-from-crm', false);
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
  : readPersonaFile(readFileSync(resolve(ROOT, 'personas/demo/v0.6.0.yaml'), 'utf8'), 'Elena', today);
const { config, isIndependent } = evalsConfig(DEFAULT_LLM_CONFIG, credentials);
const gateway = createLlmGateway({
  config,
  credentials,
  resolveModel: createModelResolver(credentials),
  log: createInMemoryCallLog(),
  // Its own cap: an eval run never eats into the fans' day, and stops at a few euros.
  dailyCapEur: () => capEur,
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

/** When she last answered each sale trouble of his, as the scenario dates it before his message. */
function saleTroubleSeenOf(
  answered: Scenario['situation']['sale_trouble_answered'],
  now: Date,
): SaleTroubleSeen {
  const before = (minutes: number | undefined): Date | null =>
    minutes === undefined ? null : new Date(now.getTime() - minutes * 60_000);
  return {
    paymentHelpAt: before(answered.payment_help_minutes_ago),
    complaintAt: before(answered.complaint_minutes_ago),
  };
}

/** His availability as the scenario stores it, set five minutes before his message. */
function availabilityOf(situation: Scenario['situation'], now: Date): FanAvailabilityRecord {
  const said = new Date(now.getTime() - 5 * 60_000);
  const lapses = new Date(said.getTime() + 2 * HOUR_MS);
  const record: FanAvailabilityRecord = {
    ...UNKNOWN_AVAILABILITY,
    ...(situation.sexualized && { sexualizedAt: said }),
  };
  if (situation.availability === 'confirmed') {
    return {
      ...record,
      state: 'confirmed',
      signal: 'free_now',
      at: said,
      expiresAt: lapses,
      seen: ['alone', 'free_now'],
    };
  }
  if (situation.availability === 'no') {
    return { ...record, state: 'no', signal: 'someone_nearby', at: said, expiresAt: lapses };
  }
  return record;
}

/** What code decided with her scripts, as the scenario checks it. */
function scriptOutcome(
  decision: NonNullable<ComposedTurn['scripts']>['decision'],
): NonNullable<Outcome['script']> {
  if (decision.kind === 'start' || decision.kind === 'send_step')
    return {
      decision: decision.kind,
      step: { script: decision.step.scriptRef, index: decision.step.stepIndex },
    };
  return decision.kind === 'none' || (decision.kind === 'wait' && 'reason' in decision)
    ? { decision: decision.kind, reason: decision.reason }
    : { decision: decision.kind };
}

/** Where the scenario starts: her clock, the history written, his score, availability and scripts as stored. */
function initialState(scenario: Scenario): DialogueState {
  const { situation } = scenario;
  // Her local time as the scenario says, on her clock in Paris (summer or winter time).
  const now = scenarioNow(today, situation.local_time);
  return {
    now,
    history: scenario.history.map(({ from, text, minutes_ago }): ConversationTurn => ({
      from,
      text,
      ...(minutes_ago !== undefined && { at: new Date(now.getTime() - minutes_ago * 60_000) }),
    })),
    desire: situation.desire,
    availability: availabilityOf(situation, now),
    scripts: scenario.scripts === undefined ? undefined : scriptsInputOf(scenario.scripts, now),
  };
}

interface TurnRun {
  readonly outcome: Outcome;
  readonly scores: Record<string, number>;
  readonly left: TurnLeft;
}

/**
 * One message of his, on the path a real fan's message takes; nothing leaves. The first turn is the scenario's own;
 * the next ones (`then`) read the state her previous answer left, and are always dated.
 */
async function runTurn(
  scenario: Scenario,
  state: DialogueState,
  inboundLines: string | readonly string[],
  isFirst: boolean,
): Promise<TurnRun> {
  const { situation } = scenario;
  const { now } = state;
  const inbound = typeof inboundLines === 'string' ? [inboundLines] : inboundLines;
  // A turn dated by the scenario carries its time; his new messages are written now. Undated scenarios say none.
  const dated =
    scenario.then.length > 0 ||
    scenario.inbound_minutes_ago !== undefined ||
    scenario.history.some((turn) => turn.minutes_ago !== undefined);
  const writtenAt = new Date(now.getTime() - (isFirst ? (scenario.inbound_minutes_ago ?? 0) : 0) * 60_000);
  const history: ConversationTurn[] = [
    ...state.history,
    ...inbound.map((text): ConversationTurn => ({ from: 'fan', text, ...(dated && { at: writtenAt }) })),
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
      ...(scenario.profile_bio !== undefined && { profileBio: scenario.profile_bio }),
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
        previous: { score: state.desire, at: now },
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
        // His order kept box by box, and her made-up grid (ADR 0159 § A.2).
        ...(scenario.custom_order_kept !== undefined && {
          order: scenario.custom_order_kept.open,
          grid: scenario.custom_order_kept.grid,
        }),
      },
      objections: {
        bank: persona.objectionReplies,
        usedReplyIds: new Set(situation.objection_replies_used),
      },
      ...(alerts.length > 0 && { alerts: alerts.map(({ id, phrase }) => ({ id, phrase })) }),
      // His availability and his sexualizing as stored a few minutes before (ADR 0103 § 9-13).
      availability: state.availability,
      // Her made-up scripts, Reveal's history of his and his run (ADR 0098): a long sale, one message at a time.
      ...(state.scripts !== undefined && { scripts: state.scripts }),
      // What she already answered him about meeting her, kept from turn to turn as the journal would.
      ...(state.meeting !== undefined && { meeting: state.meeting }),
      // A sale that went wrong for him (ADR 0156 § 4 and § 7): when she last answered it, and whether he bought.
      saleTrouble: {
        seen: saleTroubleSeenOf(situation.sale_trouble_answered, now),
        hasBought:
          situation.spent_euros > 0 ||
          (state.scripts?.history?.scripts.some((sent) => sent.boughtStepIndexes.length > 0) ?? false),
      },
    },
  );
  const { brief } = composed;
  const handoff =
    composed.handoff !== undefined ||
    composed.customOrder?.kind === 'handoff' ||
    composed.saleTrouble?.kind === 'handoff' ||
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
        ...(brief.scriptReply !== undefined && { scriptReply: brief.scriptReply }),
        alertsSeen: alerts.filter((a) => brief.alertsSeen?.includes(a.id) === true).map((a) => a.name),
      },
    }),
    handoff,
    offer,
    desireBand: desireBandOf(composed.desire?.score ?? state.desire),
    customOrder: composed.customOrder?.kind ?? 'none',
    ...(composed.customOrderTurn?.kind === 'reply' &&
      composed.customOrderTurn.event !== undefined && {
        customOrderEvent: composed.customOrderTurn.event.type,
      }),
    objectionReply: composed.objectionReply?.replyId ?? null,
    ...(composed.abandonTeased !== undefined && { abandonTease: composed.abandonTeased }),
    ...(composed.scripts !== undefined && { script: scriptOutcome(composed.scripts.decision) }),
    bubbles: composed.bubbles,
    blocking,
  };
  const scores: Record<string, number> = {};
  if (bubbles.length > 0) {
    const judged = await gateway.judge({
      creatorName: persona.creatorName,
      personaSheet: persona.personaSheet,
      ...(scenario.profile_bio !== undefined && { profileBio: scenario.profile_bio }),
      fanNotes: scenario.fan_facts.join('\n'),
      // What the agent saw: without it, the judge read every fan as one whose age is unknown (OPS-07).
      situation: judgeSituationOf(scenario, now),
      history,
      reply: bubbles,
      criteria,
    });
    if (judged.ok) for (const { criterion, score } of judged.value.output.scores) scores[criterion] = score;
  }
  return {
    outcome,
    scores,
    left: {
      heard: history,
      bubbles,
      desire: composed.desireRead,
      availability: composed.availability,
      scripts: composed.scripts,
      ...(composed.meetingAnswer !== undefined && { meetingAnswer: composed.meetingAnswer }),
    },
  };
}

/** A draw of the whole scenario: its first message, then each of `then`, every answer checked and judged. */
async function run(scenario: Scenario, lines: string[], prefix: string): Promise<Draw> {
  let state = initialState(scenario);
  const failures: string[] = [];
  const scores: Record<string, number[]> = {};
  const turns = [
    { after_minutes: 0, event: undefined, inbound: scenario.inbound, expect: scenario.expect },
    ...scenario.then,
  ];
  for (const [index, turn] of turns.entries()) {
    if (index > 0) state = beforeTurn(state, turn.after_minutes, turn.event);
    const tag = turns.length > 1 ? `${prefix}tour ${String(index + 1)} : ` : prefix;
    const { outcome, scores: turnScores, left } = await runTurn(scenario, state, turn.inbound, index === 0);
    const turnFailures = checkScenario({ expect: turn.expect }, outcome);
    // A written answer nobody scored is not a pass.
    if (outcome.bubbles.length > 0 && !outcome.handoff && Object.keys(turnScores).length === 0) {
      turnFailures.push('le juge n’a pas répondu');
    }
    failures.push(...turnFailures.map((failure) => `${tag}${failure}`));
    for (const [criterion, score] of Object.entries(turnScores)) (scores[criterion] ??= []).push(score);
    if (turns.length > 1) {
      const said = typeof turn.inbound === 'string' ? [turn.inbound] : turn.inbound;
      for (const text of said) lines.push(`      ${tag}lui « ${text} »`);
    }
    for (const bubble of outcome.bubbles) lines.push(`      ${tag}« ${bubble} »`);
    const noted = Object.entries(turnScores).map(([c, s]) => `${c} ${s.toFixed(2)}`);
    if (noted.length > 0) lines.push(`      ${tag}${noted.join(' · ')}`);
    state = afterTurn(state, left);
    if (outcome.handoff) {
      if (index < turns.length - 1)
        lines.push(`      ${tag}un humain prend la main, la suite n’est pas jouée`);
      break;
    }
  }
  // A draw's score per criterion is its weakest answer: one bad turn is a bad conversation.
  return {
    failures,
    scores: Object.fromEntries(Object.entries(scores).map(([c, list]) => [c, Math.min(...list)])),
  };
}

/**
 * Where each conversation is written out in full, for a reader on this machine: a folder of `.scratch/` per run, or
 * the one `--transcripts` names. With her real sheet (`--persona-from-crm`) the console never shows her words.
 */
const transcripts = resolve(
  ROOT,
  values.transcripts ?? `.scratch/evals/${new Date().toISOString().replaceAll(':', '-')}`,
);
mkdirSync(transcripts, { recursive: true });
console.log(`Transcriptions : ${relative(ROOT, transcripts) || transcripts}`);

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
    drawn.push(await run(scenario, lines, draws > 1 ? `[${String(index + 1)}] ` : ''));
  }
  const result = mergeDraws(file, drawn);
  results.push(result);
  const passed = drawn.filter((draw) => draw.failures.length === 0).length;
  const mark = result.failures.length === 0 ? 'ok ' : 'KO ';
  console.log(`${mark} ${file}${draws > 1 ? ` (${String(passed)}/${String(drawn.length)} tirages)` : ''}`);
  // Her words go to a file of `.scratch/` (ignored by git); the console shows them only for the made-up persona.
  writeFileSync(resolve(transcripts, `${file.replaceAll('/', '__')}.txt`), `${lines.join('\n')}\n`);
  if (!values['persona-from-crm']) for (const line of lines) console.log(line);
  for (const failure of result.failures) console.log(`      ✗ ${failure}`);
}

if (isCapReached) {
  console.error(
    `\nevals : plafond de ${String(capEur)} € atteint, suite arrêtée après ${String(results.length)} scénarios.`,
  );
}
const report = judgeSuite(
  results,
  values.file === undefined && values.match === undefined ? tier : { ...tier, min_scenarios: 1 },
  minima,
);
const means = Object.entries(report.means);
if (means.length > 0)
  console.log(`\nMoyennes : ${means.map(([c, m]) => `${c} ${m.toFixed(2)}`).join(' · ')}`);
if (!report.isPassing || isCapReached) {
  console.error(`\nevals ${values.full ? 'full' : 'smoke'} : en échec`);
  for (const problem of report.problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`\nevals ${values.full ? 'full' : 'smoke'} : ${String(results.length)} scénarios, tout passe.`);
