import { describe, expect, it } from 'vitest';

import { correctionAdjustments, correctionReplayed, type ContestedDocument } from '../contest-correction';

/* Invented numbers (ADR 0010). */
const invoice: ContestedDocument = {
  kind: 'invoice',
  invoice: { number: 'AEX-2026-0021', issuedOn: '2026-11-01', leftMinor: 32_321 },
};
const creditNote: ContestedDocument = { ...invoice, kind: 'credit_note' };

describe('the correction of an upheld contest (EQ-06 lot 6, ADR 0039 § 3)', () => {
  it('writes one adjustment for an amount, the owner’s reason trimmed, in either favour', () => {
    expect(
      correctionAdjustments(invoice, { kind: 'amount', amountMinor: 4_500 }, ' Vente du 3 oubliée '),
    ).toEqual([{ amountMinor: 4_500, reason: 'Vente du 3 oubliée' }]);
    expect(correctionAdjustments(invoice, { kind: 'amount', amountMinor: -32_321 }, 'Remboursée')).toEqual([
      { amountMinor: -32_321, reason: 'Remboursée' },
    ]);
    // A credit note contested has the same ends: an amount corrects it, on the invoice it cites (§ 5).
    expect(
      correctionAdjustments(creditNote, { kind: 'amount', amountMinor: 1_000 }, 'Avoir trop fort'),
    ).toEqual([{ amountMinor: 1_000, reason: 'Avoir trop fort' }]);
  });

  it('never credits an invoice below zero', () => {
    expect(() =>
      correctionAdjustments(invoice, { kind: 'amount', amountMinor: -32_322 }, 'Trop haut'),
    ).toThrow(
      expect.objectContaining({ code: 'credit_note_amount_unprocessable', details: { leftMinor: 32_321 } }),
    );
    expect(() =>
      correctionAdjustments(
        { ...creditNote, invoice: { ...creditNote.invoice, leftMinor: 0 } },
        { kind: 'amount', amountMinor: -1 },
        'Encore',
      ),
    ).toThrow(expect.objectContaining({ code: 'credit_note_amount_unprocessable' }));
  });

  it('cancels and reissues what is left of an invoice, the payouts unmoved, each saying which', () => {
    const pair = correctionAdjustments(invoice, { kind: 'reissue' }, 'Adresse fausse');
    expect(pair).toEqual([
      { amountMinor: -32_321, reason: 'Annulation de la facture AEX-2026-0021 du 1er novembre 2026' },
      { amountMinor: 32_321, reason: 'Refacturation de la facture AEX-2026-0021 du 1er novembre 2026' },
    ]);
    expect(pair.reduce((total, one) => total + one.amountMinor, 0)).toBe(0);
  });

  it('reissues neither a credit note nor an invoice its credit notes took off whole', () => {
    expect(() => correctionAdjustments(creditNote, { kind: 'reissue' }, 'Nom faux')).toThrow(
      expect.objectContaining({
        code: 'invoice_correction_unprocessable',
        details: { reason: 'reissue_credit_note' },
      }),
    );
    expect(() =>
      correctionAdjustments(
        { ...invoice, invoice: { ...invoice.invoice, leftMinor: 0 } },
        { kind: 'reissue' },
        'Nom faux',
      ),
    ).toThrow(expect.objectContaining({ details: { reason: 'nothing_left' } }));
  });

  it('refuses a correction without a reason or without an amount', () => {
    expect(() => correctionAdjustments(invoice, { kind: 'amount', amountMinor: 100 }, '  ')).toThrow(
      RangeError,
    );
    expect(() => correctionAdjustments(invoice, { kind: 'amount', amountMinor: 0 }, 'Rien')).toThrow(
      RangeError,
    );
    expect(() => correctionAdjustments(invoice, { kind: 'amount', amountMinor: 0.5 }, 'Demi')).toThrow(
      RangeError,
    );
  });

  it('tells the same correction sent again from another, whatever the invoice has left since', () => {
    const amount = { kind: 'amount', amountMinor: 4_500 } as const;
    const one = [{ amountMinor: 4_500, reason: 'Vente du 3 oubliée' }];
    expect(correctionReplayed(invoice, amount, ' Vente du 3 oubliée ', one)).toBe(true);
    expect(
      correctionReplayed(invoice, { kind: 'amount', amountMinor: 4_000 }, 'Vente du 3 oubliée', one),
    ).toBe(false);
    expect(correctionReplayed(invoice, amount, 'Une autre raison', one)).toBe(false);
    expect(correctionReplayed(invoice, amount, 'Vente du 3 oubliée', [...one, ...one])).toBe(false);

    // The cancel went out since: nothing is left of the invoice, the pair written is still the one asked.
    const pair = correctionAdjustments(invoice, { kind: 'reissue' }, 'Adresse fausse');
    const cancelled = { ...invoice, invoice: { ...invoice.invoice, leftMinor: 0 } };
    expect(correctionReplayed(cancelled, { kind: 'reissue' }, 'Adresse fausse', pair)).toBe(true);
    expect(correctionReplayed(invoice, { kind: 'reissue' }, 'Adresse fausse', one)).toBe(false);
    expect(correctionReplayed(invoice, amount, 'Vente du 3 oubliée', pair)).toBe(false);
    expect(correctionReplayed(creditNote, { kind: 'reissue' }, 'Adresse fausse', pair)).toBe(false);
  });
});
