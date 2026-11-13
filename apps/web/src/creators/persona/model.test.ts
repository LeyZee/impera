import { PERSONA_OPTIONS, PERSONA_SHEET, type PersonaV2 } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import demoYaml from '../../../../../personas/demo/v0.3.0.yaml?raw';
import exampleYaml from '../../../../../personas/messalina/v0.1.0.yaml?raw';

import {
  appendPick,
  changedFields,
  collectOrAll,
  desireHint,
  draftCompletion,
  emojiKey,
  fileRefusal,
  firstDraft,
  followUpsSummary,
  foreignFileQuestion,
  hasChange,
  importedDraft,
  isPlaceholder,
  issueCountByPanel,
  issueCountByTab,
  issuesOf,
  localDay,
  localTime,
  matchOptions,
  minutesLabel,
  moveLabel,
  nextVersion,
  nicknameOf,
  NOTHING_REFUSED,
  nudgesSummary,
  panelOf,
  panelOfCorrection,
  panelTitle,
  refusedLineIssues,
  refusedReplyIssues,
  schemaIssues,
  scoped,
  stillRefused,
  strategySummaries,
  TABS,
  tabOfField,
  togglePick,
  TYPICAL_RESPONSES,
  UNREADABLE_FILE,
  validate,
  versionOnSave,
  withAnswer,
  withIssues,
  withoutPlaceholders,
  type Answer,
  type Draft,
  type PanelKey,
} from './model';
import { parsePersonaYaml } from './source';

const example = (): Promise<PersonaV2> => parsePersonaYaml(exampleYaml);
const demo = (): Promise<PersonaV2> => parsePersonaYaml(demoYaml);
const HERS = '6f1c2a0e-3b4d-4e5f-8a9b-0c1d2e3f4a5b';

const answer = (draft: Draft, panel: PanelKey, key: string, value: Answer): Draft => ({
  ...draft,
  sheet: withAnswer(draft.sheet, panel, key, value),
});

describe('The screen of ADR 0079', () => {
  it('has two tabs, her sheet then the agent’s settings, and Desirali’s seven panels', () => {
    expect(TABS.map((t) => t.label)).toEqual(['Sa fiche', 'Réglages de l’agent']);
    expect(PERSONA_SHEET.map((s) => panelTitle(s.key))).toEqual([
      'Identité et informations de base',
      'Mode de vie',
      'Préférences',
      'Style de conversation',
      'Relations',
      'Intimité',
      // The last panel has no title at Desirali: its one question names it.
      'Zones interdites',
    ]);
  });

  it('puts a field in its panel and its tab', () => {
    expect(panelOf('sheet.identity.nickname')).toBe('identity');
    expect(panelOf('sheet.conversation.typical_responses')).toBe('conversation');
    expect(panelOf('agent.rules.never_do')).toBeUndefined();
    expect(tabOfField('agent.behavior.pet_names.1')).toBe('agent');
    expect(tabOfField('sheet.intimacy.kinks')).toBe('sheet');
    expect(tabOfField('meta.version')).toBe('sheet');
  });

  it('sends a correction of a format-1 block to the panel that took it over', () => {
    expect(panelOfCorrection('details')).toBe('identity');
    expect(panelOfCorrection('tastes')).toBe('preferences');
    expect(panelOfCorrection('intimate')).toBe('intimacy');
    expect(panelOfCorrection('writing_style')).toBe('conversation');
    expect(panelOfCorrection('limits')).toBe('boundaries');
    expect(panelOfCorrection('lifestyle')).toBe('lifestyle');
    expect(panelOfCorrection('relationships')).toBe('relationships');
  });

  it('loads the demo of the repository, which passes the schema as written', async () => {
    expect(validate(await demo())).toEqual([]);
    expect((await example()).meta.schema).toBe(2);
  });
});

describe('Validation, in French', () => {
  it('asks for her nickname and her birth on a first draft, and nothing else', async () => {
    const draft = firstDraft(await example(), HERS, null);
    const issues = validate(draft);
    expect(issues.map((i) => i.field).sort()).toEqual([
      'sheet.identity.birth_date',
      'sheet.identity.nickname',
    ]);
    expect(issuesOf(issues, 'sheet.identity.birth_date')[0]?.message).toBe('À remplir');
    expect(
      issuesOf(
        validate(answer(draft, 'identity', 'spoken_languages', [])),
        'sheet.identity.spoken_languages',
      )[0]?.message,
    ).toBe('Choisis au moins une langue.');
  });

  it('refuses a creator under 18 on the date of the version', async () => {
    const young = answer(await demo(), 'identity', 'birth_date', '2015-01-01');
    expect(issuesOf(validate(young), 'sheet.identity.birth_date')[0]?.message).toMatch(/18 ans/u);
  });

  it('writes the bounds of the measures the French way, with their unit', async () => {
    const persona = await demo();
    expect(
      issuesOf(validate(answer(persona, 'identity', 'height_m', 3)), 'sheet.identity.height_m')[0]?.message,
    ).toMatch(/^2,\d+\u00a0m/u);
    expect(
      issuesOf(validate(answer(persona, 'identity', 'height_m', Number.NaN)), 'sheet.identity.height_m')[0]
        ?.message,
    ).toBe('Nombre attendu');
  });

  it('counts the issues of each tab and each panel, and gives the agent’s blocks their own paths', async () => {
    const persona = await demo();
    const broken: Draft = {
      ...answer(persona, 'identity', 'nickname', ''),
      agent: { ...persona.agent, behavior: { ...persona.agent.behavior, response_delay_minutes: 9999 } },
    };
    const issues = validate(broken);
    expect(issueCountByTab(issues)).toEqual({ sheet: 1, agent: 1 });
    expect(issueCountByPanel(issues)).toEqual({ identity: 1 });
    expect(scoped(issues, 'agent').map((i) => i.field)).toEqual(['behavior.response_delay_minutes']);
  });

  it('never stores a placeholder nor an empty answer: null in the sheet, dropped from the lists', async () => {
    expect(withoutPlaceholders(await example())).toMatchObject({
      sheet: { lifestyle: { pets: null }, intimacy: { kinks: null }, boundaries: { off_limits: null } },
    });
    expect(withoutPlaceholders(answer(await demo(), 'preferences', 'religion', '   '))).toMatchObject({
      sheet: { preferences: { religion: null } },
    });
    // The required ones stay empty text, refused as « À remplir ».
    expect(withoutPlaceholders(answer(await demo(), 'identity', 'nickname', ''))).toMatchObject({
      sheet: { identity: { nickname: '' } },
    });
    expect(withoutPlaceholders({ list: ['<à remplir>', 'vrai'] })).toEqual({ list: ['vrai'] });
  });

  it('tells a placeholder of the example from a real value', () => {
    expect(isPlaceholder('<à remplir>')).toBe(true);
    expect(isPlaceholder(" <à remplir : ce qu'elle refuse de faire> ")).toBe(true);
    expect(isPlaceholder('<3 toi')).toBe(false);
    expect(isPlaceholder('<Zoé>')).toBe(false);
  });
});

describe('A new creator', () => {
  it('starts from the example with nothing nobody typed, her first name as nickname (CREA-13)', async () => {
    const draft = firstDraft(await example(), HERS, 'Inès Martin');
    expect(nicknameOf(draft)).toBe('Inès');
    expect(draft.sheet.identity['birth_date']).toBe('');
    expect(draft.meta).toMatchObject({ creator: HERS, notes: null, version: '0.0.0' });
    expect(nicknameOf(firstDraft(await example(), HERS, null))).toBe('');
  });

  it('dates a version on the local calendar, not on UTC (recette 28/10)', () => {
    expect(localDay(new Date(2026, 9, 28, 0, 30))).toBe('2026-10-28');
  });
});

describe('Completion, out of 61 (ADR 0079 § 6, ADR 0090 § C)', () => {
  it('counts the questions answered, the time zone always, never a placeholder', async () => {
    const empty = draftCompletion(firstDraft(await example(), HERS, null));
    expect(empty.total).toBe(61);
    expect(empty.answered).toBe(2);
    expect(empty.missing).toHaveLength(7);
    expect(empty.missing[0]?.section).toBe('identity');
    expect(draftCompletion(await demo()).answered).toBeGreaterThan(50);
  });

  it('never says complete while a field of a panel waits to be fixed (CREA-14)', () => {
    const full = { answered: 61, total: 61, percent: 100, missing: [] };
    const held = withIssues(full, [
      { field: 'sheet.relationships.body_count', message: 'Nombre entier attendu' },
    ]);
    expect(held.percent).toBe(99);
    expect(held.missing).toEqual([{ section: 'relationships', left: 1 }]);
    expect(withIssues(full, [{ field: 'agent.rules.never_do.0', message: 'x' }])).toBe(full);
  });
});

describe('What changed', () => {
  it('lists the answers changed, a list counting as one field', async () => {
    const persona = await demo();
    const draft = answer(persona, 'preferences', 'passions', 'La danse');
    expect(changedFields(persona, draft)).toEqual(['sheet.preferences.passions']);
    expect(hasChange(changedFields(persona, draft), 'sheet.preferences')).toBe(true);
    expect(hasChange(changedFields(persona, draft), 'agent')).toBe(false);
  });
});

describe('Importing a file', () => {
  it('keeps the number of an imported file after every stored version, the next one otherwise', () => {
    expect(versionOnSave('1.0.0', ['0.2.0', '0.1.0'], true)).toBe('1.0.0');
    expect(versionOnSave('0.2.0', ['0.2.0'], true)).toBe('0.2.1');
    expect(nextVersion(['0.1.2', '0.0.9', '0.1.10'])).toBe('0.1.11');
  });

  it('makes the file hers: the creator it names is the one importing it', async () => {
    const persona = await demo();
    const mine = importedDraft(persona, HERS);
    expect(mine.meta.creator).toBe(HERS);
    expect({ ...mine, meta: persona.meta }).toEqual(persona);
  });

  it('asks before importing a file that reads as another creator’s, by her nickname (PRO-27)', async () => {
    const elena = await demo();
    const other = '7a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    const named = (nickname: string, creator: string): PersonaV2 => ({
      ...elena,
      meta: { ...elena.meta, creator },
      sheet: { ...elena.sheet, identity: { ...elena.sheet.identity, nickname } },
    });
    const ines = named('Inès', HERS);
    expect(foreignFileQuestion(elena, ines, HERS)).toMatch(
      /^Ce fichier est celui d’Elena \(demo\) : l’importer sur la fiche d’Inès \?$/u,
    );
    expect(foreignFileQuestion(named('Inès', other), ines, HERS)).toBe(
      'Ce fichier est celui d’Inès : l’importer sur la fiche d’Inès ?',
    );
    expect(foreignFileQuestion(named(' inès ', 'ines'), ines, HERS)).toBeNull();
    expect(foreignFileQuestion(elena, firstDraft(await example(), HERS, null), HERS)).toBeNull();
  });

  it('says how many problems a file has, and the first in its panel and its key', async () => {
    const persona = await demo();
    const broken = {
      ...persona,
      sheet: { ...persona.sheet, identity: { ...persona.sheet.identity, nickname: '' } },
      agent: { ...persona.agent, behavior: { ...persona.agent.behavior, response_delay_minutes: 9999 } },
    };
    expect(fileRefusal(schemaIssues(broken))).toBe(
      'Ce fichier ne passe pas la vérification de la persona : 2 problèmes ; le premier, dans « Identité et informations de base » (sheet.identity.nickname) : À remplir. Rien n’a changé.',
    );
    expect(fileRefusal([{ field: 'agent.behavior.pet_names', message: 'x' }])).toMatch(
      /dans « Réglages de l’agent »/u,
    );
    expect(fileRefusal([{ field: 'details.first_name', message: 'À remplir' }], 1)).toBe(
      'Ce fichier ne passe pas la vérification de la persona : un problème, (details.first_name) : À remplir. Rien n’a changé.',
    );
    expect(fileRefusal([])).toBe(UNREADABLE_FILE);
  });

  it('says where a conversion put an answer that had no question of its own', () => {
    expect(moveLabel({ from: 'Origine', to: { section: 'identity', key: 'nickname' } })).toBe(
      'Origine\u00a0: dans «\u00a0Identité et informations de base\u00a0› Surnom\u00a0»',
    );
  });
});

describe('« Réponses typiques » refused by the guards', () => {
  it('names each line refused, from 1, with its guards, on the field', () => {
    const text = 'a\nb\nc\nd\ne';
    const [issue, ...rest] = refusedLineIssues(
      [
        { index: 4, code: 'ai_disclosure' },
        { index: 0, code: 'ai_disclosure' },
        { index: 4, code: 'ai_disclosure' },
      ],
      text,
    );
    expect(rest).toEqual([]);
    expect(issue?.field).toBe(TYPICAL_RESPONSES);
    expect(issue?.message).toMatch(
      /^L’agent ne les enverrait pas : ligne 1 \([^)]+\) ; ligne 5 \([^)]+\)\. Corrige ou retire ces lignes\.$/u,
    );
    expect(refusedLineIssues([], text)).toEqual([]);
    // A line the text sent does not have: the refusal does not read.
    expect(refusedLineIssues([{ index: 5, code: 'ai_disclosure' }], text)).toEqual([]);
  });

  it('keeps the refusal until « Réponses typiques » changes, whatever else is edited', async () => {
    const persona = await demo();
    const text = persona.sheet.conversation.typical_responses;
    const refused = { issues: refusedLineIssues([{ index: 0, code: 'ai_disclosure' }], text), text };
    expect(stillRefused(refused, answer(persona, 'preferences', 'passions', 'Autre'))).toHaveLength(1);
    expect(stillRefused(refused, answer(persona, 'conversation', 'typical_responses', 'Coucou toi'))).toEqual(
      [],
    );
    expect(stillRefused(NOTHING_REFUSED, persona)).toEqual([]);
  });
});

describe('Her objection replies refused by the guards (ADR 0090 § B)', () => {
  const bank = {
    too_expensive: [
      { id: 'testaaaaaaaa', text: 'Réplique de test A' },
      { id: 'testbbbbbbbb', text: 'Réplique de test B' },
    ],
  };

  it('names each reply refused, from 1 in its kind, on its kind, and leaves « Réponses typiques » alone', () => {
    const faults = [{ index: 1, code: 'discount' as const, objection: 'too_expensive' as const }];
    const [issue, ...rest] = refusedReplyIssues(faults, bank);
    expect(rest).toEqual([]);
    expect(issue?.field).toBe('agent.objection_replies.too_expensive');
    expect(issue?.message).toMatch(
      /^L’agent ne les dirait pas : réplique 2 \([^)]+\)\. Corrige ou retire cette réplique\.$/u,
    );
    expect(refusedLineIssues(faults, 'a')).toEqual([]);
    // A reply the bank sent does not have: the refusal does not read.
    expect(refusedReplyIssues([{ index: 2, code: 'discount', objection: 'too_expensive' }], bank)).toEqual(
      [],
    );
  });

  it('keeps the refusal until her bank changes', async () => {
    const persona = await demo();
    const banked = { ...persona, agent: { ...persona.agent, objection_replies: bank } };
    const issues = refusedReplyIssues([{ index: 0, code: 'discount', objection: 'too_expensive' }], bank);
    const refused = { ...NOTHING_REFUSED, replies: { issues, bank: JSON.stringify(bank) } };
    expect(stillRefused(refused, answer(banked, 'preferences', 'passions', 'Autre'))).toHaveLength(1);
    expect(stillRefused(refused, { ...banked, agent: { ...banked.agent, objection_replies: {} } })).toEqual(
      [],
    );
  });
});

describe('Agent settings, their words', () => {
  it('writes the summary lines of the folded blocks', async () => {
    const { agent } = await example();
    const lines = strategySummaries(agent.strategies);
    expect(Object.keys(lines)).toEqual(['kyc', 'sexualization', 'script_launch', 'post_offer']);
    expect(lines.sexualization).toMatch(/24 h/u);
    expect(followUpsSummary(agent.follow_ups)).toMatch(/12 h.*23 h/u);
    expect(nudgesSummary(agent.follow_ups.nudges)).toMatch(/^Désactivés?$/u);
    expect(minutesLabel(90)).toBe('1 h 30');
    expect(minutesLabel(Number.NaN)).toBe('…');
  });

  it('says a desire threshold in plain words', () => {
    expect(desireHint(45, 45)).toMatch(/45/u);
    expect(desireHint(undefined, 75)).toMatch(/^Par défaut : 75/u);
  });

  it('keeps her order of the canvas lines, and leaves them absent only when all in the canvas order', () => {
    expect(appendPick(['age', 'first_name'], 'job')).toEqual(['age', 'first_name', 'job']);
    expect(collectOrAll(['age', 'first_name'])).toEqual(['age', 'first_name']);
  });

  it('finds languages as typed, compares emojis without their selector, tells the time in her zone', () => {
    const languages = PERSONA_OPTIONS.languages;
    expect(matchOptions(languages, ' neer').map((o) => o.value)).toEqual(['dutch']);
    expect(togglePick(languages, ['italian'], 'french')).toEqual(['french', 'italian']);
    expect(emojiKey('❤️')).toBe(emojiKey('❤'));
    expect(localTime('Europe/Paris', new Date('2026-10-17T20:25:00Z'))).toBe('22 h 25');
    expect(localTime('Nowhere/Zone')).toBe('');
  });
});
