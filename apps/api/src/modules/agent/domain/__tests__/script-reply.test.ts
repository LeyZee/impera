import { describe, expect, it } from 'vitest';

import { refusesStep, scriptReplyOf } from '../script-reply';

describe('his reply to the step waiting, completed by code (passe 3 du 27/11, conversation 42)', () => {
  it('reads a plain no to taking it, in four languages', () => {
    expect(refusesStep('Bon non, je vais pas la prendre')).toBe(true);
    expect(refusesStep('Je la prends pas, désolé')).toBe(true);
    expect(refusesStep('Nah I’ll pass tonight')).toBe(true);
    expect(refusesStep('No la compro, gracias')).toBe(true);
    expect(refusesStep('Non la prendo stasera')).toBe(true);
  });

  it('reads no refusal in a hesitation or another subject', () => {
    expect(refusesStep('Hmm je sais pas trop')).toBe(false);
    expect(refusesStep('Je vais prendre une douche')).toBe(false);
  });

  it('keeps the brain’s reading, and fills only an empty one', () => {
    expect(scriptReplyOf({ intent: 'other', scriptReply: 'answers_step' }, 'je vais pas la prendre')).toBe(
      'answers_step',
    );
    expect(scriptReplyOf({ intent: 'other' }, 'Non, je vais pas la prendre')).toBe('refused');
    expect(scriptReplyOf({ intent: 'price_objection' }, 'C’est cher quand même')).toBe('answers_step');
    expect(scriptReplyOf({ intent: 'small_talk' }, 'Et ta journée')).toBeNull();
    expect(scriptReplyOf(undefined, 'non merci')).toBeNull();
  });
});
