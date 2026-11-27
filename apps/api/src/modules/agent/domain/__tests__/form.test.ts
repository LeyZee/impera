import { describe, expect, it } from 'vitest';

import {
  checkForm,
  DEFAULT_FORM_SETTINGS,
  formBubble,
  formBubbles,
  resolveForm,
  type FormSettings,
} from '../form';
import { checkVoiceOutput, DEFAULT_GUARD_SETTINGS, wantsRewrite } from '../guards';

// Invented bubbles (CLAUDE.md: no real fan or creator data).
const free: FormSettings = { capitalization: 'free', stripFinalPeriod: false, markSpacing: 'free' };

describe('the form of her bubbles (formBubble)', () => {
  it('leaves a bubble as written when every rule is free', () => {
    expect(formBubble('salut toi. Ça va ?', free)).toBe('salut toi. Ça va ?');
  });

  it('puts a capital at the start of a bubble, or lower case, or leaves it', () => {
    const capital = { ...free, capitalization: 'capital' as const };
    const lower = { ...free, capitalization: 'lowercase' as const };
    expect(formBubble('salut toi', capital)).toBe('Salut toi');
    expect(formBubble('  écoute', capital)).toBe('  Écoute');
    expect(formBubble('😏 salut', capital)).toBe('😏 salut');
    expect(formBubble('Salut toi', lower)).toBe('salut toi');
    expect(formBubble('J’arrive', lower)).toBe('j’arrive');
    // A word in capitals keeps them.
    expect(formBubble('OK ça marche', lower)).toBe('OK ça marche');
    expect(formBubble('salut toi', { ...free })).toBe('salut toi');
  });

  it('takes one final period off, never an ellipsis', () => {
    const strip = { ...free, stripFinalPeriod: true };
    expect(formBubble('à demain.', strip)).toBe('à demain');
    expect(formBubble('à demain. ', strip)).toBe('à demain');
    expect(formBubble('bon. on verra', strip)).toBe('bon. on verra');
    expect(formBubble('on verra...', strip)).toBe('on verra...');
    expect(formBubble('on verra…', strip)).toBe('on verra…');
    expect(formBubble('à demain.', free)).toBe('à demain.');
  });

  it('puts a space before « ? » and « ! », takes it off, or leaves it', () => {
    const space = { ...free, markSpacing: 'space' as const };
    const none = { ...free, markSpacing: 'none' as const };
    expect(formBubble('ça va? trop bien!', space)).toBe('ça va ? trop bien !');
    expect(formBubble('quoi?!', space)).toBe('quoi ?!');
    expect(formBubble('ça va ?', space)).toBe('ça va ?');
    expect(formBubble('ça va ? trop bien !', none)).toBe('ça va? trop bien!');
    expect(formBubble('quoi ?!', none)).toBe('quoi?!');
    expect(formBubble('ça va?', { ...free })).toBe('ça va?');
  });

  it('applies the defaults: free capitals and spaces, no final period', () => {
    expect(formBubbles(['Salut toi.', 'ça va ?'], DEFAULT_FORM_SETTINGS)).toEqual(['Salut toi', 'ça va ?']);
  });
});

describe('her form, guarded and resolved', () => {
  it('flags what the code puts right, softly and without a rewrite', () => {
    expect(checkForm(['à demain.', 'ok'], DEFAULT_FORM_SETTINGS)).toEqual([
      { code: 'form_rule', severity: 'soft', bubbleIndex: 0, match: 'à demain.' },
    ]);
    const violations = checkVoiceOutput(['à demain.'], DEFAULT_GUARD_SETTINGS, { previousTurns: [] });
    expect(violations.map((v) => v.code)).toEqual(['form_rule']);
    expect(wantsRewrite(violations)).toBe(false);
    // A lone sample of her bank is not read for it.
    expect(checkVoiceOutput(['à demain.'], DEFAULT_GUARD_SETTINGS)).toEqual([]);
  });

  it('takes each rule from the first layer that sets it, then the default', () => {
    expect(resolveForm([])).toEqual({ form: DEFAULT_FORM_SETTINGS });
    expect(
      resolveForm([
        { capitalization: 'lowercase' },
        { capitalization: 'capital', mark_spacing: 'space', strip_final_period: false, emoji_streak_max: 2 },
      ]),
    ).toEqual({
      form: { capitalization: 'lowercase', stripFinalPeriod: false, markSpacing: 'space' },
      emojiStreakMax: 2,
    });
  });

  it('never lets « mdr », « ahah » or « lol » through, stretched or not', () => {
    for (const laugh of ['ahah t’es bête', 'AHAHAH', 'ahahah ok', 'lol', 'loool non', 'mdr']) {
      expect(checkVoiceOutput([laugh], DEFAULT_GUARD_SETTINGS).map((v) => v.code)).toContain(
        'forbidden_term',
      );
    }
    expect(checkVoiceOutput(['un lolita'], DEFAULT_GUARD_SETTINGS).map((v) => v.code)).not.toContain(
      'forbidden_term',
    );
  });
});
