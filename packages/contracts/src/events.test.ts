import { describe, expect, it } from 'vitest';

import { ConversationEventSchema, DomainEventSchema, EVENT_PAYLOADS, EVENT_TYPES } from './events';
import {
  CommissionStatementIdSchema,
  ConversationIdSchema,
  CreatorIdSchema,
  FanIdSchema,
  MessageIdSchema,
  newId,
  TeamMemberIdSchema,
} from './ids';

const envelope = () => ({
  id: newId(MessageIdSchema),
  actor: 'system' as const,
  correlationId: 'req-1',
  createdAt: '2026-10-17T19:00:00.000Z',
});

describe('events', () => {
  it('has one payload schema per event type of the closed list', () => {
    expect(Object.keys(EVENT_PAYLOADS).sort()).toEqual([...EVENT_TYPES].sort());
  });

  it('parses a conversation event and narrows its payload on the type', () => {
    const event = ConversationEventSchema.parse({
      ...envelope(),
      creatorId: newId(CreatorIdSchema),
      conversationId: newId(ConversationIdSchema),
      seq: 1,
      type: 'message_received',
      payload: {
        messageId: newId(MessageIdSchema),
        platformMessageId: 'rv-1',
        direction: 'inbound',
        author: 'fan',
        mediaIds: [],
      },
    });
    expect(event.type === 'message_received' && event.payload.author).toBe('fan');
  });

  it('carries a closed cause on a handoff, and the daily budget crossing with no creator', () => {
    const handoff = {
      conversationId: newId(ConversationIdSchema),
      cause: 'minor',
      reason: 'âge déclaré : 16',
    };
    expect(EVENT_PAYLOADS.handoff_requested.safeParse(handoff).success).toBe(true);
    expect(EVENT_PAYLOADS.handoff_requested.safeParse({ ...handoff, cause: 'tired' }).success).toBe(false);
    const budget = DomainEventSchema.parse({
      ...envelope(),
      creatorId: null,
      type: 'budget_threshold_crossed',
      payload: { kind: 'alert', spentMinor: 1600, capMinor: 2000, currency: 'EUR', day: '2026-10-17' },
    });
    expect(budget.type).toBe('budget_threshold_crossed');
    const backup = DomainEventSchema.parse({
      ...envelope(),
      creatorId: null,
      type: 'backup_overdue',
      payload: { lastSucceededAt: null, day: '2026-10-27' },
    });
    expect(backup.type).toBe('backup_overdue');
    expect(
      EVENT_PAYLOADS.backup_overdue.safeParse({
        lastSucceededAt: '2026-10-26T01:00:00.000Z',
        day: '27/10/2026',
      }).success,
    ).toBe(false);
    const rate = DomainEventSchema.parse({
      ...envelope(),
      creatorId: null,
      type: 'exchange_rate_overdue',
      payload: { currency: 'USD', lastRateDay: '2026-10-23', day: '2026-10-29' },
    });
    expect(rate.type).toBe('exchange_rate_overdue');
    // A currency that never got a rate says so, without a day.
    expect(
      EVENT_PAYLOADS.exchange_rate_overdue.safeParse({
        currency: 'USD',
        lastRateDay: null,
        day: '2026-10-29',
      }).success,
    ).toBe(true);
    // Pay never converts the euro, a day is a calendar day, and a missing one is said as `null`.
    for (const payload of [
      { currency: 'EUR', lastRateDay: '2026-10-23', day: '2026-10-29' },
      { currency: 'USD', day: '2026-10-29' },
      { currency: 'USD', lastRateDay: '2026-10-23T16:00:00.000Z', day: '2026-10-29' },
      { currency: 'USD', lastRateDay: '2026-10-23', day: '2026-10-29T08:07:00.000Z' },
    ]) {
      expect(EVENT_PAYLOADS.exchange_rate_overdue.safeParse(payload).success, JSON.stringify(payload)).toBe(
        false,
      );
    }
  });

  it('tells the owner of an invoice or a credit note not issued, with no creator and never a name', () => {
    const payload = {
      memberId: newId(TeamMemberIdSchema),
      statementId: newId(CommissionStatementIdSchema),
      period: '2026-10-01',
      document: 'invoice',
      reason: 'no_mandate',
      amountMinor: 12_000,
    };
    const event = DomainEventSchema.parse({
      ...envelope(),
      creatorId: null,
      type: 'invoice_not_issued',
      payload,
    });
    expect(event.type).toBe('invoice_not_issued');
    expect(
      EVENT_PAYLOADS.invoice_not_issued.safeParse({
        ...payload,
        document: 'credit_note',
        reason: 'no_invoice_to_credit',
      }).success,
    ).toBe(true);
    // A closed reason, a pay period, and an amount that something stays without.
    for (const patch of [
      { reason: 'tired' },
      { period: '2026-10-02' },
      { amountMinor: 0 },
      { name: 'Kofi' },
    ]) {
      expect(
        EVENT_PAYLOADS.invoice_not_issued.strict().safeParse({ ...payload, ...patch }).success,
        JSON.stringify(patch),
      ).toBe(false);
    }
  });

  it('refuses a payload that belongs to another type, and an unknown type', () => {
    const base = { ...envelope(), creatorId: null };
    expect(
      DomainEventSchema.safeParse({
        ...base,
        type: 'kill_switch_toggled',
        payload: { code: 'x', retryable: true },
      }).success,
    ).toBe(false);
    expect(DomainEventSchema.safeParse({ ...base, type: 'fan_fact_recorded', payload: {} }).success).toBe(
      false,
    );
  });

  it('journals a flag of a fan with the whole set after the change', () => {
    const fanId = newId(FanIdSchema);
    const body = {
      fanId,
      flag: 'salesFrozen',
      flags: { salesFrozen: { reason: 'money_trouble', since: '2026-10-23T10:00:00Z' } },
    };
    expect(EVENT_PAYLOADS.fan_flag_set.parse(body)).toEqual(body);
    expect(EVENT_PAYLOADS.fan_flag_cleared.parse({ fanId, flag: 'fragile', flags: {} })).toMatchObject({
      flags: {},
    });
    expect(EVENT_PAYLOADS.fan_flag_set.safeParse({ ...body, flag: 'vip' }).success).toBe(false);
  });

  it('accepts a human actor only with a user id', () => {
    const base = { ...envelope(), creatorId: null, type: 'error', payload: { code: 'x', retryable: false } };
    expect(DomainEventSchema.safeParse({ ...base, actor: `human:${newId(MessageIdSchema)}` }).success).toBe(
      true,
    );
    expect(DomainEventSchema.safeParse({ ...base, actor: 'human:charles' }).success).toBe(false);
  });
});
