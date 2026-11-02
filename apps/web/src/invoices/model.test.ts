import { INVOICE_ERROR_CODES, PayPeriodSchema } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  acceptanceChip,
  contestsFirst,
  deadlineText,
  dueChip,
  dueText,
  eventLine,
  invoiceRefusalText,
  kindLabel,
  periodText,
  readsAgain,
  settlementText,
  statementPeriodOf,
  yearRange,
} from './model';

import { invoiceOf, LOU, NOV1, OCT1 as OCT1_DAY, OCT2 as OCT2_DAY, payId, THEO } from '@/test/pay';

const OCT1 = PayPeriodSchema.parse(OCT1_DAY);
const OCT2 = PayPeriodSchema.parse(OCT2_DAY);

const NBSP = /[\u00a0\u202f]/gu;
const flat = (text: string | null): string | null => (text === null ? null : text.replace(NBSP, ' '));

describe('the year a list reads', () => {
  it('covers 366 days up to today, then the year before without a day left out nor read twice', () => {
    expect(yearRange('2026-11-05', 0)).toEqual({ from: '2025-11-05', to: '2026-11-05' });
    expect(yearRange('2026-11-05', 1)).toEqual({ from: '2024-11-04', to: '2025-11-04' });
  });
});

describe('a document in words', () => {
  it('names each kind as the glossary does', () => {
    expect(kindLabel({ kind: 'invoice', corrective: false })).toBe('Facture');
    expect(kindLabel({ kind: 'invoice', corrective: true })).toBe('Facture rectificative');
    expect(kindLabel({ kind: 'credit_note', corrective: false })).toBe('Avoir');
  });

  it('says the acceptance to the contractor as his to do, to the agency as what it waits for', () => {
    const pending = invoiceOf(1, THEO, OCT2, {
      acceptance: { state: 'pending', deadline: '2026-11-09T22:59:00.000Z', reason: null },
    });
    expect(acceptanceChip(pending, true)).toEqual({ label: 'À accepter', tone: 'wait' });
    expect(acceptanceChip(pending, false)).toEqual({ label: 'En attente de réponse', tone: 'wait' });
  });

  it('agrees with the document: an invoice « acceptée », a credit note « accepté »', () => {
    const credit = invoiceOf(2, THEO, OCT2, { kind: 'credit_note', creditedInvoiceId: payId(901) });
    expect(acceptanceChip(invoiceOf(1, THEO, OCT2), false)).toEqual({ label: 'Acceptée', tone: 'ok' });
    expect(acceptanceChip(credit, false)).toEqual({ label: 'Accepté', tone: 'ok' });
    expect(acceptanceChip({ kind: 'invoice', acceptance: { state: 'tacitly_accepted' } }, false).label).toBe(
      'Acceptée tacitement',
    );
    expect(acceptanceChip({ kind: 'invoice', acceptance: { state: 'contested' } }, false)).toEqual({
      label: 'Contestée',
      tone: 'warn',
    });
    expect(acceptanceChip({ kind: 'credit_note', acceptance: { state: 'contest_upheld' } }, true).label).toBe(
      'Contestation fondée',
    );
  });

  it('puts a due date in amber a week before and in red once past, nothing far from it nor once settled', () => {
    expect(dueChip({ kind: 'invoice', due: 'soon' })).toEqual({ label: 'Bientôt due', tone: 'warn' });
    expect(dueChip({ kind: 'invoice', due: 'overdue' })).toEqual({ label: 'En retard', tone: 'danger' });
    expect(dueChip({ kind: 'invoice', due: 'open' })).toBeNull();
    expect(dueChip({ kind: 'invoice', due: 'settled' })).toBeNull();
  });

  it('reads how a debt ended, and the due date of an invoice that still waits', () => {
    const paid = invoiceOf(1, THEO, OCT2, {
      due: 'settled',
      settlement: { kind: 'paid', statementId: payId(951), on: '2026-11-03' },
    });
    expect(flat(settlementText(paid))).toBe('payée le mar. 3 nov.');
    expect(dueText(paid)).toBeNull();
    const imputed = invoiceOf(2, THEO, OCT2, {
      kind: 'credit_note',
      creditedInvoiceId: payId(901),
      exclVatMinor: -2_000,
      inclVatMinor: -2_000,
      settlement: { kind: 'imputed', statementId: payId(952), on: '2026-11-03' },
    });
    expect(flat(settlementText(imputed))).toBe('imputé le mar. 3 nov.');
    const compensated = invoiceOf(3, THEO, OCT2, {
      settlement: { kind: 'compensated', statementId: payId(953), on: '2026-11-01' },
    });
    expect(flat(settlementText(compensated))).toBe('compensée le dim. 1er nov.');
    expect(flat(dueText(invoiceOf(4, THEO, OCT2)))).toBe('échéance le ven. 1er janv.');
    expect(
      dueText(invoiceOf(5, THEO, OCT2, { kind: 'credit_note', creditedInvoiceId: payId(901) })),
    ).toBeNull();
  });

  it('says the quinzaine a credit note or a corrective invoice corrects, not the one it was owed in', () => {
    expect(flat(periodText({ kind: 'invoice', corrective: false, period: OCT2 }))).toBe(
      'quinzaine du 16 – 31 octobre 2026',
    );
    expect(flat(periodText({ kind: 'credit_note', corrective: false, period: OCT1 }))).toBe(
      'corrige la quinzaine du 1er – 15 octobre 2026',
    );
    expect(flat(periodText({ kind: 'invoice', corrective: true, period: OCT1 }))).toBe(
      'corrige la quinzaine du 1er – 15 octobre 2026',
    );
  });

  it('says the end of the delay while the answer waits, nothing once answered', () => {
    const acceptance = { state: 'pending' as const, deadline: '2026-11-09T22:59:00.000Z' };
    expect(flat(deadlineText(acceptance, 'Europe/Paris'))).toBe(
      'réponse avant le lundi 9 novembre à 23 h 59',
    );
    expect(deadlineText({ ...acceptance, state: 'accepted' }, 'Europe/Paris')).toBeNull();
  });

  it('dates each step of a document in the agency’s zone', () => {
    expect(
      flat(eventLine({ kind: 'lapsed', at: '2026-11-09T23:00:00.000Z' }, 'invoice', 'Europe/Paris')),
    ).toBe('Acceptée tacitement le mardi 10 novembre à 0 h');
    expect(
      flat(eventLine({ kind: 'issued', at: '2026-11-02T09:00:00.000Z' }, 'credit_note', 'Europe/Paris')),
    ).toBe('Émis le lundi 2 novembre à 10 h');
  });
});

describe('the statement a document leads to', () => {
  it('is its own quinzaine for an invoice, the list’s for a credit note listed under one, none otherwise', () => {
    expect(statementPeriodOf(invoiceOf(1, THEO, OCT2), null)).toBe(OCT2);
    const credit = invoiceOf(2, THEO, OCT1, { kind: 'credit_note', creditedInvoiceId: payId(901) });
    expect(statementPeriodOf(credit, OCT2)).toBe(OCT2);
    expect(statementPeriodOf(credit, null)).toBeNull();
    expect(statementPeriodOf({ ...credit, statementId: null }, OCT2)).toBeNull();
  });
});

describe('the contests first', () => {
  it('keeps the server’s order inside each group', () => {
    const contested = { state: 'contested' as const, deadline: '2026-11-09T22:59:00.000Z', reason: 'Faux' };
    const a = invoiceOf(1, THEO, NOV1);
    const b = invoiceOf(2, LOU, NOV1, { acceptance: contested });
    const c = invoiceOf(3, THEO, NOV1);
    expect(contestsFirst([a, b, c]).map((one) => one.number)).toEqual([b.number, a.number, c.number]);
  });
});

describe('refusals', () => {
  it('words every code of the invoices in French, never a raw code', () => {
    for (const code of [
      ...INVOICE_ERROR_CODES,
      'payroll_forbidden',
      'role_forbidden',
      'request_invalid',
    ] as const) {
      const text = invoiceRefusalText({ kind: 'refused', code, details: {} });
      expect(text).not.toMatch(/_/u);
      expect(text.length).toBeGreaterThan(10);
    }
    expect(invoiceRefusalText({ kind: 'failed' })).toMatch(/serveur ne répond pas/u);
  });

  it('says why a correction is refused, by its reason', () => {
    const refused = (reason: string) =>
      invoiceRefusalText({ kind: 'refused', code: 'invoice_correction_unprocessable', details: { reason } });
    expect(refused('reissue_credit_note')).toBe('Seule une facture s’annule et se refacture, pas un avoir.');
    expect(refused('nothing_left')).toMatch(/plus rien à refaire/u);
    expect(refused('above_pay_amount_max')).toMatch(/ajustement de paie/u);
    expect(refused('autre')).toBe('Ce document ne permet pas cette correction.');
  });

  it('reads the list again only when what it showed is no longer true', () => {
    expect(readsAgain({ kind: 'refused', code: 'invoice_acceptance_conflict', details: {} })).toBe(true);
    expect(readsAgain({ kind: 'refused', code: 'credit_note_amount_unprocessable', details: {} })).toBe(
      false,
    );
    expect(readsAgain({ kind: 'failed' })).toBe(false);
  });
});
