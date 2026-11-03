import { describe, expect, it } from 'vitest';

import { ConversationEventSchema, DomainEventSchema, EVENT_PAYLOADS, EVENT_TYPES } from './events';
import {
  CommissionStatementIdSchema,
  ContractorDocumentIdSchema,
  ConversationIdSchema,
  CreatorIdSchema,
  FanIdSchema,
  InvoiceIdSchema,
  MessageIdSchema,
  newId,
  PlatformAccountIdSchema,
  SalesLineIdSchema,
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

  it('tells the owner of a contest once, without its reason nor a name (ADR 0039 § 2)', () => {
    const payload = {
      invoiceId: newId(InvoiceIdSchema),
      memberId: newId(TeamMemberIdSchema),
      number: 'KOFI-2026-0001',
      document: 'credit_note',
    };
    const event = DomainEventSchema.parse({
      ...envelope(),
      creatorId: null,
      type: 'invoice_contested',
      payload,
    });
    expect(event.type).toBe('invoice_contested');
    for (const patch of [
      { reason: 'Une vente manque' },
      { name: 'Kofi' },
      { document: 'quote' },
      { number: 'K-1' },
    ]) {
      expect(
        EVENT_PAYLOADS.invoice_contested.strict().safeParse({ ...payload, ...patch }).success,
        JSON.stringify(patch),
      ).toBe(false);
    }
  });

  it('rings a sale with its amounts and its seller, never its fan (CRM-04)', () => {
    const payload = {
      saleId: newId(SalesLineIdSchema),
      platform: 'reveal',
      platformAccountId: newId(PlatformAccountIdSchema),
      saleType: 'ppv',
      occurredAt: '2026-11-03T09:58:00.000Z',
      currency: 'EUR',
      grossInclVatMinor: 1200,
      netMinor: 800,
      agencyMinor: 300,
      creatorMinor: 500,
      seller: { kind: 'member', memberId: newId(TeamMemberIdSchema) },
    };
    const event = DomainEventSchema.parse({
      ...envelope(),
      creatorId: newId(CreatorIdSchema),
      type: 'sale_detected',
      payload,
    });
    expect(event.type).toBe('sale_detected');
    for (const seller of [{ kind: 'agent' }, { kind: 'unlinked' }, { kind: 'none' }]) {
      expect(EVENT_PAYLOADS.sale_detected.safeParse({ ...payload, seller }).success).toBe(true);
    }
    // A member without his id, a seller kind of nowhere, a negative amount, the fan in any shape.
    for (const patch of [
      { seller: { kind: 'member' } },
      { seller: { kind: 'creator' } },
      { netMinor: -800 },
      { platformFanId: 'fan_test_01' },
      { fan: 'fan_test_01' },
    ]) {
      expect(
        EVENT_PAYLOADS.sale_detected.strict().safeParse({ ...payload, ...patch }).success,
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

  it('tells a document coming to its end by ids, a kind and a day, never a name (EQ-06 lot 5c-2)', () => {
    const body = {
      memberId: newId(TeamMemberIdSchema),
      documentId: newId(ContractorDocumentIdSchema),
      kind: 'tax_residence',
      lastDay: '2026-12-31',
    };
    expect(EVENT_PAYLOADS.contractor_document_expiring.parse({ ...body, legalName: 'Kofi Inventé' })).toEqual(
      body,
    );
    expect(EVENT_PAYLOADS.contractor_document_expiring.safeParse({ ...body, kind: 'passport' }).success).toBe(
      false,
    );
    expect(
      EVENT_PAYLOADS.contractor_document_expiring.safeParse({ ...body, lastDay: '31/12/2026' }).success,
    ).toBe(false);
  });

  it('tells an invoice coming to its due date by ids, its number, its day and its total, never a name (EQ-06 lot 8)', () => {
    const body = {
      invoiceId: newId(InvoiceIdSchema),
      memberId: newId(TeamMemberIdSchema),
      number: 'KOFI-2026-0007',
      dueOn: '2026-12-31',
      inclVatMinor: 12_000,
      payoutBlock: null,
    };
    for (const type of ['invoice_due_soon', 'invoice_overdue'] as const) {
      expect(EVENT_PAYLOADS[type].parse({ ...body, legalName: 'Kofi Inventé' })).toEqual(body);
      // What stops its transfer (ADR 0041): a certificate of a year, or documents not all issued, without a year.
      const blocked = { ...body, payoutBlock: { reason: 'tax_residence_missing', year: '2027' } };
      expect(EVENT_PAYLOADS[type].parse(blocked)).toEqual(blocked);
      for (const patch of [
        { dueOn: '31/12/2026' },
        { inclVatMinor: -1 },
        { inclVatMinor: 1.5 },
        { number: 'K-1' },
        { payoutBlock: { reason: 'tax_residence_missing', year: null } },
        { payoutBlock: { reason: 'documents_not_issued', year: '2027' } },
        { payoutBlock: undefined },
      ])
        expect(
          [type, EVENT_PAYLOADS[type].safeParse({ ...body, ...patch }).success],
          JSON.stringify(patch),
        ).toEqual([type, false]);
      expect(
        DomainEventSchema.safeParse({ ...envelope(), creatorId: null, type, payload: body }).success,
      ).toBe(true);
    }
  });

  it('accepts a human actor only with a user id', () => {
    const base = { ...envelope(), creatorId: null, type: 'error', payload: { code: 'x', retryable: false } };
    expect(DomainEventSchema.safeParse({ ...base, actor: `human:${newId(MessageIdSchema)}` }).success).toBe(
      true,
    );
    expect(DomainEventSchema.safeParse({ ...base, actor: 'human:charles' }).success).toBe(false);
  });
});
