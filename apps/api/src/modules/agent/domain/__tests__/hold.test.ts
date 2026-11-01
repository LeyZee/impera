import { describe, expect, it } from 'vitest';

import { holdDecision, protectionFor, protectionWhileAnswering, waitRetryAt } from '../hold';

describe('holdDecision', () => {
  it('hands a possible minor, distress or self-harm to a chatter, whatever the brain suggests', () => {
    expect(holdDecision({ risks: ['minor_suspected'], action: 'offer' })).toEqual({
      kind: 'handoff',
      detail: ['minor_suspected'],
    });
    expect(holdDecision({ risks: ['money_trouble', 'distress'], action: 'reply' })).toEqual({
      kind: 'handoff',
      detail: ['distress'],
    });
  });

  it('hands a dangerous request or a story of real abuse to a chatter, never to the voice', () => {
    expect(holdDecision({ risks: ['dangerous_request'], action: 'reply' })).toEqual({
      kind: 'handoff',
      detail: ['dangerous_request'],
    });
    expect(holdDecision({ risks: ['real_abuse'], action: 'offer' })).toEqual({
      kind: 'handoff',
      detail: ['real_abuse'],
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
    expect(holdDecision({ risks: ['distress'], action: 'wait' }, true).kind).toBe('handoff');
    expect(waitRetryAt(new Date('2026-10-27T20:00:00Z'))).toEqual(new Date('2026-10-27T20:20:00Z'));
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
      freezeSales: false,
      because: ['minor_suspected', 'possible_minor'],
    });
  });

  it('stops writing to him on distress or a threat', () => {
    for (const sign of ['distress', 'self_harm', 'real_abuse', 'harassment', 'dangerous_request', 'weapon']) {
      expect(protectionFor([sign]).stopContact).toBe(true);
    }
  });

  it('freezes sales when he says he cannot pay', () => {
    expect(protectionFor(['money_trouble'])).toEqual({
      unconfirmAge: false,
      stopContact: false,
      freezeSales: true,
      because: ['money_trouble'],
    });
  });

  it('changes nothing for the other risks', () => {
    expect(protectionFor(['meet_request', 'drugs'])).toEqual({
      unconfirmAge: false,
      stopContact: false,
      freezeSales: false,
      because: [],
    });
  });
});

describe('protectionWhileAnswering', () => {
  it('keeps only his money trouble: the other limits come with a handoff', () => {
    expect(protectionWhileAnswering(['harassment', 'money_trouble'])).toEqual({
      unconfirmAge: false,
      stopContact: false,
      freezeSales: true,
      because: ['money_trouble'],
    });
    expect(protectionWhileAnswering(['harassment']).because).toEqual([]);
  });
});
