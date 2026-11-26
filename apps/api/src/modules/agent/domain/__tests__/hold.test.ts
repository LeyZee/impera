import { describe, expect, it } from 'vitest';

import { holdDecision, protectionFor, protectionWhileAnswering, waitRetryAt } from '../hold';

describe('holdDecision', () => {
  it('hands a possible minor, a dangerous request or a story of real abuse to a chatter, whatever the brain suggests', () => {
    expect(holdDecision({ risks: ['minor_suspected'], action: 'offer' })).toEqual({
      kind: 'handoff',
      detail: ['minor_suspected'],
    });
    expect(holdDecision({ risks: ['dangerous_request'], action: 'reply' })).toEqual({
      kind: 'handoff',
      detail: ['dangerous_request'],
    });
    expect(holdDecision({ risks: ['real_abuse'], action: 'offer' })).toEqual({
      kind: 'handoff',
      detail: ['real_abuse'],
    });
  });

  it('answers distress and self-harm with care, whatever the brain suggests (ADR 0088)', () => {
    expect(holdDecision({ risks: ['money_trouble', 'distress'], action: 'reply' })).toEqual({
      kind: 'care',
      detail: ['distress'],
    });
    expect(holdDecision({ risks: ['self_harm'], action: 'handoff' })).toEqual({
      kind: 'care',
      detail: ['self_harm'],
    });
  });

  it('never answers a possible minor with care: the handoff outranks it', () => {
    expect(holdDecision({ risks: ['self_harm', 'minor_suspected'], action: 'reply' })).toEqual({
      kind: 'handoff',
      detail: ['minor_suspected'],
    });
  });

  it('follows the brain when it asks for a human, and stays quiet when there is nothing to answer', () => {
    expect(holdDecision({ risks: ['meet_request'], action: 'handoff' })).toEqual({
      kind: 'handoff',
      detail: ['meet_request'],
    });
    expect(holdDecision({ risks: [], action: 'wait' })).toEqual({ kind: 'no_reply', detail: ['wait'] });
  });

  it('never waits twice for the same message, and is asked again 20 minutes later (P3-11)', () => {
    expect(holdDecision({ risks: [], action: 'wait' }, true)).toEqual({ kind: 'answer' });
    expect(holdDecision({ risks: ['distress'], action: 'wait' }, true).kind).toBe('care');
    expect(waitRetryAt(new Date('2026-10-27T20:00:00Z'))).toEqual(new Date('2026-10-27T20:20:00Z'));
  });

  it('answers an insult herself, even when the brain asks for a human (ADR 0158 § 19, eval passe-08)', () => {
    // « Grosse conne va » read as an insult with a handoff suggested: she answers, nobody is called.
    expect(holdDecision({ risks: ['insult'], action: 'handoff' })).toEqual({ kind: 'answer' });
    expect(protectionWhileAnswering(['insult'])).toEqual(protectionFor([]));
    expect(protectionFor(['insult']).stopContact).toBe(false);
    // A threat with it still calls a human.
    expect(holdDecision({ risks: ['insult', 'harassment'], action: 'handoff' })).toEqual({
      kind: 'handoff',
      detail: ['insult', 'harassment'],
    });
    // An insult never hides a graver risk: a possible minor is handed over whatever else.
    expect(holdDecision({ risks: ['insult', 'minor_suspected'], action: 'reply' })).toEqual({
      kind: 'handoff',
      detail: ['minor_suspected'],
    });
  });

  it('keeps nothing on a fan « à sec » until his pay: no freeze, no human (eval passe-11a)', () => {
    expect(holdDecision({ risks: ['no_budget'], action: 'reply' })).toEqual({ kind: 'answer' });
    expect(protectionWhileAnswering(['no_budget']).freezeSales).toBe(false);
    expect(protectionWhileAnswering(['money_trouble']).freezeSales).toBe(true);
  });

  it('answers otherwise, a meeting request included (the voice declines it)', () => {
    expect(holdDecision({ risks: ['meet_request'], action: 'reply' })).toEqual({ kind: 'answer' });
  });
});

describe('protectionFor', () => {
  it('takes back his age on a possible minor, from the brain or from a media', () => {
    expect(protectionFor(['minor_suspected', 'possible_minor'])).toEqual({
      unconfirmAge: true,
      stopContact: false,
      care: false,
      freezeSales: false,
      because: ['minor_suspected', 'possible_minor'],
    });
  });

  it('stops writing to him on a threat', () => {
    for (const sign of ['real_abuse', 'harassment', 'dangerous_request', 'weapon']) {
      expect(protectionFor([sign]).stopContact).toBe(true);
      expect(protectionFor([sign]).care).toBe(false);
    }
  });

  it('opens the care mode on distress or self-harm, never « Ne plus lui écrire » (ADR 0088)', () => {
    for (const sign of ['distress', 'self_harm']) {
      expect(protectionFor([sign])).toEqual({
        unconfirmAge: false,
        stopContact: false,
        care: true,
        freezeSales: false,
        because: [sign],
      });
    }
  });

  it('freezes sales when he says he cannot pay', () => {
    expect(protectionFor(['money_trouble'])).toEqual({
      unconfirmAge: false,
      stopContact: false,
      care: false,
      freezeSales: true,
      because: ['money_trouble'],
    });
  });

  it('changes nothing for the other risks', () => {
    expect(protectionFor(['meet_request', 'drugs'])).toEqual({
      unconfirmAge: false,
      stopContact: false,
      care: false,
      freezeSales: false,
      because: [],
    });
  });
});

describe('protectionWhileAnswering', () => {
  it('keeps his money trouble and the care mode: the other limits come with a handoff', () => {
    expect(protectionWhileAnswering(['harassment', 'money_trouble'])).toEqual({
      unconfirmAge: false,
      stopContact: false,
      care: false,
      freezeSales: true,
      because: ['money_trouble'],
    });
    expect(protectionWhileAnswering(['harassment']).because).toEqual([]);
    expect(protectionWhileAnswering(['harassment', 'distress'])).toMatchObject({
      stopContact: false,
      care: true,
      because: ['distress'],
    });
  });
});
