import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { PersonaSchema, type Persona } from './persona';
import { PERSONA_CORRECTION_SECTIONS, PersonaCorrectionSectionSchema } from './persona-api';
import {
  asPersonaV2,
  PERSONA_SHEET,
  PERSONA_SHEET_QUESTION_COUNT,
  PERSONA_SHEET_SECTION_KEYS,
  personaSheetCompletion,
  personaSheetFromV1,
  PersonaSheetSchema,
  PersonaV2Schema,
  StoredPersonaSchema,
  type PersonaV2,
} from './persona-sheet';

const personaFile = (path: string): unknown =>
  parse(readFileSync(fileURLToPath(new URL(`../../../personas/${path}`, import.meta.url)), 'utf8'));

const demo = (): PersonaV2 => PersonaV2Schema.parse(personaFile('demo/v0.3.0.yaml'));
const v1 = (path = 'demo/v0.2.0.yaml'): Persona => PersonaSchema.parse(personaFile(path));

const issuePaths = (value: unknown) => {
  const result = PersonaV2Schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
};

describe('PERSONA_SHEET (ADR 0079)', () => {
  it('holds Desirali’s 59 questions in 7 panels, the last one without a title, and the voice guide’s two', () => {
    expect(PERSONA_SHEET_QUESTION_COUNT).toBe(61);
    expect(PERSONA_SHEET.map((s) => s.questions.length)).toEqual([15, 6, 11, 10, 7, 11, 1]);
    expect(PERSONA_SHEET[3]?.questions.slice(-2).map((q) => q.label)).toEqual([
      'Comment elle dit non',
      'Ce qu’elle n’écrirait jamais',
    ]);
    expect(PERSONA_SHEET.map((s) => s.title)).toEqual([
      'Identité et informations de base',
      'Mode de vie',
      'Préférences',
      'Style de conversation',
      'Relations',
      'Intimité',
      null,
    ]);
    expect(PERSONA_SHEET.map((s) => s.key)).toEqual([...PERSONA_SHEET_SECTION_KEYS]);
  });

  it('puts « Pratiques / Kinks » between the ejaculation and fetishism questions, and « Zones interdites » last', () => {
    const intimacy = PERSONA_SHEET[5]?.questions.map((q) => q.label) ?? [];
    expect(intimacy.slice(5, 8)).toEqual(["Rapport à l'éjaculation", 'Pratiques / Kinks', 'Fétichisme']);
    expect(intimacy.at(-1)).toBe('Zones interdites / limites strictes');
    expect(PERSONA_SHEET.at(-1)?.questions.map((q) => q.label)).toEqual(['Zones interdites']);
  });

  it('names exactly the keys of the file, panel by panel; the time zone alone is the creator’s own', () => {
    for (const section of PERSONA_SHEET) {
      const keys = section.questions.map((q) => q.key).filter((key) => key !== 'timezone');
      expect(keys).toEqual(Object.keys(PersonaSheetSchema.shape[section.key].shape));
    }
  });

  it('asks only for the nickname, the birth date and a language', () => {
    const required = PERSONA_SHEET.flatMap((s) =>
      s.questions.filter((q) => q.required === true).map((q) => q.key),
    );
    expect(required).toEqual(['birth_date', 'nickname', 'spoken_languages']);
  });
});

describe('PersonaV2Schema', () => {
  it('reads the demo and the placeholder of the repository', () => {
    expect(demo().sheet.identity.nickname).toBe('Elena');
    expect(PersonaV2Schema.safeParse(personaFile('messalina/v0.1.0.yaml')).success).toBe(true);
  });

  it('takes free text where we had choice lists: an eye colour is written as she says it', () => {
    const p = demo();
    p.sheet.identity.eye_color = 'vert d’eau, presque gris';
    expect(issuePaths(p)).toEqual([]);
  });

  it('refuses an empty answer instead of storing it: the screen sends null', () => {
    const p = demo();
    p.sheet.lifestyle.pets = '   ';
    expect(issuePaths(p)).toEqual(['sheet.lifestyle.pets']);
  });

  it('refuses a creator under 18 or over 100 on the date of the version', () => {
    const young = demo();
    young.sheet.identity.birth_date = '2010-01-01';
    expect(issuePaths(young)).toEqual(['sheet.identity.birth_date']);
    const old = demo();
    old.sheet.identity.birth_date = '1890-01-01';
    expect(issuePaths(old)).toEqual(['sheet.identity.birth_date']);
  });

  it('says an emptied birth date is invalid instead of throwing', () => {
    const p = demo();
    p.sheet.identity.birth_date = '';
    expect(issuePaths(p)).toContain('sheet.identity.birth_date');
  });

  it('wants a nickname and a language, a whole number of partners, and refuses unknown keys', () => {
    expect(
      issuePaths({
        ...demo(),
        sheet: { ...demo().sheet, identity: { ...demo().sheet.identity, nickname: '' } },
      }),
    ).toEqual(['sheet.identity.nickname']);
    const p = demo();
    p.sheet.identity.spoken_languages = [];
    p.sheet.relationships.body_count = 2.5;
    expect(issuePaths(p)).toEqual(['sheet.identity.spoken_languages', 'sheet.relationships.body_count']);
    expect(issuePaths({ ...demo(), sheet: { ...demo().sheet, avoid_topics: null } })).toEqual(['sheet']);
  });

  it('refuses « Réponses typiques » past 200 lines: a line past them would reach the model unchecked', () => {
    const p = demo();
    p.sheet.conversation.typical_responses = Array.from({ length: 201 }, () => 'ok').join('\n');
    expect(issuePaths(p)).toEqual(['sheet.conversation.typical_responses']);
    p.sheet.conversation.typical_responses = Array.from({ length: 200 }, () => 'ok').join('\n');
    expect(issuePaths(p)).toEqual([]);
  });

  it('keeps the guards’ word lists in the agent’s settings, with the same checks', () => {
    const p = demo();
    p.agent.rules.never_say = ['?'];
    expect(issuePaths(p)).toEqual(['agent.rules.never_say.0']);
  });
});

describe('the voice guide and the objection replies (ADR 0090)', () => {
  it('reads a version written before them: no guide, an empty bank', () => {
    const before = demo();
    expect(before.sheet.conversation.limit_setting_description).toBeNull();
    expect(before.sheet.conversation.sounds_wrong_description).toBeNull();
    expect(before.agent.objection_replies).toEqual({});
  });

  it('reads the demo’s test replies, and refuses two replies with the same id', () => {
    const now = PersonaV2Schema.parse(personaFile('demo/v0.4.0.yaml'));
    expect(now.sheet.conversation.limit_setting_description).toContain('Refuse en riant');
    expect(now.agent.objection_replies.too_expensive?.map((r) => r.id)).toEqual([
      'testtooexpa',
      'testtooexpb',
    ]);
    const twice = structuredClone(now);
    twice.agent.objection_replies.asks_discount = [{ id: 'testtooexpa', text: 'Réplique de test D' }];
    expect(issuePaths(twice)).toEqual(['agent.objection_replies']);
  });
});

describe('StoredPersonaSchema', () => {
  it('reads both formats, and no file at a format it does not know', () => {
    expect(StoredPersonaSchema.safeParse(personaFile('demo/v0.1.0.yaml')).success).toBe(true);
    expect(StoredPersonaSchema.safeParse(personaFile('demo/v0.3.0.yaml')).success).toBe(true);
    const unknown = { ...demo(), meta: { ...demo().meta, schema: 3 } };
    expect(StoredPersonaSchema.safeParse(unknown).success).toBe(false);
  });
});

describe('personaSheetFromV1 (ADR 0079 § 5)', () => {
  it('gives a valid format-2 draft for every format-1 file of the repository', () => {
    for (const path of ['demo/v0.1.0.yaml', 'demo/v0.2.0.yaml', 'messalina/v0.0.0.yaml']) {
      const { persona } = personaSheetFromV1(v1(path));
      expect(PersonaV2Schema.safeParse(persona).success, path).toBe(true);
    }
  });

  it('puts each value where Desirali asks for it', () => {
    const { persona } = personaSheetFromV1(v1());
    const { identity } = persona.sheet;
    expect(identity).toMatchObject({
      nickname: 'Elena',
      birth_date: '2001-04-12',
      height_m: 1.65,
      shoe_size: '38',
      eye_color: 'Verts',
      breast_size: '75C',
      spoken_languages: ['french', 'spanish', 'english'],
    });
    expect(persona.sheet.conversation.favourite_emojis).toBe('😏 ✨ 🙈');
    expect(persona.sheet.conversation.typical_responses).toContain('Arrête tu vas me faire rougir 🙈');
    expect(persona.meta).toMatchObject({ schema: 2, version: '0.2.0' });
  });

  it('moves the agent’s settings out of the sheet unchanged, and the forbidden emojis into the rules', () => {
    const before = v1();
    const { persona } = personaSheetFromV1(before);
    expect(persona.agent.strategies).toEqual(before.strategies);
    expect(persona.agent.follow_ups).toEqual(before.follow_ups);
    expect(persona.agent.notifications).toEqual(before.notifications);
    expect(persona.agent.rules).toEqual({ ...before.limits, emojis_forbidden: ['😂'] });
  });

  it('loses nothing in silence: what has no question of its own is said, with where it went', () => {
    const { persona, moved } = personaSheetFromV1(v1());
    expect(moved.map((m) => m.from)).toEqual([
      'Origine',
      'Caractère',
      'Langage',
      'Style d’écriture',
      'Informations additionnelles',
      'Objectifs',
      'N’aime pas',
      'Aime',
      'Limites (ne fait jamais, ne montre jamais)',
    ]);
    expect(persona.sheet.conversation.roleplaying_description).toContain('Objectifs : ');
    expect(persona.sheet.intimacy.no_go_zones).toContain('Ne fait jamais : Rencontrer un fan');
  });

  it('says when it cuts an answer to its question’s length', () => {
    const { persona, moved } = personaSheetFromV1({ ...v1(), additional_info: 'x'.repeat(6000) });
    expect(persona.sheet.conversation.roleplaying_description).toHaveLength(4000);
    expect(moved).toContainEqual({
      from: 'Texte coupé à 4000 caractères',
      to: { section: 'conversation', key: 'roleplaying_description' },
    });
  });

  it('says no move for a value left empty', () => {
    const before = v1('messalina/v0.0.0.yaml');
    const { moved } = personaSheetFromV1({ ...before, additional_info: '' });
    expect(moved.map((m) => m.from)).not.toContain('Informations additionnelles');
  });

  it('is what the agent reads of a stored format-1 version, and leaves a format-2 one as it is', () => {
    expect(asPersonaV2(v1())).toEqual(personaSheetFromV1(v1()).persona);
    expect(asPersonaV2(demo())).toEqual(demo());
  });
});

describe('personaSheetCompletion', () => {
  it('counts the questions answered out of 61, the time zone always answered', () => {
    expect(personaSheetCompletion(demo().sheet)).toEqual({
      answered: 57,
      total: 61,
      percent: 93,
      missing: [
        { section: 'identity', left: 1 },
        { section: 'conversation', left: 2 },
        { section: 'relationships', left: 1 },
      ],
    });
    const empty = personaSheetFromV1(v1('messalina/v0.0.0.yaml')).persona.sheet;
    expect(personaSheetCompletion(empty).missing.map((m) => m.section)).toContain('boundaries');
  });
});

describe('corrections', () => {
  it('reads the old sections and Desirali’s panels alike', () => {
    for (const section of [...PERSONA_CORRECTION_SECTIONS, ...PERSONA_SHEET_SECTION_KEYS]) {
      expect(PersonaCorrectionSectionSchema.safeParse(section).success, section).toBe(true);
    }
  });
});
