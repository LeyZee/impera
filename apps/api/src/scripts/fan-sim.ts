/**
 * `pnpm fan-sim`: an invented fan, played by a model of another family than her voice's, talks with the playground
 * over simulated days (ADR 0172, Charles 26/11/2026); a third model judges the relationship and the sale.
 * Nothing is sent to any platform: the playground has no connector. The demo persona by default (« Fiche de démo
 * d'abord », Charles 26/11): its outputs may be read off the PC. Everything goes under `.scratch/`, which git ignores.
 * Usage: `pnpm fan-sim --fan evals/fans/julien.yaml [--days 7] [--cap-eur 5] [--rubric <barème hors dépôt>]
 * [--no-judge] [--key-from-crm] [--out .scratch/fan-sim]`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  createFanSimulationGateway,
  createInMemoryCallLog,
  createLlmGateway,
  createModelResolver,
  DEFAULT_LLM_CONFIG,
  MISTRAL_FALLBACK_MODEL,
  parsePrompt,
  readProviderCredentials,
  type LlmConfig,
  type LlmRoleConfig,
} from '@impera/llm';
import { z } from 'zod';

import { guardSettingsOf, languagesOf } from '../modules/agent/index';
import { createPlaygroundSession, readPersonaFile } from '../modules/playground/index';

import { crmKeys } from './crm-read';
import { parseSimCatalogue, playgroundScriptsOf } from './fan-sim/catalogue';
import { parseFanSheet } from './fan-sim/fan-sheet';
import { measuresOf, transcriptOf } from './fan-sim/report';
import { runSimulation, sessionTime, type SimEvent } from './fan-sim/run';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const COMMAND = 'fan-sim';
/** One run never spends more than this, whatever is asked (ADR 0172 § 10). */
const MAX_CAP_EUR = 15;

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    fan: { type: 'string' },
    days: { type: 'string' },
    'cap-eur': { type: 'string', default: '5' },
    rubric: { type: 'string' },
    'no-judge': { type: 'boolean', default: false },
    'key-from-crm': { type: 'boolean', default: false },
    out: { type: 'string', default: '.scratch/fan-sim' },
  },
});

function fail(message: string): never {
  console.error(`${COMMAND} : ${message}`);
  process.exit(1);
}

const capEur = z.coerce.number().positive().max(MAX_CAP_EUR).safeParse(values['cap-eur']);
if (!capEur.success) fail(`--cap-eur : un montant en euros, ${String(MAX_CAP_EUR)} au plus.`);
const days =
  values.days === undefined ? undefined : z.coerce.number().int().min(1).max(90).safeParse(values.days);
if (days !== undefined && !days.success) fail('--days : un nombre de jours, de 1 à 90.');
if (values.fan === undefined) fail('--fan : la fiche du fan, par exemple evals/fans/julien.yaml.');
const cwd = process.env['INIT_CWD'] ?? process.cwd();
const sheet = parseFanSheet(readFileSync(resolve(cwd, values.fan), 'utf8'));
const out = resolve(ROOT, values.out, sheet.id);
if (!out.split(sep).includes('.scratch')) fail('--out : un dossier sous un .scratch/, que git ignore.');

const credentials = readProviderCredentials(
  values['key-from-crm'] ? { ...process.env, ...(await crmKeys(`${COMMAND} --key-from-crm`)) } : process.env,
);
if (credentials.LLM_XAI_API_KEY === undefined) fail('aucune clé xAI : elle ne peut pas répondre.');
const hasGoogle = credentials.LLM_GOOGLE_API_KEY !== undefined;
const hasMistral = credentials.LLM_MISTRAL_API_KEY !== undefined;
if (!hasGoogle && !hasMistral)
  fail('il faut une clé Gemini ou Mistral : le fan ne joue jamais avec le modèle de sa voix.');

const GEMINI = { provider: 'google', model: 'gemini-3.8-flash' } as const;
const MISTRAL = { provider: 'mistral', model: MISTRAL_FALLBACK_MODEL } as const;

/** The same defaults, with the `judge` role played by `role`: the fan's model, or the judge's. */
function withJudge(role: LlmRoleConfig): LlmConfig {
  return { ...DEFAULT_LLM_CONFIG, roles: { ...DEFAULT_LLM_CONFIG.roles, judge: role } };
}
// The fan: quick and casual, Gemini first (Mistral Large thinks for 40 s a call, too slow for 350 messages).
const fanRole: LlmRoleConfig = {
  ...(hasGoogle ? GEMINI : MISTRAL),
  temperature: 0.9,
  maxOutputTokens: 2_000,
  timeoutMs: 90_000,
  ...(hasGoogle && hasMistral && { fallback: MISTRAL }),
};
// The judge: one long reading at the end, Mistral first, never the voice's family.
const judgeRole: LlmRoleConfig = {
  ...(hasMistral ? MISTRAL : GEMINI),
  temperature: 0,
  maxOutputTokens: 8_000,
  timeoutMs: 180_000,
  ...(hasGoogle && hasMistral && { fallback: GEMINI }),
};

// One journal for the three: the run's cap counts every euro, hers, his and the judge's.
const log = createInMemoryCallLog();
const resolveModel = createModelResolver(credentials);
const herGateway = createLlmGateway({
  config: DEFAULT_LLM_CONFIG,
  credentials,
  resolveModel,
  log,
  dailyCapEur: () => capEur.data,
});
const fanGateway = createFanSimulationGateway({
  config: withJudge(fanRole),
  resolveModel,
  log,
  capEur: capEur.data,
});
const judgeGateway = createFanSimulationGateway({
  config: withJudge(judgeRole),
  resolveModel,
  log,
  capEur: capEur.data,
  ...(values.rubric !== undefined && {
    prompts: {
      relationshipJudge: parsePrompt('judge/relationship', readFileSync(resolve(cwd, values.rubric), 'utf8')),
    },
  }),
});

const today = new Date().toISOString().slice(0, 10);
const persona = readPersonaFile(
  readFileSync(resolve(ROOT, 'personas/demo/v0.7.0.yaml'), 'utf8'),
  'Elena',
  today,
);
const scripts = playgroundScriptsOf(
  parseSimCatalogue(readFileSync(resolve(ROOT, 'evals/fans/catalogue.yaml'), 'utf8')),
);
const first = sheet.sessions[0];
if (first === undefined) fail('la fiche n’a aucune session.');
const session = createPlaygroundSession({
  gateway: herGateway,
  creatorName: persona.creatorName,
  personaSheet: persona.personaSheet,
  guardSettings: guardSettingsOf(persona),
  splitMessages: persona.splitMessages,
  voiceExamples: [],
  languages: languagesOf(persona),
  timeZone: 'Europe/Paris',
  now: () => sessionTime(first),
  offerLimits: persona.offerLimits,
  sexualizationLimits: persona.sexualizationLimits,
  followUps: persona.followUps,
  // Her scripts are the simulated fans' catalogue, one theme each: does she pick the one closest to his fantasy?
  herScripts: () => Promise.resolve({ source: 'trial', scripts, unavailable: null }),
});

const spentUsd = (): number => log.since(new Date(0)).reduce((sum, record) => sum + (record.costUsd ?? 0), 0);
console.log(
  `Fan : ${sheet.label} · elle : ${DEFAULT_LLM_CONFIG.roles.voice.model} · lui : ${fanRole.model} · juge : ${values['no-judge'] ? 'aucun' : judgeRole.model} · plafond ${String(capEur.data)} €`,
);
const progress = (event: SimEvent): void => {
  if (event.kind === 'session')
    console.log(`\nJour ${String(event.day)} ${event.at} (${spentUsd().toFixed(2)} $)`);
  else if (event.kind === 'fan' || event.kind === 'creator')
    process.stdout.write(event.kind === 'fan' ? '.' : '·');
  else if (event.kind === 'failure') console.log(`\n  panne : ${event.code}`);
};

const result = await runSimulation({
  sheet,
  session,
  fan: fanGateway,
  ...(days?.success === true && { lastDay: days.data }),
  onEvent: progress,
});
const measures = measuresOf(sheet, result, spentUsd());

mkdirSync(out, { recursive: true });
const conversation = transcriptOf(sheet, result, false);
writeFileSync(resolve(out, 'conversation.md'), conversation);
writeFileSync(resolve(out, 'conversation-et-journal.md'), transcriptOf(sheet, result, true));
writeFileSync(resolve(out, 'chiffres.json'), JSON.stringify(measures, null, 2));

if (!values['no-judge'] && result.stopped === null) {
  const journal = result.events
    .flatMap((event) => (event.kind === 'journal' ? [`J${String(event.day)} : ${event.output.journal}`] : []))
    .join('\n');
  const judged = await judgeGateway.judgeRelationship({
    creatorName: persona.creatorName,
    personaSheet: persona.personaSheet,
    transcript: conversation,
    fanJournal: journal,
    measures: JSON.stringify(measures),
  });
  if (judged.ok) writeFileSync(resolve(out, 'juge.json'), JSON.stringify(judged.value.output, null, 2));
  else console.log(`\nJuge en panne : ${judged.error.code}`);
}

console.log(`\n\nDépense : ${spentUsd().toFixed(3)} $`);
console.log(
  `Fichiers dans ${values.out}/${sheet.id} (conversation.md, conversation-et-journal.md, chiffres.json, juge.json).`,
);
