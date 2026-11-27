import { ConversationIdSchema, DraftIdSchema, newId } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { toScannedEvent } from '../agency/events';

describe('reading the outbox', () => {
  const base = { id: 'e1', creatorId: null, createdAt: new Date('2026-10-17T22:00:00Z') };
  const conversationId = newId(ConversationIdSchema);

  it('reads a handoff with its cause, and an older one without', () => {
    expect(
      toScannedEvent({ ...base, type: 'handoff_requested', payload: { conversationId, cause: 'minor' } }),
    ).toMatchObject({
      signal: { kind: 'handoff', conversationId, cause: 'minor' },
    });
    expect(
      toScannedEvent({ ...base, type: 'handoff_requested', payload: { reason: 'texte libre' } }),
    ).toMatchObject({
      signal: { kind: 'handoff', conversationId: null, cause: null },
    });
  });

  it('reads only the last send failure, and nothing of what the platform said', () => {
    const failed = (payload: object) => toScannedEvent({ ...base, type: 'send_failed', payload });
    const attempt = {
      draftId: newId(DraftIdSchema),
      idempotencyKey: 'k',
      attempt: 3,
      error: 'platform_said_x',
    };
    expect(failed({ ...attempt, conversationId, isFinal: true })?.signal).toEqual({
      kind: 'send_failed',
      conversationId,
    });
    expect(failed({ ...attempt, conversationId, isFinal: false })).toBeNull();
    expect(failed({ ...attempt, conversationId })).toBeNull();
  });

  it('reads the budget crossing of #54 and skips types it does not know yet', () => {
    expect(
      toScannedEvent({
        ...base,
        type: 'budget_threshold_crossed',
        payload: { kind: 'alert', spentMinor: 1600, capMinor: 2000, currency: 'EUR', day: '2026-10-17' },
      }),
    ).toMatchObject({ signal: { kind: 'budget', threshold: 'alert' } });
    expect(
      toScannedEvent({
        ...base,
        type: 'backup_overdue',
        payload: { lastSucceededAt: '2026-10-26T02:04:00.000Z', day: '2026-10-27' },
      })?.signal,
    ).toEqual({ kind: 'backup_overdue', lastSucceededAt: new Date('2026-10-26T02:04:00.000Z') });
    expect(
      toScannedEvent({
        ...base,
        type: 'backup_overdue',
        payload: { lastSucceededAt: null, day: '2026-10-27' },
      })?.signal,
    ).toEqual({ kind: 'backup_overdue', lastSucceededAt: null });
    // ADR 0033: the currency and the day of its last rate, nothing of the pay; `day` stays out.
    const rate = (payload: object) =>
      toScannedEvent({ ...base, type: 'exchange_rate_overdue', payload })?.signal;
    expect(rate({ currency: 'USD', lastRateDay: '2026-10-23', day: '2026-10-28' })).toEqual({
      kind: 'exchange_rate_overdue',
      currency: 'USD',
      lastRateDay: '2026-10-23',
    });
    expect(rate({ currency: 'USD', lastRateDay: null, day: '2026-10-28' })).toEqual({
      kind: 'exchange_rate_overdue',
      currency: 'USD',
      lastRateDay: null,
    });
    expect(rate({ currency: 'usd<b>', lastRateDay: null, day: '2026-10-28' })).toBeUndefined();
    // EQ-06: the period, the document and the reason; the member, the statement and the amount stay in Impera.
    const notIssued = (payload: object) =>
      toScannedEvent({ ...base, type: 'invoice_not_issued', payload })?.signal;
    const invoice = {
      memberId: '018f3e5c-0000-7000-8000-000000000001',
      statementId: '018f3e5c-0000-7000-8000-000000000002',
      period: '2026-10-16',
      document: 'invoice',
      reason: 'identity_incomplete',
      amountMinor: 12_345,
    };
    expect(notIssued(invoice)).toEqual({
      kind: 'invoice_not_issued',
      period: '2026-10-16',
      document: 'invoice',
      reason: 'identity_incomplete',
    });
    expect(notIssued({ ...invoice, reason: 'something_new' })).toBeUndefined();
    expect(notIssued({ ...invoice, period: '2026-10-17' })).toBeUndefined();
    // ADR 0037: the document's number, the place and the stage; the member and the invoice id stay in Impera.
    const pdf = {
      invoiceId: '018f3e5c-0000-7000-8000-000000000003',
      memberId: '018f3e5c-0000-7000-8000-000000000001',
      number: 'DEMO-2026-0001',
      place: 'ovhcloud',
    };
    expect(toScannedEvent({ ...base, type: 'invoice_pdf_missing', payload: pdf })?.signal).toEqual({
      kind: 'invoice_pdf_missing',
      number: 'DEMO-2026-0001',
      place: 'ovhcloud',
    });
    expect(
      toScannedEvent({ ...base, type: 'invoice_pdf_conflict', payload: { ...pdf, stage: 'download' } })
        ?.signal,
    ).toEqual({
      kind: 'invoice_pdf_conflict',
      number: 'DEMO-2026-0001',
      place: 'ovhcloud',
      stage: 'download',
    });
    expect(
      toScannedEvent({ ...base, type: 'invoice_pdf_conflict', payload: { ...pdf, stage: 'erase' } })?.signal,
    ).toBeUndefined();
    expect(
      toScannedEvent({ ...base, type: 'invoice_pdf_missing', payload: { ...pdf, number: '<b>x</b>' } })
        ?.signal,
    ).toBeUndefined();
    // ADR 0039: the document's number and kind; the contractor stays in Impera (the payload carries no reason).
    const contested = (payload: object) =>
      toScannedEvent({ ...base, type: 'invoice_contested', payload })?.signal;
    const contest = {
      invoiceId: '018f3e5c-0000-7000-8000-000000000003',
      memberId: '018f3e5c-0000-7000-8000-000000000001',
      number: 'DEMO-2026-0003',
      document: 'credit_note',
    };
    expect(contested(contest)).toEqual({
      kind: 'invoice_contested',
      number: 'DEMO-2026-0003',
      document: 'credit_note',
    });
    expect(contested({ ...contest, document: 'receipt' })).toBeUndefined();
    // EQ-06 lot 5c-2: the document's kind and last day, the member's id for the link; a name is never read.
    const expiring = (payload: object) =>
      toScannedEvent({ ...base, type: 'contractor_document_expiring', payload })?.signal;
    const reminder = {
      memberId: '018f3e5c-0000-7000-8000-000000000001',
      documentId: '018f3e5c-0000-7000-8000-000000000004',
      kind: 'urssaf_vigilance',
      lastDay: '2026-12-15',
    };
    expect(expiring({ ...reminder, legalName: 'Kofi Inventé' })).toEqual({
      kind: 'contractor_document_expiring',
      memberId: '018f3e5c-0000-7000-8000-000000000001',
      document: 'urssaf_vigilance',
      lastDay: '2026-12-15',
    });
    expect(expiring({ ...reminder, kind: 'passport' })).toBeUndefined();
    expect(expiring({ ...reminder, lastDay: '15/12/2026' })).toBeUndefined();
    // EQ-06 lot 8: the number, the due date and what blocks the transfer; the total and any name are never read.
    const dueOf = (type: string, payload: object) => toScannedEvent({ ...base, type, payload })?.signal;
    const invoiceDue = {
      invoiceId: '018f3e5c-0000-7000-8000-000000000005',
      memberId: '018f3e5c-0000-7000-8000-000000000001',
      number: 'DEMO-2026-0005',
      dueOn: '2026-12-01',
      inclVatMinor: 123456,
      payoutBlock: { reason: 'tax_residence_unverified', year: '2027' },
    };
    expect(dueOf('invoice_overdue', { ...invoiceDue, legalName: 'Kofi Inventé' })).toEqual({
      kind: 'invoice_due',
      overdue: true,
      memberId: '018f3e5c-0000-7000-8000-000000000001',
      number: 'DEMO-2026-0005',
      dueOn: '2026-12-01',
      payoutBlock: { reason: 'tax_residence_unverified', year: '2027' },
    });
    expect(dueOf('invoice_due_soon', { ...invoiceDue, payoutBlock: null })).toMatchObject({
      overdue: false,
      payoutBlock: null,
    });
    expect(
      dueOf('invoice_due_soon', {
        ...invoiceDue,
        payoutBlock: { reason: 'documents_not_issued', year: '2027' },
      }),
    ).toBeUndefined();
    // CRM-04 b3: the platform, the fortnight, how many days and accounts; never a net nor a difference.
    const day = (on: string, account: string) => ({
      day: on,
      platformAccountId: account,
      currency: 'EUR',
      registerNetMinor: 10_000,
      platformNetMinor: 9_000,
      differenceMinor: 1_000,
    });
    const accountA = '018f3e5c-0000-7000-8000-0000000000a1';
    const accountB = '018f3e5c-0000-7000-8000-0000000000a2';
    const mismatch = toScannedEvent({
      ...base,
      type: 'sales_feed_mismatch',
      payload: {
        platform: 'reveal',
        from: '2026-11-01',
        to: '2026-11-15',
        days: [day('2026-11-03', accountA), day('2026-11-03', accountB), day('2026-11-04', accountA)],
      },
    });
    expect(mismatch?.signal).toEqual({
      kind: 'sales_feed_mismatch',
      platform: 'reveal',
      from: '2026-11-01',
      days: 2,
      accounts: 2,
    });
    // CRM-07 a2: a linked model gone or banned is told, by her id only; the other signals stay in Réglages.
    const salesSignal = (signal: object) =>
      toScannedEvent({ ...base, type: 'sales_feed_signal', payload: { platform: 'reveal', signal } })?.signal;
    expect(salesSignal({ kind: 'model_gone', platformModelId: 'model_test_01' })).toEqual({
      kind: 'sales_feed_model',
      platform: 'reveal',
      change: 'gone',
      platformModelId: 'model_test_01',
    });
    expect(salesSignal({ kind: 'model_banned', platformModelId: 'model_test_01' })).toMatchObject({
      change: 'banned',
    });
    expect(salesSignal({ kind: 'model_unlinked', platformModelId: 'model_test_01' })).toBeUndefined();
    const since = '2026-11-03T10:00:00.000Z';
    expect(
      toScannedEvent({
        ...base,
        type: 'connection_state_changed',
        payload: { service: 'mistral', state: 'down', reason: 'low_credit', since },
      })?.signal,
    ).toEqual({ kind: 'connection_down', service: 'mistral', reason: 'low_credit' });
    expect(
      toScannedEvent({
        ...base,
        type: 'connection_state_changed',
        payload: { service: 'xai', state: 'back', since },
      })?.signal,
    ).toEqual({ kind: 'connection_back', service: 'xai' });
    const shareCreator = '018f3e5c-0000-7000-8000-0000000000c1';
    expect(
      toScannedEvent({
        ...base,
        type: 'agency_share_mismatch',
        payload: {
          creatorId: shareCreator,
          platform: 'reveal',
          platformAccountId: accountA,
          from: '2026-11-01',
          to: '2026-11-15',
          currency: 'EUR',
          sales: 3,
          refunds: 0,
          creatorMinor: 10_000,
          expectedCreatorMinor: 9_000,
          differenceMinor: 1_000,
        },
      })?.signal,
    ).toEqual({
      kind: 'agency_share_mismatch',
      creatorId: shareCreator,
      platform: 'reveal',
      platformAccountId: accountA,
      from: '2026-11-01',
    });
    expect(
      toScannedEvent({
        ...base,
        type: 'agency_share_changed',
        payload: {
          creatorId: shareCreator,
          platform: 'reveal',
          platformAccountId: accountA,
          from: '2026-11-01',
          to: '2026-11-15',
          currency: 'EUR',
          previousAgencyBps: 3_000,
          agencyBps: 3_500,
        },
      })?.signal,
    ).toEqual({
      kind: 'agency_share_changed',
      creatorId: shareCreator,
      platform: 'reveal',
      platformAccountId: accountA,
      from: '2026-11-01',
    });
    // A service or a reason the contract does not know is not read.
    expect(
      toScannedEvent({
        ...base,
        type: 'connection_state_changed',
        payload: { service: 'meta', state: 'down', reason: 'refused', since },
      }),
    ).toBeNull();
    // The voice version stays in Impera: the signal carries only the reasons and the count.
    const closed = toScannedEvent({
      ...base,
      type: 'automatic_closed',
      payload: {
        voicePrompt: 'sha256:abc',
        voiceModel: 'demo-model',
        missing: [{ kind: 'live_rate', value: 74.5, target: 80 }],
        conversations: 2,
      },
    });
    expect(closed?.signal).toEqual({
      kind: 'automatic_closed',
      missing: [{ kind: 'live_rate', value: 74.5, target: 80 }],
      conversations: 2,
    });
    expect(toScannedEvent({ ...base, type: 'automatic_closed', payload: { missing: [] } })).toBeNull();
    expect(toScannedEvent({ ...base, type: 'sale_detected', payload: {} })).toBeNull();
    expect(toScannedEvent({ ...base, type: 'kill_switch_toggled', payload: { nonsense: 1 } })).toBeNull();
  });
});
