import { describe, expect, it } from 'vitest';

import { checkVoiceOutput, DEFAULT_GUARD_SETTINGS, wantsRewrite } from '../guards';
import { asksHisDay, hisDayAnswered } from '../his-day';
import { guardContextOf } from '../turn-history';

// Invented, sober messages (ADR 0010).
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 27, 20, minutes));

describe('her question about his evening or his day, once answered (passe 3 du 27/11)', () => {
  it('reads the question with or without its « ? », in four languages', () => {
    for (const bubble of [
      'et ta soirée elle donne quoi',
      'ta journée ça a été ?',
      'et toi, ton soir',
      'tu fais quoi ce soir',
      'how was your day',
      '¿qué tal tu día?',
      'com’è andata la tua giornata',
    ])
      expect(asksHisDay(bubble), bubble).toBe(true);
    for (const bubble of ['ma soirée est calme', 'bonne soirée à toi', 'j’adore ton sourire'])
      expect(asksHisDay(bubble), bubble).toBe(false);
  });

  it('knows it was answered: she asked and he wrote after, or he told it himself', () => {
    const asked = [
      { fromFan: false, text: 'ta soirée elle donne quoi', at: at(0) },
      { fromFan: true, text: 'Tranquille, un film', at: at(2) },
    ];
    expect(hisDayAnswered(asked)).toBe(true);
    expect(hisDayAnswered(asked.slice(0, 1))).toBe(false);
    expect(hisDayAnswered([{ fromFan: true, text: 'Ma journée a été longue', at: at(0) }])).toBe(true);
    // Another evening: the question may come back.
    expect(
      hisDayAnswered([...asked, { fromFan: true, text: 'Salut', at: new Date(Date.UTC(2026, 10, 28, 19)) }]),
    ).toBe(false);
  });

  it('makes asking it again a soft repetition, rewritten once, from the conversation', () => {
    const context = guardContextOf([
      { from: 'creator', text: 'et toi ta soirée', at: at(0) },
      { from: 'fan', text: 'Rien de fou, je cuisine', at: at(1) },
    ]);
    expect(context.hisDayAnswered).toBe(true);
    const again = checkVoiceOutput(
      ['mmh ça sent bon', 'et ta soirée sinon, ça donne quoi'],
      DEFAULT_GUARD_SETTINGS,
      context,
    );
    expect(again).toContainEqual(
      expect.objectContaining({
        code: 'repetition',
        severity: 'soft',
        bubbleIndex: 1,
        match: 'his_day_again',
      }),
    );
    expect(wantsRewrite(again)).toBe(true);
    expect(
      checkVoiceOutput(['mmh ça sent bon', 'tu cuisines quoi'], DEFAULT_GUARD_SETTINGS, context).map(
        (v) => v.match,
      ),
    ).not.toContain('his_day_again');
  });
});
