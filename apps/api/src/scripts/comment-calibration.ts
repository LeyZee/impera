/**
 * `pnpm comment-calibration`: her replies to Instagram comments, the model's against hers (Charles, 26/11). Some of
 * her real pairs « comment, her reply » are set aside; the model answers their comments on the production path (her
 * public sheet, her closest pairs among the others, the room for a question, the guards and their one rewrite).
 * Nothing is sent to Instagram. Run on the PC only, with her active persona read from the CRM: her words stay in the
 * output folder, under `.scratch/`, which git ignores. The console and `chiffres.json` hold numbers only.
 * Usage: `pnpm comment-calibration --corpus <Corpus.jsonl> [--count 40] [--seed 1] [--creator <id>] [--key-from-crm]
 * [--cap-eur 3] [--out .scratch/calibration-commentaires] [--exclude 2025-07-01..2025-08-15]`, her prepared corpus,
 * one comment and her replies per line; `--exclude`, repeatable, drops the replies written in a period when someone else
 * answered for her (assistants, Charles 26/11).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { CreatorIdSchema, StoredPersonaSchema, type CommentOutcome } from '@impera/contracts';
import { eq, schema } from '@impera/db';
import {
  createInMemoryCallLog,
  createLlmGateway,
  createModelResolver,
  DEFAULT_LLM_CONFIG,
  readProviderCredentials,
} from '@impera/llm';
import { z } from 'zod';

import { commentWriterPersona, safetySigns } from '../modules/agent/index';
import {
  afterGuards,
  beforeModel,
  captionForPrompt,
  checkReply,
  commentForPrompt,
  mayAskQuestion,
  declaresLove,
  nearExamples,
  QUESTION_EVERY_BOUNDS,
  replyShapeOf,
  asksAQuestion,
  type GuardedAttempt,
} from '../modules/instagram-comments/index';

import {
  blindLines,
  CorpusLineSchema,
  pairOfCorpusLine,
  periodOf,
  writtenInExcludedPeriod,
  type ExcludedPeriod,
  setAside,
  shapeOf,
  type CalibrationPair,
} from './comment-calibration/calibration';
import { crmKeys, readOnlyAdminDb } from './crm-read';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const COMMAND = 'comment-calibration';
const MAX_CAP_EUR = 25;
const RECENT_REPLIES = 5;

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    corpus: { type: 'string' },
    count: { type: 'string', default: '40' },
    seed: { type: 'string', default: '1' },
    creator: { type: 'string' },
    'key-from-crm': { type: 'boolean', default: false },
    'cap-eur': { type: 'string', default: '3' },
    out: { type: 'string', default: '.scratch/calibration-commentaires' },
    exclude: { type: 'string', multiple: true, default: [] },
  },
});

function fail(message: string): never {
  console.error(`${COMMAND} : ${message}`);
  process.exit(1);
}

const count = z.coerce.number().int().min(1).max(200).safeParse(values.count);
const seed = z.coerce.number().int().nonnegative().safeParse(values.seed);
const capEur = z.coerce.number().positive().max(MAX_CAP_EUR).safeParse(values['cap-eur']);
if (!count.success) fail('--count : un nombre de 1 à 200.');
if (!seed.success) fail('--seed : un entier positif.');
if (!capEur.success) fail(`--cap-eur : un montant en euros, ${String(MAX_CAP_EUR)} au plus.`);
if (values.corpus === undefined) fail('--corpus : son fichier Corpus.jsonl.');
const excluded: ExcludedPeriod[] = values.exclude.map(
  (text) => periodOf(text) ?? fail('--exclude : une période AAAA-MM-JJ..AAAA-MM-JJ.'),
);
const out = resolve(ROOT, values.out);
// Her words go to a folder git ignores: one named `.scratch` on the path (this checkout's, or the main one's when run
// from a worktree), never a sibling whose name only starts the same.
if (!out.split(sep).includes('.scratch')) fail('--out : un dossier sous un .scratch/, que git ignore.');

/** Her pairs, handles removed; a line that does not read is counted, never shown. */
function readPairs(path: string): CalibrationPair[] {
  const pairs: CalibrationPair[] = [];
  let unread = 0;
  let notHers = 0;
  for (const text of readFileSync(resolve(ROOT, path), 'utf8').split('\n')) {
    if (text.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      unread += 1;
      continue;
    }
    const line = CorpusLineSchema.safeParse(parsed);
    if (line.success && writtenInExcludedPeriod(line.data, excluded)) {
      notHers += 1;
      continue;
    }
    const pair = line.success ? pairOfCorpusLine(line.data) : null;
    if (pair === null) unread += 1;
    else
      pairs.push({
        ...pair,
        comment: commentForPrompt(pair.comment),
        caption: captionForPrompt(pair.caption),
      });
  }
  console.log(
    `Paires lues : ${String(pairs.length)}${unread > 0 ? `, ${String(unread)} lignes écartées` : ''}${notHers > 0 ? `, ${String(notHers)} dans une période écartée` : ''}`,
  );
  return pairs;
}

/** Her active persona, read on a connection that cannot write; only her version number is printed. */
async function herPersona(now: Date): Promise<ReturnType<typeof commentWriterPersona>> {
  const admin = readOnlyAdminDb(`${COMMAND} (persona)`, false);
  try {
    const rows = await admin.db
      .select({
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
    if (row === undefined) fail('aucune persona active pour cette créatrice.');
    if (wanted === undefined && other !== undefined)
      fail('précise --creator : plusieurs créatrices ont une persona.');
    console.log(`Persona : version ${row.version} (en vigueur dans le CRM)`);
    return commentWriterPersona(
      { version: row.version, creatorName: row.creatorName, persona: StoredPersonaSchema.parse(row.content) },
      now,
    );
  } finally {
    await admin.close();
  }
}

const now = new Date();
const pairs = readPairs(values.corpus);
if (pairs.length <= count.data) fail('il faut plus de paires que --count : le reste sert d’exemples.');
const { test, bank } = setAside(pairs, count.data, seed.data);
const examples = bank.map((pair, index) => ({ id: String(index), comment: pair.comment, reply: pair.reply }));
const persona = await herPersona(now);

const credentials = readProviderCredentials(
  values['key-from-crm'] ? { ...process.env, ...(await crmKeys(`${COMMAND} --key-from-crm`)) } : process.env,
);
if (credentials.LLM_XAI_API_KEY === undefined) fail('aucune clé xAI, rien ne peut être mesuré.');
const log = createInMemoryCallLog();
const gateway = createLlmGateway({
  config: DEFAULT_LLM_CONFIG,
  credentials,
  resolveModel: createModelResolver(credentials),
  log,
  dailyCapEur: () => capEur.data,
});

interface Row {
  readonly comment: string;
  readonly hers: string;
  readonly outcome: CommentOutcome;
  readonly mayAsk: boolean;
  readonly rewritten: boolean;
  readonly refusedBy: readonly string[];
}

const rows: Row[] = [];
const day = { replies: 0, questions: 0 };
for (const pair of test) {
  const mayAsk = mayAskQuestion(day, QUESTION_EVERY_BOUNDS.default);
  const recentReplies = rows
    .flatMap((row) => (row.outcome.kind === 'reply' ? [row.outcome.text] : []))
    .slice(-RECENT_REPLIES);
  const near = nearExamples(pair.comment, examples);
  const shape = replyShapeOf(near);
  const attempts: GuardedAttempt[] = [];
  let refusedBy: string[] = [];
  // As in production: the code's own detectors run first, and an age doubt or a distress never reaches the model.
  const signs = safetySigns(pair.comment, now);
  const before = beforeModel(
    {
      fromOwnAccount: false,
      authorAgeDoubtOpen: false,
      ageDoubtDetected: signs.includes('minor_suspected'),
      distressDetected: signs.includes('self_harm'),
      repliesToAuthorToday: 0,
      repliesInThread: 0,
    },
    { perAuthorPerDay: 1, perThread: 1 },
  );
  if (before.step === 'handoff')
    attempts.push({ outcome: { kind: 'handoff', handoff: before.handoff, reason: 'code' }, violations: [] });
  else
    for (;;) {
      const result = await gateway.instagramComment({
        creatorName: persona.creatorName,
        personaSheet: persona.personaSheet,
        examples: [],
        recentReplies,
        nearExamples: near,
        ...(shape === null ? {} : { replyShape: shape }),
        comment: {
          comment: pair.comment,
          mediaKind: pair.mediaKind,
          caption: pair.caption,
          postAgeHours: 2,
          repliesToHer: false,
          authorCommentedBefore: false,
          mayAsk,
          emojiOnly: declaresLove(pair.comment),
        },
        ...(refusedBy.length > 0 ? { refusedBy } : {}),
        trace: {},
      });
      if (!result.ok) {
        attempts.push({
          outcome: { kind: 'handoff', handoff: 'other', reason: result.error.code },
          violations: [],
        });
        break;
      }
      const outcome = result.value.output;
      const violations =
        outcome.kind === 'reply'
          ? checkReply(outcome.text, {
              recentReplies,
              mayAsk,
              emojiOnly: declaresLove(pair.comment),
              chatGuardCodes: persona
                .check([outcome.text])
                .filter((violation) => violation.blocking)
                .map((violation) => violation.code),
            })
          : [];
      attempts.push({ outcome, violations });
      const next = afterGuards(attempts, true);
      if (next.step === 'settled') break;
      refusedBy = next.refusedBy.map((violation) => violation.code);
    }
  const settled = afterGuards(attempts, true);
  const outcome: CommentOutcome =
    settled.step === 'settled' ? settled.outcome : { kind: 'skip', reason: 'refused_by_guards' };
  if (outcome.kind === 'reply') {
    day.replies += 1;
    if (asksAQuestion(outcome.text)) day.questions += 1;
  }
  rows.push({
    comment: pair.comment,
    hers: pair.reply,
    outcome,
    mayAsk,
    rewritten: attempts.length > 1,
    refusedBy: attempts.flatMap((attempt) => attempt.violations.map((violation) => violation.code)),
  });
  process.stdout.write('.');
}
process.stdout.write('\n');

const modelReplies = rows.flatMap((row) => (row.outcome.kind === 'reply' ? [row.outcome.text] : []));
const outcomes: Record<string, number> = {};
const refusals: Record<string, number> = {};
for (const row of rows) {
  const key = row.outcome.kind === 'handoff' ? `handoff:${row.outcome.handoff}` : row.outcome.kind;
  outcomes[key] = (outcomes[key] ?? 0) + 1;
  for (const code of row.refusedBy) refusals[code] = (refusals[code] ?? 0) + 1;
}
const costUsd = log.since(new Date(0)).reduce((sum, record) => sum + (record.costUsd ?? 0), 0);
const numbers = {
  seed: seed.data,
  testPairs: test.length,
  bankPairs: bank.length,
  outcomes,
  rewritten: rows.filter((row) => row.rewritten).length,
  refusals,
  hers: shapeOf(test.map((pair) => pair.reply)),
  model: shapeOf(modelReplies),
  costUsd: Math.round(costUsd * 1000) / 1000,
};

mkdirSync(out, { recursive: true });
const replied = rows.flatMap((row) =>
  row.outcome.kind === 'reply' ? [{ comment: row.comment, hers: row.hers, model: row.outcome.text }] : [],
);
const lines = blindLines(replied, seed.data);
writeFileSync(
  resolve(out, 'aveugle.md'),
  [
    '# Laquelle est la sienne ?',
    '',
    'Pour chaque commentaire, deux réponses : la sienne et celle de l’IA, dans un ordre tiré au sort. Note A ou B, puis compare avec cle.md.',
    '',
    ...lines.flatMap((line, index) => [
      `## ${String(index + 1)}. ${line.comment}`,
      '',
      `- A : ${line.a}`,
      `- B : ${line.b}`,
      '',
    ]),
  ].join('\n'),
);
writeFileSync(
  resolve(out, 'cle.md'),
  ['# Clé', '', ...lines.map((line, index) => `${String(index + 1)}. ${line.hers}`)].join('\n'),
);
writeFileSync(resolve(out, 'reponses.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n'));
writeFileSync(resolve(out, 'chiffres.json'), JSON.stringify(numbers, null, 2));
console.log(JSON.stringify(numbers, null, 2));
console.log(`Fichiers dans ${values.out} (aveugle.md, cle.md, reponses.jsonl, chiffres.json).`);
