/**
 * Terminal playground: talk to the persona as a fan, through the production path, with nothing ever sent,
 * and calibrate it: rate each answer, correct it, put the fan in a situation, replay, compare (P3-05).
 * Usage: `pnpm playground --persona <path to a persona YAML>` (LLM_XAI_API_KEY in the environment).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

import type { MediaDescription } from '@nirvana/contracts';
import {
  createJsonlCallLog,
  DEFAULT_LLM_CONFIG,
  loadPrompt,
  MODELS,
  readProviderCredentials,
} from '@nirvana/llm';

import {
  createJsonlCalibrationStore,
  guardSettingsOf,
  describeSituation,
  isTimeZone,
  nextLocalTime,
  parseRejection,
  rateReport,
  REJECT_REASON_LABELS,
  REJECT_REASONS,
  replayableTests,
  suggestDestination,
  RATE_TARGET,
  versionLabel,
  voiceExamples,
  type CalibrationRecord,
  type Verdict,
} from '../modules/agent/index';
import {
  createFfmpegMediaTools,
  createGatewaySenser,
  createGatewayTranscriber,
  createInMemoryDescriptionStore,
  createMediaDescriber,
} from '../modules/media/index';
import {
  createPlaygroundGateway,
  createPlaygroundSession,
  createVoiceVariant,
  FAN_PRESETS,
  findPreset,
  ratingRecord,
  readPersonaFile,
  withExamples,
  type PlaygroundFollowUp,
  type PlaygroundTurn,
} from '../modules/playground/index';

const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`;
const red = (s: string): string => `\x1b[31m${s}\x1b[0m`;
const pink = (s: string): string => `\x1b[95m${s}\x1b[0m`;
const amber = (s: string): string => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`;

const { values } = parseArgs({
  options: {
    persona: { type: 'string' },
    name: { type: 'string', default: 'Messa' },
    fuseau: { type: 'string', default: 'Europe/Paris' },
  },
});
if (values.persona === undefined) {
  console.error('Usage: pnpm playground --persona <persona.yaml> [--name Messa]');
  process.exit(2);
}
if (!isTimeZone(values.fuseau)) {
  console.error(`Unknown time zone « ${values.fuseau} »: use an IANA name such as Europe/Paris.`);
  process.exit(2);
}
const credentials = readProviderCredentials(process.env);
if (credentials.LLM_XAI_API_KEY === undefined && credentials.LLM_MISTRAL_API_KEY === undefined) {
  console.error(
    'No LLM key in the environment (LLM_XAI_API_KEY): set it as an environment variable, never in a file.',
  );
  process.exit(2);
}

// pnpm runs the script from apps/api; paths given by the user are relative to where they typed the command.
const cwd = process.env['INIT_CWD'] ?? process.cwd();
const repoRoot = resolve(import.meta.dirname, '../../../..');
const scratch = resolve(repoRoot, '.scratch/playground');
const today = new Date().toISOString().slice(0, 10);
const persona = readPersonaFile(readFileSync(resolve(cwd, values.persona), 'utf8'), values.name, today);
const log = createJsonlCallLog(resolve(scratch, 'llm-calls.jsonl'));
const gateway = createPlaygroundGateway({ credentials, log });
// Ratings hold persona phrasing: kept out of the repository, in the shape the database will take (P0-03).
const trainingDir = process.env['NIRVANA_TRAINING_DIR'] ?? resolve(repoRoot, '.scratch/training');
const store = createJsonlCalibrationStore(resolve(trainingDir, 'ratings.jsonl'));
const records: CalibrationRecord[] = await store.list();
const sessionId = `playground-${String(Date.now())}`;
const voicePromptVersion = loadPrompt('voice').header.version;
// The rate shown is the configured voice's: an answer written by the fallback counts for the fallback.
const currentVersion = { voicePrompt: voicePromptVersion, voiceModel: DEFAULT_LLM_CONFIG.roles.voice.model };
const examples = voiceExamples(records);

const session = createPlaygroundSession({
  gateway,
  creatorName: persona.creatorName,
  personaSheet: persona.personaSheet,
  guardSettings: guardSettingsOf(persona),
  splitMessages: persona.splitMessages,
  voiceExamples: examples,
  timeZone: values.fuseau,
  offerLimits: persona.offerLimits,
  sexualizationLimits: persona.sexualizationLimits,
  followUps: persona.followUps,
});
let isRated = true;

const describer = createMediaDescriber({
  sense: createGatewaySenser(gateway),
  transcribe: createGatewayTranscriber(gateway),
  store: createInMemoryDescriptionStore(),
  tools: createFfmpegMediaTools(),
  senseVersion: `${DEFAULT_LLM_CONFIG.roles.sense.model}:${loadPrompt('sense').hash.slice(0, 12)}`,
});
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.heic': 'image/heic',
};

/** Describes a local file with the sense role, as the media module will for a received or imported media. */
async function describeFile(path: string, origin: 'fan' | 'creator'): Promise<MediaDescription | undefined> {
  const mediaType = MEDIA_TYPES[extname(path).toLowerCase()];
  if (mediaType === undefined) {
    console.log(red(`  média  format non pris en charge : ${extname(path) || path}`));
    return undefined;
  }
  const result = await describer.describe({
    origin,
    mediaType,
    data: new Uint8Array(readFileSync(resolve(cwd, path))),
  });
  if (!result.ok) {
    console.log(
      red(
        `  média  échec (${result.error.code}${result.error.detail !== undefined ? ` : ${result.error.detail}` : ''})`,
      ),
    );
    return undefined;
  }
  const d = result.value;
  console.log(
    dim(`  média  ${d.kind} · ${d.intensity}${d.flags.length > 0 ? ` · ALERTES ${d.flags.join(', ')}` : ''}`),
  );
  console.log(dim(`         ${d.factualDescription}`));
  if (d.textVisible !== null) console.log(dim(`         texte lu : « ${d.textVisible} »`));
  return d;
}

/** Why /relance wrote nothing, in French. */
function followUpLabel(followUp: Exclude<PlaygroundFollowUp, { kind: 'written' }>): string {
  const at = (date: Date): string =>
    date.toLocaleString('fr-FR', {
      timeZone: session.situation.timeZone,
      dateStyle: 'short',
      timeStyle: 'short',
    });
  switch (followUp.kind) {
    case 'nothing_to_follow_up':
      return 'pas de relance : elle n’a pas encore répondu à son dernier message';
    case 'not_due':
      return `relance ${String(followUp.step + 1)} pas encore due : le ${at(followUp.dueAt)}`;
    case 'later':
      return `ses heures calmes : la relance partirait le ${at(followUp.at)}`;
    case 'skip':
      return followUp.reason === 'follow_up_plan_over'
        ? 'plus de relance prévue après ce silence'
        : `pas de relance (${followUp.reason})`;
  }
}

let showBrief = true;
const pendingMedia: MediaDescription[] = [];

function print(turn: PlaygroundTurn): void {
  if (turn.handoff !== undefined) {
    console.log(red(`  relais humain : ${turn.handoff.join(', ')} (aucune réponse automatique)`));
    return;
  }
  if (turn.trap !== undefined) {
    console.log(dim(`  piège  ${turn.trap.signals.map((s) => `${s.kind} (${s.source})`).join(', ')}`));
  }
  if (showBrief && turn.brief) {
    const b = turn.brief;
    console.log(
      dim(
        `  brief  ${b.intent} · ${b.sentiment} · ${b.action}${b.risks.length > 0 ? ` · RISQUES ${b.risks.join(', ')}` : ''}`,
      ),
    );
    console.log(dim(`         ${b.replyBrief}`));
  }
  if (showBrief && turn.desire !== undefined) {
    const d = turn.desire;
    console.log(
      dim(
        `  désir  ${String(d.score)} (${d.band})${d.signals.length > 0 ? ` · ${d.signals.join(', ')}` : ''}`,
      ),
    );
  }
  if (turn.briefFailure !== undefined) console.log(red(`  brief  échec (${turn.briefFailure})`));
  for (const bubble of turn.bubbles)
    console.log(turn.isBlocked ? red(`  ✗ ${bubble}`) : pink(`  ${persona.creatorName} › ${bubble}`));
  if (turn.voiceFailure !== undefined) console.log(red(`  voix   échec (${turn.voiceFailure})`));
  for (const v of turn.violations) {
    console.log(red(`  garde  ${v.code} (${v.severity})${v.match !== undefined ? ` « ${v.match} »` : ''}`));
  }
  const cost = `${(turn.costUsd * 100).toFixed(3)} ¢`;
  console.log(
    dim(
      `  ${turn.model ?? '—'}${turn.isFallback ? ' (repli)' : ''} · ${String(turn.latencyMs)} ms · ${cost}`,
    ),
  );
}

const HOUR_MS = 3_600_000;

/** « 3h », « 2j », « 45min » as milliseconds. */
function parseDuration(text: string): number | undefined {
  const match = /^(\d+(?:[.,]\d+)?)\s*(min|h|j)$/.exec(text.trim().toLowerCase());
  if (match?.[1] === undefined) return undefined;
  const value = Number.parseFloat(match[1].replace(',', '.'));
  const unit = match[2] === 'min' ? 60_000 : match[2] === 'h' ? HOUR_MS : 24 * HOUR_MS;
  return value * unit;
}

/** The one line that matters, then the one thing to do. */
function statusLine(): string {
  const report = rateReport(records, currentVersion);
  const { rate, rated } = report.current;
  const shown = rate === undefined ? '—' : `${String(Math.round(rate * 100))} %`;
  const paint = rate === undefined || rate >= RATE_TARGET ? bold : rate >= 0.6 ? amber : red;
  const trend =
    report.trendPoints === undefined
      ? ''
      : ` · ${report.trendPoints >= 0 ? '+' : ''}${String(report.trendPoints)} pts depuis ${versionLabel(report.previousVersion ?? report.current.version ?? { voicePrompt: '?', voiceModel: '?' })}`;
  const version = report.current.version === undefined ? '' : ` · ${versionLabel(report.current.version)}`;
  return `${paint(`taux au playground ${shown}`)}${dim(` (${String(rated)} notées, objectif ${String(RATE_TARGET * 100)} %)${version}${trend}`)}`;
}

function nextAction(): string {
  if (session.lastExchange !== undefined && !isRated) {
    return session.lastExchange.turn.isBlocked
      ? 'à faire : /corrige la réponse bloquée, ou envoie un autre message'
      : 'à faire : /ok, /corrige <texte> ou /rejet <raison>';
  }
  return 'à faire : écris comme le fan';
}

async function rate(verdict: Verdict): Promise<void> {
  const exchange = session.lastExchange;
  if (exchange === undefined || isRated) {
    console.log(dim('  rien à noter : envoie d’abord un message'));
    return;
  }
  // Nothing was written, or the guards stopped it: there is nothing to validate as it stands.
  if (verdict.kind === 'validated' && exchange.turn.isBlocked) {
    console.log(dim('  réponse bloquée : /corrige ou /rejet'));
    return;
  }
  const destination = suggestDestination(verdict);
  const record = ratingRecord({
    id: `${sessionId}-${String(records.length + 1)}`,
    sessionId,
    at: new Date(),
    version: {
      voicePrompt: voicePromptVersion,
      voiceModel: exchange.turn.model ?? currentVersion.voiceModel,
    },
    verdict,
    destination,
    exchange: { fanMessage: exchange.fanMessage, bubbles: exchange.turn.bubbles },
    moment: exchange.moment,
  });
  await store.append(record);
  records.push(record);
  isRated = true;
  if (verdict.kind === 'corrected') session.replaceLastAnswer(verdict.text);
  const where = {
    voice_example: 'exemple de voix (repris à la prochaine session)',
    rule: 'règle à valider par Charles, puis codée',
    test: 'test rejoué à chaque changement (/tests)',
  } as const;
  console.log(dim(`  noté${destination === undefined ? '' : ` → ${where[destination]}`}`));
  console.log(`  ${statusLine()}`);
}

async function replayTests(): Promise<void> {
  const tests = replayableTests(records).filter((t) => t.moment.brief !== undefined);
  if (tests.length === 0) {
    console.log(dim('  aucun test : chaque correction ou rejet en devient un'));
    return;
  }
  console.log(dim(`  ${String(tests.length)} moments rejoués avec ${versionLabel(currentVersion)}`));
  for (const test of tests) {
    const { brief } = test.moment;
    if (brief === undefined) continue;
    const result = await gateway.voice({
      creatorName: persona.creatorName,
      personaSheet: withExamples(persona.personaSheet, examples),
      fanNotes: test.moment.fanNotes,
      situation: describeSituation(test.moment.situation),
      history: test.moment.history,
      brief,
    });
    const why =
      test.verdict.kind === 'rejected'
        ? `rejetée : ${REJECT_REASON_LABELS[test.verdict.reason]}`
        : 'corrigée';
    console.log(`\n  fan › ${test.fanMessage || '(média)'}`);
    console.log(dim(`  avant (${why}) : ${test.bubbles.join(' / ')}`));
    if (test.verdict.kind === 'corrected') console.log(dim(`  attendu : ${test.verdict.text}`));
    console.log(
      result.ok
        ? pink(`  maintenant : ${result.value.output.bubbles.join(' / ')}`)
        : red('  maintenant : échec'),
    );
  }
  console.log(
    dim('\n  Note chaque nouvelle réponse dans une conversation pour qu’elle compte dans le taux.'),
  );
}

const HELP = [
  'Noter la dernière réponse : /ok · /corrige <texte, bulles séparées par |> · /rejet <raison> [précision]',
  `  raisons : ${REJECT_REASONS.map((r) => REJECT_REASON_LABELS[r]).join(', ')} (ou ia, perso, long, tot, vente, oubli, autre)`,
  'Mettre en situation : /fans · /fan <id> · /heure 23:30 · /avance 3h|2j · /depuis 2j · /achat 30',
  'Relancer un fan silencieux : /avance 12h puis /relance',
  'Rejouer et comparer : /rejouer <n° du message du fan> · /compare <modèle> · /tests',
  'Médias : /media <fichier> (il envoie) · /envoi <fichier> [verrouillé] (elle envoie)',
  'Autres : /taux · /brief · /notes · /moment · /health · /save · /reset · /aide · /quit',
].join('\n');

console.log(
  pink(`Playground ${persona.creatorName}`) + dim(' — rien n’est jamais envoyé. /aide pour les commandes.'),
);
console.log(`  ${statusLine()}`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
for (;;) {
  const line = (await rl.question('fan › ')).trim();
  if (line === '') continue;
  if (line === '/quit') break;
  if (line === '/reset') {
    session.reset();
    isRated = true;
    console.log(dim('  conversation remise à zéro'));
    continue;
  }
  if (line === '/brief') {
    showBrief = !showBrief;
    continue;
  }
  if (line === '/notes') {
    console.log(
      dim(session.fanNotes.length > 0 ? session.fanNotes.map((n) => `  ${n}`).join('\n') : '  aucune note'),
    );
    continue;
  }
  if (line === '/health') {
    const report = gateway.health();
    console.log(
      dim(
        `  état ${report.state} · aujourd’hui ${report.budget.spentEur.toFixed(4)} € / ${String(report.budget.capEur)} € (${report.budget.state})`,
      ),
    );
    for (const r of report.roles)
      console.log(
        dim(
          `  ${r.role.padEnd(6)} ${r.state.padEnd(9)} ${r.active.label}${r.isOnFallback ? ' (repli actif)' : ''}`,
        ),
      );
    continue;
  }
  if (line.startsWith('/media ')) {
    const description = await describeFile(line.slice('/media '.length).trim(), 'fan');
    if (description !== undefined) {
      pendingMedia.push(description);
      console.log(dim('  joint à son prochain message (une ligne vide l’envoie seul : tape « . »)'));
    }
    continue;
  }
  if (line.startsWith('/envoi ')) {
    const [path = '', flag] = line.slice('/envoi '.length).trim().split(/\s+/);
    const description = await describeFile(path, 'creator');
    if (description !== undefined) {
      session.sendCreatorMedia(description, flag === 'verrouillé' || flag === 'verrouille');
      console.log(dim('  envoyé dans la conversation'));
    }
    continue;
  }
  if (line === '/save') {
    mkdirSync(scratch, { recursive: true });
    const file = resolve(scratch, `conversation-${String(Date.now())}.json`);
    writeFileSync(file, JSON.stringify({ history: session.history, notes: session.fanNotes }, null, 2));
    console.log(dim(`  enregistré dans ${file}`));
    continue;
  }
  if (line === '/aide') {
    console.log(dim(HELP));
    continue;
  }
  if (line === '/taux') {
    console.log(`  ${statusLine()}`);
    continue;
  }
  if (line === '/ok') {
    await rate({ kind: 'validated' });
    continue;
  }
  if (line.startsWith('/corrige ')) {
    const text = line
      .slice('/corrige '.length)
      .split('|')
      .map((b) => b.trim())
      .filter((b) => b !== '')
      .join('\n');
    if (text === '') console.log(dim('  /corrige <la réponse qu’elle aurait écrite>'));
    else await rate({ kind: 'corrected', text });
    continue;
  }
  if (line.startsWith('/rejet')) {
    const rejection = parseRejection(line.slice('/rejet'.length));
    if (rejection === undefined) {
      console.log(dim(`  raison : ${REJECT_REASONS.map((r) => REJECT_REASON_LABELS[r]).join(', ')}`));
      continue;
    }
    await rate({ kind: 'rejected', ...rejection });
    continue;
  }
  if (line === '/fans') {
    for (const p of FAN_PRESETS) console.log(dim(`  ${p.id.padEnd(9)} ${p.label} — teste ${p.tests}`));
    continue;
  }
  if (line.startsWith('/fan ')) {
    const preset = findPreset(line.slice('/fan '.length).trim());
    if (preset === undefined) {
      console.log(dim('  préréglage inconnu : /fans pour la liste'));
      continue;
    }
    session.reset();
    session.setFanNotes(preset.fanNotes);
    session.setSituation({
      relationshipStartedAt: new Date(
        session.situation.now.getTime() - preset.relationshipAgeHours * HOUR_MS,
      ),
      spentCents: preset.spentCents,
    });
    isRated = true;
    console.log(
      dim(`  ${preset.label} : teste ${preset.tests}. Idée de premier message : « ${preset.opening} »`),
    );
    continue;
  }
  if (line.startsWith('/heure ')) {
    const match = /^(\d{1,2})[:h](\d{2})?$/.exec(line.slice('/heure '.length).trim());
    if (match?.[1] === undefined) {
      console.log(dim('  /heure 23:30'));
      continue;
    }
    const hour = Number(match[1]);
    const minute = Number(match[2] ?? '0');
    if (hour > 23 || minute > 59) {
      console.log(dim('  /heure 23:30'));
      continue;
    }
    const { now, timeZone } = session.situation;
    session.advance(nextLocalTime(now, timeZone, hour, minute).getTime() - now.getTime());
    console.log(dim(`  ${describeSituation(session.situation).split('\n')[0] ?? ''}`));
    continue;
  }
  if (line === '/relance') {
    const followUp = await session.followUp();
    if (followUp.kind === 'written') {
      console.log(dim(`  relance ${String(followUp.step + 1)}`));
      print(followUp.turn);
    } else console.log(dim(`  ${followUpLabel(followUp)}`));
    continue;
  }
  if (line.startsWith('/avance ') || line.startsWith('/depuis ')) {
    const ms = parseDuration(line.slice(line.indexOf(' ') + 1));
    if (ms === undefined) {
      console.log(dim('  durée : 45min, 3h ou 2j'));
      continue;
    }
    if (line.startsWith('/avance ')) session.advance(ms);
    else session.setSituation({ relationshipStartedAt: new Date(session.situation.now.getTime() - ms) });
    console.log(dim(describeSituation(session.situation).replace(/^/gm, '  ')));
    continue;
  }
  if (line.startsWith('/achat ')) {
    const amount = Number.parseFloat(line.slice('/achat '.length).replace(',', '.'));
    if (!Number.isFinite(amount) || amount < 0) {
      console.log(dim('  /achat 30 (dollars déjà dépensés)'));
      continue;
    }
    session.setSituation({ spentCents: Math.round(amount * 100) });
    console.log(dim(describeSituation(session.situation).replace(/^/gm, '  ')));
    continue;
  }
  if (line === '/moment') {
    console.log(dim(describeSituation(session.situation).replace(/^/gm, '  ')));
    continue;
  }
  if (line.startsWith('/rejouer ')) {
    const replay = session.branchAt(Number.parseInt(line.slice('/rejouer '.length), 10));
    if (replay === undefined) {
      console.log(dim('  /rejouer <n> : n est le numéro du message du fan, à partir de 1'));
      continue;
    }
    console.log(dim(`  nouvelle branche depuis « ${replay.text || '(média)'} »`));
    isRated = false;
    print(await session.handleFanMessage(replay.text, replay.media));
    console.log(dim(`  ${nextAction()}`));
    continue;
  }
  if (line.startsWith('/compare ')) {
    const model = line.slice('/compare '.length).trim();
    const other = createVoiceVariant({ credentials, log }, model);
    if (other === undefined) {
      console.log(dim(`  modèles : ${MODELS.map((m) => m.model).join(', ')}`));
      continue;
    }
    const comparison = await session.compareVoice(other);
    if (comparison === undefined) {
      console.log(dim('  rien à comparer : envoie d’abord un message'));
      continue;
    }
    console.log(
      dim(
        `  1 · ${session.lastExchange?.turn.model ?? '—'} : ${session.lastExchange?.turn.bubbles.join(' / ') ?? ''}`,
      ),
    );
    console.log(
      comparison.failure === undefined
        ? pink(`  2 · ${comparison.model ?? model} : ${comparison.bubbles.join(' / ')}`)
        : red(`  2 · ${model} : échec (${comparison.failure})`),
    );
    for (const v of comparison.violations) console.log(red(`      garde ${v.code} (${v.severity})`));
    console.log(dim('  la 2 te plaît plus ? /corrige avec son texte, elle devient l’exemple'));
    continue;
  }
  if (line === '/tests') {
    await replayTests();
    continue;
  }
  if (line.startsWith('/') && line !== '.') {
    console.log(dim('  commande inconnue : /aide'));
    continue;
  }
  isRated = false;
  print(await session.handleFanMessage(line === '.' ? '' : line, pendingMedia.splice(0)));
  console.log(dim(`  ${nextAction()}`));
}
rl.close();
