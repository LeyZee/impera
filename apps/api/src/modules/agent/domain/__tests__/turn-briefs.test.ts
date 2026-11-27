import { describe, expect, it } from 'vitest';

import { CARE_BRIEF, CARE_TONE_HINTS } from '../care';
import { DEFAULT_GUARD_SETTINGS } from '../guards';
import {
  aftercareBrief,
  answeredBrief,
  cameBackIfWaited,
  careBrief,
  followUpBrief,
  NEUTRAL_BRIEF,
  offeredBrief,
  quietBriefOf,
  trappedBrief,
  withDiscountAsked,
  withHints,
  withinCursor,
  withoutEmojiIfDue,
  type TurnReading,
} from '../turn-briefs';
import {
  CAME_BACK_BRIEF,
  COMPLIMENT_BRIEF,
  FLIRT_HINT,
  NO_EMOJI_HINT,
  NO_OPENING_HINT,
  STEER_BACK_BRIEF,
  SUGGESTIVE_HINT,
} from '../turn-texts';

// An invented reading of an invented fan's message.
const READ: TurnReading = {
  intent: 'small_talk',
  sentiment: 'positive',
  factsProposed: [],
  risks: [],
  action: 'reply',
  replyBrief: 'Lui demander sa journée.',
  toneHints: ['légère'],
};

describe('the briefs code writes', () => {
  it('follows up on his silence in whole hours, at least one, in the spirit she wrote', () => {
    expect(followUpBrief({ silentHours: 0.2, spirit: null }).replyBrief).toContain('depuis 1 h.');
    const brief = followUpBrief({ silentHours: 26.6, spirit: 'légère' });
    expect(brief.replyBrief).toContain('depuis 27 h.');
    expect(brief.replyBrief).toContain('Dans l’esprit de ses relances : légère');
    expect(brief.toneHints).toEqual([NO_OPENING_HINT, 'court, une seule bulle']);
  });

  it('stays in the moment after a step bought mid-script, and thanks him tenderly otherwise', () => {
    expect(aftercareBrief({ saleType: 'ppv', scriptGoesOn: true }).sentiment).toBe('aroused');
    const tip = aftercareBrief({ saleType: 'tip', scriptGoesOn: false });
    expect(tip.sentiment).toBe('positive');
    expect(tip.replyBrief).toContain('pourboire');
  });

  it('writes the follow-up first, her word after a sale next, a neutral answer otherwise', () => {
    const followUp = { silentHours: 3, spirit: null };
    const aftercare = { saleType: 'tip' as const, scriptGoesOn: false };
    expect(quietBriefOf(followUp, aftercare)).toEqual(followUpBrief(followUp));
    expect(quietBriefOf(undefined, aftercare)).toEqual(aftercareBrief(aftercare));
    expect(quietBriefOf(undefined, undefined)).toBe(NEUTRAL_BRIEF);
  });
});

describe('the brief as code reshapes it', () => {
  it('reads « fais-moi un prix » as a price objection, whatever the brain said', () => {
    expect(withDiscountAsked(READ, 'Fais-moi un prix')).toMatchObject({
      intent: 'price_objection',
      objection: 'asks_discount',
    });
    expect(withDiscountAsked(READ, 'Ça va ?')).toBe(READ);
  });

  it('answers a trap with its own brief and hints, and leaves the rest', () => {
    expect(trappedBrief(READ, { isTrap: false, signals: [] })).toBe(READ);
    const trapped = trappedBrief(
      { ...READ, action: 'offer' },
      { isTrap: true, signals: [], replyBrief: 'Elle s’en amuse.', toneHints: ['taquine'] },
    );
    expect(trapped).toMatchObject({
      action: 'reply',
      replyBrief: 'Elle s’en amuse.',
      toneHints: ['taquine'],
    });
  });

  it('slows him down without asking his age twice', () => {
    const steer = { kind: 'steer_back', reason: 'age_unconfirmed' } as const;
    expect(withinCursor(READ, steer, false).replyBrief).toBe(STEER_BACK_BRIEF.age_unconfirmed);
    expect(withinCursor(READ, steer, true).replyBrief).toBe(STEER_BACK_BRIEF.too_early);
  });

  it('welcomes a flirt it may not take further, in code’s words', () => {
    const flirt: TurnReading = { ...READ, intent: 'flirt' };
    expect(withinCursor(flirt, { kind: 'no_opening' }, false)).toMatchObject({
      replyBrief: COMPLIMENT_BRIEF,
      toneHints: ['assurée', 'joueuse', 'chaleureuse', FLIRT_HINT, NO_OPENING_HINT],
    });
    expect(withinCursor(READ, { kind: 'no_opening' }, false).toneHints).toEqual(['légère', NO_OPENING_HINT]);
    expect(withinCursor(READ, { kind: 'suggestive_only' }, false).toneHints).toEqual([
      'légère',
      SUGGESTIVE_HINT,
    ]);
    expect(withinCursor(READ, { kind: 'free' }, false)).toBe(READ);
  });

  it('never waits twice: the second time she asks whether he is back', () => {
    const waiting: TurnReading = { ...READ, action: 'wait' };
    expect(cameBackIfWaited(waiting, true)).toMatchObject({ action: 'reply', replyBrief: CAME_BACK_BRIEF });
    expect(cameBackIfWaited(waiting, false)).toBe(waiting);
    expect(cameBackIfWaited(READ, true)).toBe(READ);
  });

  it('offers only a paid step, and answers instead of an offer refused', () => {
    const offer: TurnReading = { ...READ, action: 'offer' };
    expect(offeredBrief(READ, 'paid', false).action).toBe('offer');
    expect(offeredBrief(offer, 'free', false).action).toBe('reply');
    expect(offeredBrief(offer, undefined, false)).toBe(offer);
    expect(offeredBrief(offer, undefined, true).replyBrief).toContain('sans rien proposer de payant');
    expect(offeredBrief({ ...offer, intent: 'asks_for_media' }, undefined, true).replyBrief).toContain(
      'Il demande de son contenu',
    );
    // His sales frozen: no « yes, later » either (eval pass of 27/11).
    expect(offeredBrief({ ...offer, intent: 'asks_for_media' }, undefined, true, true).replyBrief).toContain(
      'sans rien proposer de payant',
    );
  });

  it('answers from the care brief first, then from a custom order’s', () => {
    const care = careBrief(READ);
    expect(care).toMatchObject({ action: 'reply', replyBrief: CARE_BRIEF, toneHints: [...CARE_TONE_HINTS] });
    expect(answeredBrief(true, READ, undefined, READ)).toEqual(care);
    const order = { kind: 'reply', brief: 'Elle ne promet rien.', opens: false } as const;
    expect(answeredBrief(false, READ, order, READ)).toMatchObject({
      replyBrief: 'Elle ne promet rien.',
      toneHints: ['légère', NO_OPENING_HINT],
    });
    expect(answeredBrief(false, READ, { kind: 'handoff' }, READ)).toBe(READ);
  });

  it('adds hints after the brief’s own, and no emoji once her last answers all carried one', () => {
    expect(withHints(READ, ['a', 'b']).toneHints).toEqual(['légère', 'a', 'b']);
    const emojis = [
      { from: 'creator' as const, text: 'Coucou 😘' },
      { from: 'fan' as const, text: 'Salut' },
      { from: 'creator' as const, text: 'Oui 😊' },
      { from: 'fan' as const, text: 'Ok' },
      { from: 'creator' as const, text: 'Top 😄' },
      { from: 'fan' as const, text: 'Et toi ?' },
    ];
    expect(withoutEmojiIfDue(READ, emojis, DEFAULT_GUARD_SETTINGS).toneHints).toEqual([
      'légère',
      NO_EMOJI_HINT,
    ]);
    expect(withoutEmojiIfDue(READ, emojis.slice(2), DEFAULT_GUARD_SETTINGS)).toBe(READ);
  });
});
