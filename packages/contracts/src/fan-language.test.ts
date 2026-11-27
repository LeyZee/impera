import { describe, expect, it } from 'vitest';

import { FanLanguageViewSchema, GUARDED_LANGUAGES } from './fan-language';
import { FanIdSchema, newId } from './ids';
import { LANGUAGE_LABELS_FR, LANGUAGES, PERSONA_OPTIONS } from './persona';

describe('the languages as people read them (ADR 0168)', () => {
  it('names every language in French, and the persona’s choice list says the same names', () => {
    for (const language of LANGUAGES) expect(LANGUAGE_LABELS_FR[language].trim(), language).not.toBe('');
    expect(Object.keys(LANGUAGE_LABELS_FR).toSorted()).toEqual([...LANGUAGES].toSorted());
    expect(PERSONA_OPTIONS.languages).toEqual(
      LANGUAGES.map((value) => ({ value, label: LANGUAGE_LABELS_FR[value] })),
    );
  });

  it('covers only languages of the list', () => {
    for (const language of GUARDED_LANGUAGES) expect(LANGUAGES).toContain(language);
  });

  it('answers his language with her persona’s languages, in her order, and refuses an ISO code', () => {
    const fanId = newId(FanIdSchema);
    const view = { fanId, language: null, personaLanguages: ['italian', 'french'] };
    const parsed = FanLanguageViewSchema.safeParse(view);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(FanLanguageViewSchema.safeParse({ ...view, personaLanguages: ['it'] }).success).toBe(false);
    expect(FanLanguageViewSchema.safeParse({ fanId, language: null }).success).toBe(false);
  });
});
