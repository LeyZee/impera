import {
  KycSlotSchema,
  PERSONA_OPTIONS,
  personaCompletion,
  PersonaSchema,
  type Persona,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import demoYaml from '../../../../../personas/demo/v0.1.0.yaml?raw';
import blocksYaml from '../../../../../personas/demo/v0.2.0.yaml?raw';
import exampleYaml from '../../../../../personas/messalina/v0.0.0.yaml?raw';

import {
  appendPick,
  collectOrAll,
  draftCompletion,
  NOTHING_REFUSED,
  stillRefused,
  emojiKey,
  desireHint,
  firstDraft,
  intimateOrNone,
  localDay,
  lifestyleOrNone,
  refusedReplyIssues,
  repliesOrNone,
  tastesOrNone,
  withoutPlaceholders,
  withIssues,
  followUpsSummary,
  issueCountByTab,
  issuesOf,
  isPlaceholder,
  changedFields,
  hasChange,
  minutesLabel,
  nudgesSummary,
  physiqueSummary,
  strategySummaries,
  IN_DEPTH_BLOCKS,
  tabOf,
  TABS,
  validate,
  localTime,
  matchOptions,
  nextVersion,
  togglePick,
} from './model';
import { parsePersonaYaml } from './source';

const example = (): Promise<Persona> => parsePersonaYaml(exampleYaml);
const demo = (): Promise<Persona> => parsePersonaYaml(demoYaml);

describe('Persona screen rules', () => {
  it('follows the tabs of OnlyChat, the P5-01 blocks in one tab after « Infos en plus », the limits last, never a negotiation', () => {
    expect(TABS.map((tab) => tab.label)).toEqual([
      'Détails',
      'Infos en plus',
      'Elle en détail',
      'Comportement',
      'Stratégies',
      'Relances',
      'Notifications',
      'Limites',
    ]);
    expect(JSON.stringify(TABS).toLowerCase()).not.toContain('négociation');
    expect(IN_DEPTH_BLOCKS.map(tabOf)).toEqual(Array(5).fill('in_depth'));
    expect(tabOf('limits')).toBe('limits');
  });

  it('loads the example of the repository, which passes the schema once she has a first name', async () => {
    const persona = await example();
    expect(persona.meta.version).toBe('0.0.0');
    expect(validate(persona).map((issue) => issue.field)).toEqual(['details.first_name']);
  });

  it('refuses a file that does not pass the schema', async () => {
    await expect(parsePersonaYaml('meta: { schema: 1 }')).rejects.toThrow();
  });

  it('names each problem in French, at its field, and counts it in its tab', async () => {
    const persona = await example();
    const draft: Persona = {
      ...persona,
      details: { ...persona.details, first_name: '', hobbies: ['Danse', 'danse'] },
      strategies: {
        ...persona.strategies,
        kyc: { ...persona.strategies.kyc, max_messages: 900 },
        sexualization: { ...persona.strategies.sexualization, initiate_after_hours: Number.NaN },
      },
    };
    const issues = validate(draft);
    expect(issuesOf(issues, 'details.first_name')).toEqual([
      { field: 'details.first_name', message: 'À remplir' },
    ]);
    expect(issuesOf(issues, 'details.hobbies')[0]?.message).toBe('Entrée en double');
    expect(issuesOf(issues, 'strategies.kyc.max_messages')[0]?.message).toBe('500\u00a0messages au plus');
    expect(issuesOf(issues, 'strategies.sexualization.initiate_after_hours')[0]?.message).toBe(
      'Nombre entier attendu',
    );
    const counts = issueCountByTab(issues);
    expect(counts.details).toBe(2);
    expect(counts.strategies).toBe(2);
    expect(counts.limits).toBe(0);
  });

  it('asks for the instructions of a custom strategy, and only then', async () => {
    const persona = await demo();
    const custom = (instructions: string | null): Persona => ({
      ...persona,
      strategies: {
        ...persona.strategies,
        kyc: { ...persona.strategies.kyc, style: 'custom', instructions },
      },
    });
    expect(issuesOf(validate(custom('')), 'strategies.kyc.instructions')[0]?.message).toBe('À remplir');
    expect(validate(custom('Pose une question à chaque message'))).toEqual([]);
    expect(issuesOf(validate(custom(null)), 'strategies.kyc.instructions')).toHaveLength(1);
  });

  it('refuses a creator under 18 on the date of the version', async () => {
    const persona = await example();
    const young = { ...persona, details: { ...persona.details, date_of_birth: '2010-01-01' } };
    expect(issuesOf(validate(young), 'details.date_of_birth')[0]?.message).toContain('18 ans');
  });

  it('writes the summary lines of the folded blocks, in hours where the schema counts hours', async () => {
    const persona = await demo();
    expect(physiqueSummary(persona.details)).toBe('165 cm · pointure 38 · cheveux noirs · yeux verts · 75C');
    const placeholder = await example();
    expect(physiqueSummary(placeholder.details)).toBe('Rien de renseigné');
    expect(strategySummaries(placeholder.strategies)).toEqual({
      kyc: 'Par défaut · 100 messages, 6 h au plus · le suit s’il chauffe après 1 h',
      sexualization: 'Par défaut · ouvre après 24 h',
      script_launch: 'Normal · au moins 10 h entre deux scripts',
      post_offer: 'Par défaut · relance après 7 jours',
    });
    expect(followUpsSummary(placeholder.follow_ups)).toBe('12 h, 23 h après son dernier message');
    expect(followUpsSummary({ ...placeholder.follow_ups, enabled: false })).toBe('Désactivées');
    expect(nudgesSummary(placeholder.follow_ups.nudges)).toBe('Désactivés');
    expect(nudgesSummary({ ...placeholder.follow_ups.nudges, enabled: true })).toBe(
      '3 rappels par jour au plus, 5 min après',
    );
  });

  it('writes minutes the way people say them', () => {
    expect(minutesLabel(45)).toBe('45 min');
    expect(minutesLabel(360)).toBe('6 h');
    expect(minutesLabel(90)).toBe('1 h 30');
    expect(minutesLabel(1445)).toBe('24 h 05');
    expect(minutesLabel(Number.NaN)).toBe('…');
  });

  it('tells a placeholder of the example from a real value', () => {
    expect(isPlaceholder('<à remplir>')).toBe(true);
    expect(isPlaceholder(" <à remplir : ce qu'elle refuse de faire> ")).toBe(true);
    expect(isPlaceholder('Chaton')).toBe(false);
    expect(isPlaceholder('<3 toi')).toBe(false);
    // A value she wrote between chevrons is hers (recette 28/10).
    expect(isPlaceholder('<Zoé>')).toBe(false);
  });

  it('says an emptied date is to fill in, and keeps the schema’s own message for a wrong emoji (recette 28/10)', async () => {
    const persona = await demo();
    const emptied = validate({ ...persona, details: { ...persona.details, date_of_birth: '' } });
    expect(emptied).toEqual([{ field: 'details.date_of_birth', message: 'À remplir' }]);
    const blocks = await parsePersonaYaml(blocksYaml);
    const style = blocks.writing_style;
    if (style === undefined) throw new Error('the demo has a writing style');
    const emojis = validate({ ...blocks, writing_style: { ...style, emojis_preferred: ['😀😀'] } });
    expect(emojis).toEqual([
      { field: 'writing_style.emojis_preferred.0', message: 'Un seul emoji par entrée' },
    ]);
  });

  it('starts a new creator from the example with nothing nobody typed (recette 28/10)', async () => {
    const draft = firstDraft(await example(), '0192f3a0-0000-7000-8000-0000000000c1');
    expect(draft.details.date_of_birth).toBe('');
    expect(draft.meta).toMatchObject({ creator: '0192f3a0-0000-7000-8000-0000000000c1', notes: null });
    expect(validate({ ...draft, details: { ...draft.details, first_name: 'Léa' } })).toEqual([
      { field: 'details.date_of_birth', message: 'À remplir' },
    ]);
    // Her name in Nirvana is known: her first name starts from its first word (CREA-13).
    const named = firstDraft(
      await example(),
      '0192f3a0-0000-7000-8000-0000000000c1',
      ' Marie-Claire Dubois ',
    );
    expect(named.details.first_name).toBe('Marie-Claire');
    expect(firstDraft(await example(), 'x', '  ').details.first_name).toBe(draft.details.first_name);
  });

  it('says a desire threshold in plain words, never « bande » (CREA-10)', () => {
    expect(desireHint(45, 30)).toBe('À partir de 45 : dès qu’il devient joueur.');
    expect(desireHint(undefined, 75)).toBe('Par défaut : 75. À partir de 75 : dès qu’il devient chaud.');
    expect(desireHint(10, 45)).toBe('À partir de 10 : même s’il reste neutre.');
  });

  it('dates a version on the local calendar, not on UTC (recette 28/10)', () => {
    // 0 h 30 on the 29th here is still the 28th in UTC west of Greenwich, or east of it the other way round.
    expect(localDay(new Date(2026, 9, 29, 0, 30))).toBe('2026-10-29');
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('never stores a placeholder: dropped from the lists, and a first name left as such is refused', async () => {
    const persona = await example();
    const stored = withoutPlaceholders({ ...persona, details: { ...persona.details, first_name: 'Léa' } });
    expect(JSON.stringify({ ...PersonaSchema.parse(stored), meta: null })).not.toContain('<à remplir');
    expect(validate({ ...persona, details: { ...persona.details, first_name: 'Léa' } })).toEqual([]);
    expect(validate(persona).map((issue) => issue.field)).toEqual(['details.first_name']);
  });

  it('lists the fields a draft changed, a list counting as one field', async () => {
    const persona = await example();
    expect(changedFields(persona, { ...persona })).toEqual([]);
    const changed = changedFields(persona, {
      ...persona,
      additional_info: 'Autre',
      details: { ...persona.details, hobbies: ['Danse', 'Lecture'] },
      strategies: { ...persona.strategies, kyc: { ...persona.strategies.kyc, max_messages: 80 } },
    });
    expect(changed).toEqual(['details.hobbies', 'additional_info', 'strategies.kyc.max_messages']);
    expect(hasChange(changed, 'strategies')).toBe(true);
    expect(hasChange(changed, 'strategies.kyc.max_messages')).toBe(true);
    expect(hasChange(changed, 'follow_ups')).toBe(false);
    expect(hasChange(changed, 'details.hob')).toBe(false);
  });

  it('finds languages as typed and keeps picks in the list order', () => {
    const languages = PERSONA_OPTIONS.languages;
    expect(matchOptions(languages, ' neer').map((o) => o.value)).toEqual(['dutch']);
    expect(matchOptions(languages, 'ESP').map((o) => o.value)).toEqual(['spanish']);
    expect(matchOptions(languages, '')).toHaveLength(languages.length);
    expect(togglePick(languages, ['italian'], 'french')).toEqual(['french', 'italian']);
    expect(togglePick(languages, ['french', 'italian'], 'french')).toEqual(['italian']);
  });

  it('tells the time in her zone, nothing for an unknown zone', () => {
    const at = new Date('2026-10-17T20:25:00Z');
    expect(localTime('Europe/Paris', at)).toBe('22 h 25');
    expect(localTime('Nowhere/Zone', at)).toBe('');
  });

  it('numbers the next version one patch above the highest taken', () => {
    expect(nextVersion(['0.0.0'])).toBe('0.0.1');
    expect(nextVersion(['0.1.2', '0.0.9', '0.1.10'])).toBe('0.1.11');
    expect(nextVersion(['1.0.0', '0.9.9'])).toBe('1.0.1');
  });
});

describe('Persona blocks (P5-01)', () => {
  const blocks = (): Promise<Persona> => parsePersonaYaml(blocksYaml);

  it('reads the completion without the placeholders of the example', async () => {
    const persona = await example();
    const raw = personaCompletion(persona);
    const read = draftCompletion(persona);
    expect(read.percent).toBeLessThan(raw.percent);
    expect(read.missing.map((m) => m.label)).toContain('Détails');
    expect(read.missing.map((m) => m.label)).toContain('Limites');
  });

  it('counts a persona whose every block is written as complete', async () => {
    const persona = await blocks();
    expect(validate(persona)).toEqual([]);
    expect(draftCompletion(persona)).toEqual({ percent: 100, missing: [] });
  });

  it('keeps an empty block absent, as a version before the blocks', () => {
    expect(lifestyleOrNone({ occupation: null, area: '  ', routine: null, goals: null })).toBeUndefined();
    expect(lifestyleOrNone({ occupation: 'Étudiante', area: null, routine: null, goals: null })).toEqual({
      occupation: 'Étudiante',
      area: null,
      routine: null,
      goals: null,
    });
    expect(tastesOrNone({ likes: [], dislikes: [] })).toBeUndefined();
    expect(tastesOrNone({ likes: ['Salsa'], dislikes: [] })).toEqual({ likes: ['Salsa'], dislikes: [] });
    expect(intimateOrNone({ turn_ons: [], fantasies: [], sexting_style: null })).toBeUndefined();
    expect(intimateOrNone({ turn_ons: [], fantasies: [], sexting_style: 'Lente' })).toBeDefined();
    expect(repliesOrNone([])).toBeUndefined();
  });

  it('compares emojis without the variation selector', () => {
    expect(emojiKey('❤️')).toBe(emojiKey('❤'));
    expect(emojiKey('🙈')).toBe('🙈');
  });

  it('names a field for each contradiction between two blocks', async () => {
    const persona = await blocks();
    const style = persona.writing_style;
    if (style === undefined) throw new Error('the demo has a writing style');
    const draft: Persona = { ...persona, writing_style: { ...style, emojis_forbidden: ['😏'] } };
    expect(issuesOf(validate(draft), 'writing_style.emojis_forbidden')).toHaveLength(1);
  });

  it('puts what the server refused on the reply it refused, one line per reply', () => {
    expect(
      refusedReplyIssues([
        { index: 2, code: 'contact_info' },
        { index: 0, code: 'ai_disclosure' },
        { index: 2, code: 'meeting_promise' },
        { index: 2, code: 'contact_info' },
      ]),
    ).toEqual([
      { field: 'sample_replies.0.reply', message: 'L’agent ne l’enverrait pas : un aveu d’IA.' },
      {
        field: 'sample_replies.2.reply',
        message: 'L’agent ne l’enverrait pas : des coordonnées, une promesse de rencontre.',
      },
    ]);
    expect(issueCountByTab(refusedReplyIssues([{ index: 1, code: 'contempt' }])).in_depth).toBe(1);
  });

  it('leaves the canvas lines absent only when she collects them all in the canvas order', () => {
    const all = [...KycSlotSchema.options];
    expect(collectOrAll(all)).toBeUndefined();
    expect(collectOrAll(['first_name', 'age'])).toEqual(['first_name', 'age']);
    // Every line, in her own order: the brain and « À apprendre » follow it, so it is kept.
    const hers = [...all.slice(1), all[0] ?? 'first_name'];
    expect(collectOrAll(hers)).toEqual(hers);
    expect(collectOrAll([])).toEqual([]);
  });

  it('adds a canvas line last, without sorting her order', async () => {
    const persona = await blocks();
    const collect = persona.strategies.kyc.collect;
    expect(collect).toEqual(['first_name', 'age', 'location', 'job', 'situation', 'hobbies']);
    expect(appendPick(collect ?? [], 'desires')).toEqual([
      'first_name',
      'age',
      'location',
      'job',
      'situation',
      'hobbies',
      'desires',
    ]);
    expect(appendPick(collect ?? [], 'job')).toEqual([
      'first_name',
      'age',
      'location',
      'situation',
      'hobbies',
    ]);
  });

  it('asks for one canvas line at least, in French', async () => {
    const persona = await blocks();
    const draft: Persona = {
      ...persona,
      strategies: { ...persona.strategies, kyc: { ...persona.strategies.kyc, collect: [] } },
    };
    expect(issuesOf(validate(draft), 'strategies.kyc.collect')).toEqual([
      { field: 'strategies.kyc.collect', message: 'Garde au moins une info à collecter.' },
    ]);
  });

  it('does not count a sample reply still empty', async () => {
    const persona = await blocks();
    const one = persona.sample_replies?.slice(0, 1) ?? [];
    const before = draftCompletion({ ...persona, sample_replies: one });
    const after = draftCompletion({ ...persona, sample_replies: [...one, { situation: null, reply: '  ' }] });
    expect(after).toEqual(before);
    expect(
      draftCompletion({ ...persona, sample_replies: [{ situation: null, reply: '' }] }).missing,
    ).toContainEqual({
      block: 'sample_replies',
      label: 'Réponses types',
    });
  });

  it('keeps a refusal on its reply until the text of that reply changes', async () => {
    const persona = await blocks();
    const replies = persona.sample_replies ?? [];
    const refused = {
      issues: refusedReplyIssues([{ index: 1, code: 'ai_disclosure' }]),
      replies: replies.map((r) => r.reply),
    };
    expect(stillRefused(refused, persona)).toHaveLength(1);
    const situation = replies.map((r, i) => (i === 1 ? { ...r, situation: null } : r));
    expect(stillRefused(refused, { ...persona, sample_replies: situation })).toHaveLength(1);
    const rewritten = replies.map((r, i) => (i === 1 ? { ...r, reply: 'Autre chose' } : r));
    expect(stillRefused(refused, { ...persona, sample_replies: rewritten })).toEqual([]);
    expect(stillRefused(refused, { ...persona, sample_replies: replies.slice(1) })).toEqual([]);
    expect(stillRefused(NOTHING_REFUSED, persona)).toEqual([]);
  });
});

describe('withIssues (CREA-14)', () => {
  const full = { percent: 100, missing: [] };

  it('never says complete while a field of a block waits to be fixed', () => {
    const issue = { field: 'details.first_name', message: 'À remplir' };
    expect(withIssues(full, [issue])).toEqual({
      percent: 99,
      missing: [{ block: 'details', label: 'Détails' }],
    });
  });

  it('keeps the gauge as it is when nothing waits, or when the field is outside the gauge', () => {
    expect(withIssues(full, [])).toBe(full);
    expect(withIssues(full, [{ field: 'strategies.reply_delay.max_seconds', message: '60 s au plus' }])).toBe(
      full,
    );
  });
});
