import { describe, expect, it } from 'vitest';

import { classifyEvent } from '../classify';

const CONVERSATION = '01900000-0000-7000-8000-000000000020';
const ALERT = '01900000-0000-7000-8000-000000000030';

describe('which alert of her tab an event is (ADR 0150 § B)', () => {
  it('locks every human relay for safety into one alert', () => {
    for (const cause of ['minor', 'non_consent', 'distress', 'meeting', 'manipulation']) {
      expect(classifyEvent('handoff_requested', { conversationId: CONVERSATION, cause })).toEqual({
        code: 'safety_handoff',
        conversationId: CONVERSATION,
      });
    }
  });

  it('counts a custom order and a service asked as an offer outside the scripts (§ 12)', () => {
    expect(
      classifyEvent('handoff_requested', { conversationId: CONVERSATION, cause: 'custom_order' })?.code,
    ).toBe('offer_proposed');
    expect(
      classifyEvent('alert_triggered', {
        conversationId: CONVERSATION,
        trigger: { alert: { kind: 'system', code: 'service_request' }, matchedBy: 'rule' },
        notify: true,
      })?.code,
    ).toBe('offer_proposed');
  });

  it('reads her own alerts, her words, a doubt and a changed price', () => {
    const triggered = (alert: object, matchedBy = 'model') =>
      classifyEvent('alert_triggered', {
        conversationId: CONVERSATION,
        trigger: { alert, matchedBy },
        notify: false,
      })?.code;
    expect(triggered({ kind: 'custom', id: ALERT })).toBe('her_alerts');
    expect(triggered({ kind: 'system', code: 'identity_doubt' })).toBe('identity_doubt');
    expect(triggered({ kind: 'system', code: 'script_price' }, 'rule')).toBe('script_price');
    expect(
      classifyEvent('handoff_requested', { conversationId: CONVERSATION, cause: 'custom_alert' })?.code,
    ).toBe('her_alerts');
  });

  it('tells a sale, the AI budget, and a session that just expired', () => {
    expect(classifyEvent('sale_detected', {})).toEqual({ code: 'sale', conversationId: null });
    expect(
      classifyEvent('sale_detected', {
        saleId: '01900000-0000-7000-8000-000000000050',
        platform: 'reveal',
        platformAccountId: '01900000-0000-7000-8000-000000000040',
        saleType: 'ppv',
        occurredAt: '2026-11-27T01:00:00.000Z',
        currency: 'EUR',
        grossInclVatMinor: 2_500,
        netMinor: 2_000,
        agencyMinor: 1_000,
        creatorMinor: 1_000,
        seller: { kind: 'agent' },
      })?.sale,
    ).toEqual({ grossMinor: 2_500, currency: 'EUR', by: 'agent' });
    expect(classifyEvent('budget_threshold_crossed', {})?.code).toBe('ai_budget');
    expect(classifyEvent('ai_credits_low', {})?.code).toBe('ai_budget');
    const account = '01900000-0000-7000-8000-000000000040';
    expect(
      classifyEvent('session_state_changed', { platformAccountId: account, from: 'valid', to: 'expired' })
        ?.code,
    ).toBe('session_expired');
    expect(
      classifyEvent('session_state_changed', { platformAccountId: account, from: 'expired', to: 'valid' }),
    ).toBeNull();
  });

  it('tells no script left, and an offer outside the scripts with nothing free in it (§§ 9, 12)', () => {
    expect(classifyEvent('scripts_exhausted', { conversationId: CONVERSATION })).toEqual({
      code: 'scripts_exhausted',
      conversationId: CONVERSATION,
    });
    expect(
      classifyEvent('offer_proposed', {
        conversationId: CONVERSATION,
        kind: 'practice_offer',
        usage: 'practice',
      }),
    ).toEqual({ code: 'offer_proposed', conversationId: CONVERSATION });
    // A strict payload: no free field, no usage outside the closed list.
    expect(
      classifyEvent('offer_proposed', { conversationId: CONVERSATION, kind: 'practice_offer', text: 'x' }),
    ).toBeNull();
    expect(
      classifyEvent('offer_proposed', { conversationId: CONVERSATION, kind: 'practice_offer', usage: 'x' }),
    ).toBeNull();
    expect(classifyEvent('scripts_exhausted', { conversationId: CONVERSATION, scriptRef: 'x' })).toBeNull();
  });

  it('tells a créneau begun with nobody, with no conversation (ADR 0094 § 1)', () => {
    const payload = {
      creatorId: '01900000-0000-7000-8000-0000000000c1',
      platform: 'reveal',
      platformAccountId: '01900000-0000-7000-8000-0000000000a1',
      slotStartsAt: '2026-11-20T11:00:00.000Z',
      slotEndsAt: '2026-11-20T17:00:00.000Z',
      timeZone: 'Europe/Paris',
    };
    expect(classifyEvent('account_uncovered', payload)).toEqual({
      code: 'uncovered_account',
      conversationId: null,
    });
    expect(classifyEvent('account_uncovered', { ...payload, fan: 'x' })).toBeNull();
  });

  it('tells a shift its chatter has not taken, with no conversation (ADR 0094 § 1, lot b)', () => {
    const payload = {
      creatorId: '01900000-0000-7000-8000-0000000000c1',
      platform: 'reveal',
      platformAccountId: '01900000-0000-7000-8000-0000000000a1',
      shiftId: '01900000-0000-7000-8000-0000000000b1',
      memberId: '01900000-0000-7000-8000-0000000000d1',
      memberName: 'Kofi',
      startsAt: '2026-11-20T13:00:00.000Z',
      endsAt: '2026-11-20T19:00:00.000Z',
      timeZone: 'Europe/Paris',
    };
    expect(classifyEvent('shift_not_taken', payload)).toEqual({
      code: 'shift_not_taken',
      conversationId: null,
    });
    expect(classifyEvent('shift_not_taken', { ...payload, memberName: '' })).toBeNull();
  });

  it('skips what is none of the tab’s, and a payload that does not read', () => {
    expect(classifyEvent('handoff_requested', { conversationId: CONVERSATION, cause: 'guard' })).toBeNull();
    expect(classifyEvent('handoff_requested', { cause: 'minor' })).toBeNull();
    expect(classifyEvent('message_received', {})).toBeNull();
  });
});
