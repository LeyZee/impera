import { PayPeriodSchema, TeamMemberIdSchema, type JournalAccounts } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { fecText, journalFileName, latin9 } from '../fec';
import {
  contractorJournal,
  journalEntries,
  ledgerAccountsOf,
  letteringCode,
  transfersLeftOutInOrder,
  type JournalContractor,
  type JournalDocument,
  type JournalStatement,
  type LedgerAccounts,
} from '../journal';

/** The accountant's accounts and journals; invented here, set in Réglages › Facturation. */
const ACCOUNTS: LedgerAccounts = {
  expense: '622600',
  supplier: '401',
  vatDeductible: '445660',
  vatSelfAssessedDeductible: '445662',
  vatSelfAssessedDue: '445200',
  bank: '512000',
  purchaseJournal: 'HA',
  bankJournal: 'BQ',
};

const P = (day: string) => PayPeriodSchema.parse(day);

const statement = (
  patch: Partial<JournalStatement> & Pick<JournalStatement, 'id' | 'period'>,
): JournalStatement => ({
  status: 'validated',
  totalMinor: 0,
  validatedOn: null,
  payment: null,
  ...patch,
});

/** A document without VAT (franchise, or the treaty's reverse charge counted apart). */
const document = (
  number: string,
  statementId: string | null,
  exclVatMinor: number,
  patch: Partial<JournalDocument> = {},
): JournalDocument => ({
  kind: exclVatMinor < 0 ? 'credit_note' : 'invoice',
  corrective: false,
  number,
  issuedOn: '2026-11-02',
  statementId,
  totals: { exclVatMinor, vatMinor: 0, inclVatMinor: exclVatMinor, selfAssessedVatMinor: 0 },
  ...patch,
});

const contractor = (patch: Partial<JournalContractor> = {}): JournalContractor => ({
  prefix: 'NORA',
  name: 'Nora Vidal',
  statements: [],
  carryOvers: [],
  documents: [],
  ...patch,
});

/** The signed amounts of an entry's lines, as « account aux: amount ». */
const amounts = (
  lines: readonly { account: string; auxiliary: { account: string } | null; amountMinor: number }[],
) =>
  lines.map(
    (line) =>
      `${line.account}${line.auxiliary === null ? '' : ` ${line.auxiliary.account}`}: ${String(line.amountMinor)}`,
  );

describe('Équipe › Factures : le journal du comptable (EQ-06 lot 7b)', () => {
  it('never guesses an account: the export lists those the accountant has not given', () => {
    expect(ledgerAccountsOf(null)).toEqual({
      missing: [
        'expense',
        'supplier',
        'vatDeductible',
        'vatSelfAssessedDeductible',
        'vatSelfAssessedDue',
        'bank',
        'purchaseJournal',
        'bankJournal',
      ],
    });
    const partial: JournalAccounts = { ...ACCOUNTS, bank: null, bankJournal: null };
    expect(ledgerAccountsOf(partial)).toEqual({ missing: ['bank', 'bankJournal'] });
    expect(ledgerAccountsOf({ ...ACCOUNTS })).toEqual({ accounts: ACCOUNTS });
  });

  it('writes an invoice on the expense, the VAT and the contractor’s supplier account, and a credit note the other way', () => {
    const charged = document('NORA-2026-0001', 's1', 10_000, {
      totals: { exclVatMinor: 10_000, vatMinor: 2_000, inclVatMinor: 12_000, selfAssessedVatMinor: 0 },
    });
    const reverse = document('NORA-2026-0002', 's1', 5_000, {
      totals: { exclVatMinor: 5_000, vatMinor: 0, inclVatMinor: 5_000, selfAssessedVatMinor: 1_000 },
    });
    const credit = document('NORA-2026-0003', 's1', -1_500, {
      totals: { exclVatMinor: -1_500, vatMinor: -300, inclVatMinor: -1_800, selfAssessedVatMinor: 0 },
    });
    const corrective = document('NORA-2026-0004', 's1', 700, { corrective: true });
    const { entries } = contractorJournal(
      contractor({ documents: [charged, reverse, credit, corrective] }),
      ACCOUNTS,
      '2026-11-01',
      '2026-11-30',
    );
    expect(
      entries.map((entry) => [entry.journal, entry.pieceRef, entry.label, amounts(entry.lines)]),
    ).toEqual([
      [
        'purchases',
        'NORA-2026-0001',
        'Facture NORA-2026-0001',
        ['622600: 10000', '445660: 2000', '401 401NORA: -12000'],
      ],
      [
        'purchases',
        'NORA-2026-0002',
        'Facture NORA-2026-0002',
        ['622600: 5000', '445662: 1000', '445200: -1000', '401 401NORA: -5000'],
      ],
      [
        'purchases',
        'NORA-2026-0003',
        'Avoir NORA-2026-0003',
        ['622600: -1500', '445660: -300', '401 401NORA: 1800'],
      ],
      [
        'purchases',
        'NORA-2026-0004',
        'Facture rectificative NORA-2026-0004',
        ['622600: 700', '401 401NORA: -700'],
      ],
    ]);
    for (const entry of entries) expect(entry.lines.reduce((sum, line) => sum + line.amountMinor, 0)).toBe(0);
    expect(entries[0]?.lines.at(-1)?.auxiliary).toEqual({ account: '401NORA', label: 'Nora Vidal' });
  });

  it('writes a transfer in the bank journal, with its reference or one of its own', () => {
    const statements = [
      statement({
        id: 's1',
        period: P('2026-10-16'),
        status: 'paid',
        totalMinor: 9_000,
        payment: { paidOn: '2026-11-05', reference: 'WR-0412', sentMinor: 9_000 },
      }),
      statement({
        id: 's2',
        period: P('2026-11-01'),
        status: 'paid',
        totalMinor: 4_000,
        payment: { paidOn: '2026-11-20', reference: null, sentMinor: 4_000 },
      }),
    ];
    const { entries } = contractorJournal(contractor({ statements }), ACCOUNTS, '2026-11-01', '2026-11-30');
    expect(
      entries.map((entry) => [entry.journal, entry.date, entry.pieceRef, entry.label, amounts(entry.lines)]),
    ).toEqual([
      [
        'bank',
        '2026-11-05',
        'WR-0412',
        'Virement NORA, quinzaine du 16 au 31 octobre 2026',
        ['401 401NORA: 9000', '512000: -9000'],
      ],
      [
        'bank',
        '2026-11-20',
        'VIR-NORA-2026-11-01',
        'Virement NORA, quinzaine du 1er au 15 novembre 2026',
        ['401 401NORA: 4000', '512000: -4000'],
      ],
    ]);
  });

  it('letters a carry-over chain with the transfer that ends it, a negative fortnight included', () => {
    // 9 € under the minimum, then a fortnight below zero, carried on; the third pays what is left of the three.
    const facts = contractor({
      statements: [
        statement({ id: 's0', period: P('2026-10-01'), totalMinor: 900, validatedOn: '2026-10-16' }),
        statement({ id: 's1', period: P('2026-10-16'), totalMinor: -600, validatedOn: '2026-11-01' }),
        statement({
          id: 's2',
          period: P('2026-11-01'),
          status: 'paid',
          totalMinor: 9_400,
          validatedOn: '2026-11-16',
          payment: { paidOn: '2026-11-18', reference: 'WR-0500', sentMinor: 9_400 },
        }),
      ],
      carryOvers: [
        { statementId: 's0', toPeriod: P('2026-10-16') },
        { statementId: 's1', toPeriod: P('2026-11-01') },
      ],
      documents: [
        document('NORA-2026-0001', 's0', 900, { issuedOn: '2026-10-16' }),
        document('NORA-2026-0002', 's1', -1_500, { issuedOn: '2026-11-01' }),
        document('NORA-2026-0003', 's2', 10_000, { issuedOn: '2026-11-16' }),
      ],
    });
    const { entries, unbalanced } = contractorJournal(facts, ACCOUNTS, '2026-10-01', '2026-11-30');
    const supplierLines = entries.flatMap((entry) => entry.lines.filter((line) => line.auxiliary !== null));
    expect(supplierLines.map((line) => line.lettering)).toEqual(
      Array.from({ length: 4 }, () => ({ code: letteringCode(P('2026-11-01')), on: '2026-11-18' })),
    );
    expect(unbalanced).toEqual([]);
    // The other lines are never lettered.
    expect(
      entries
        .flatMap((entry) => entry.lines.filter((line) => line.auxiliary === null))
        .every((line) => line.lettering === null),
    ).toBe(true);
    // Read on all the facts: a range that holds the first invoice only letters it all the same.
    const october = contractorJournal(facts, ACCOUNTS, '2026-10-01', '2026-10-31');
    expect(october.entries.map((entry) => entry.lines.at(-1)?.lettering?.code)).toEqual([
      letteringCode(P('2026-11-01')),
    ]);
  });

  it('letters a compensation at zero on its validation day, and leaves what waits without a letter', () => {
    const facts = contractor({
      statements: [
        statement({ id: 's0', period: P('2026-10-16'), totalMinor: 500, validatedOn: '2026-11-01' }),
        statement({ id: 's1', period: P('2026-11-01'), totalMinor: 0, validatedOn: '2026-11-16' }),
        statement({ id: 's2', period: P('2026-11-16'), totalMinor: 3_000, validatedOn: '2026-12-01' }),
      ],
      carryOvers: [{ statementId: 's0', toPeriod: P('2026-11-01') }],
      documents: [
        document('NORA-2026-0001', 's0', 500, { issuedOn: '2026-11-01' }),
        document('NORA-2026-0002', 's1', -500, { issuedOn: '2026-11-16' }),
        // Validated, still to pay: no letter yet.
        document('NORA-2026-0003', 's2', 3_000, { issuedOn: '2026-12-01' }),
      ],
    });
    const { entries } = contractorJournal(facts, ACCOUNTS, '2026-11-01', '2026-12-31');
    expect(entries.map((entry) => [entry.pieceRef, entry.lines.at(-1)?.lettering ?? null])).toEqual([
      ['NORA-2026-0001', { code: letteringCode(P('2026-11-01')), on: '2026-11-16' }],
      ['NORA-2026-0002', { code: letteringCode(P('2026-11-01')), on: '2026-11-16' }],
      ['NORA-2026-0003', null],
    ]);
  });

  it('leaves a group that does not add up without a letter, and says it: VAT charged on top of the statement', () => {
    const facts = contractor({
      statements: [
        statement({
          id: 's1',
          period: P('2026-11-01'),
          status: 'paid',
          totalMinor: 10_000,
          payment: { paidOn: '2026-11-20', reference: 'WR-0600', sentMinor: 10_000 },
        }),
      ],
      documents: [
        document('NORA-2026-0001', 's1', 10_000, {
          totals: { exclVatMinor: 10_000, vatMinor: 2_000, inclVatMinor: 12_000, selfAssessedVatMinor: 0 },
        }),
      ],
    });
    const { entries, unbalanced } = contractorJournal(facts, ACCOUNTS, '2026-11-01', '2026-11-30');
    expect(entries.flatMap((entry) => entry.lines).every((line) => line.lettering === null)).toBe(true);
    expect(unbalanced).toEqual([{ prefix: 'NORA', period: P('2026-11-01') }]);
    // A transfer without any document says it too.
    const bare = contractorJournal(
      contractor({ statements: facts.statements }),
      ACCOUNTS,
      '2026-11-01',
      '2026-11-30',
    );
    expect(bare.unbalanced).toEqual([{ prefix: 'NORA', period: P('2026-11-01') }]);
    // Out of the range, nothing is said.
    expect(contractorJournal(facts, ACCOUNTS, '2026-12-01', '2026-12-31').unbalanced).toEqual([]);
  });

  it('gives each fortnight its own three letters, the same in every export', () => {
    expect(letteringCode(P('2000-01-01'))).toBe('AAA');
    expect(letteringCode(P('2000-01-16'))).toBe('AAB');
    expect(letteringCode(P('2001-01-01'))).toBe('AAY');
    expect(letteringCode(P('2026-11-01'))).toBe('AYU');
    expect(letteringCode(P('2026-11-16'))).toBe('AYV');
  });

  it('orders every contractor’s entries by day, purchases before the bank on the same day, then by piece', () => {
    const nora = contractor({
      documents: [document('NORA-2026-0002', null, 100, { issuedOn: '2026-11-03' })],
      statements: [
        statement({
          id: 's1',
          period: P('2026-10-16'),
          status: 'paid',
          totalMinor: 100,
          payment: { paidOn: '2026-11-03', reference: 'WR-1', sentMinor: 100 },
        }),
      ],
    });
    const yan = contractor({
      prefix: 'YAN',
      name: 'Yan Koffi',
      documents: [
        document('YAN-2026-0001', null, 200, { issuedOn: '2026-11-03' }),
        document('YAN-2026-0002', null, 300, { issuedOn: '2026-11-01' }),
      ],
    });
    const { entries } = journalEntries([nora, yan], ACCOUNTS, '2026-11-01', '2026-11-30');
    expect(entries.map((entry) => `${entry.date} ${entry.journal} ${entry.pieceRef}`)).toEqual([
      '2026-11-01 purchases YAN-2026-0002',
      '2026-11-03 purchases NORA-2026-0002',
      '2026-11-03 purchases YAN-2026-0001',
      '2026-11-03 bank WR-1',
    ]);
  });
});

describe('Équipe › Factures : le fichier du journal (EQ-06 lot 7b)', () => {
  const { entries } = contractorJournal(
    contractor({
      statements: [
        statement({
          id: 's1',
          period: P('2026-11-01'),
          status: 'paid',
          totalMinor: 123_456,
          payment: { paidOn: '2026-11-20', reference: 'WR\t0412', sentMinor: 123_456 },
        }),
      ],
      documents: [document('NORA-2026-0001', 's1', 123_456, { issuedOn: '2026-11-16' })],
    }),
    ACCOUNTS,
    '2026-11-01',
    '2026-11-30',
  );
  const text = fecText(entries, ACCOUNTS);
  const rows = text.split('\r\n');

  it('writes the 18 columns of the FEC, tab separated, one line per line of an entry', () => {
    expect(rows[0]).toBe(
      'JournalCode\tJournalLib\tEcritureNum\tEcritureDate\tCompteNum\tCompteLib\tCompAuxNum\tCompAuxLib\tPieceRef\tPieceDate\tEcritureLib\tDebit\tCredit\tEcritureLet\tDateLet\tValidDate\tMontantdevise\tIdevise',
    );
    expect(rows.at(-1)).toBe('');
    for (const row of rows.slice(0, -1)) expect(row.split('\t')).toHaveLength(18);
    expect(rows.slice(1, -1)).toEqual([
      'HA\tAchats prestataires\t1\t20261116\t622600\tCommissions des prestataires\t\t\tNORA-2026-0001\t20261116\tFacture NORA-2026-0001\t1234,56\t0,00\t\t\t20261116\t\t',
      'HA\tAchats prestataires\t1\t20261116\t401\tFournisseurs\t401NORA\tNora Vidal\tNORA-2026-0001\t20261116\tFacture NORA-2026-0001\t0,00\t1234,56\tAYU\t20261120\t20261116\t\t',
      'BQ\tBanque\t1\t20261120\t401\tFournisseurs\t401NORA\tNora Vidal\tWR 0412\t20261120\tVirement NORA, quinzaine du 1er au 15 novembre 2026\t1234,56\t0,00\tAYU\t20261120\t20261120\t\t',
      'BQ\tBanque\t1\t20261120\t512000\tBanque\t\t\tWR 0412\t20261120\tVirement NORA, quinzaine du 1er au 15 novembre 2026\t0,00\t1234,56\t\t\t20261120\t\t',
    ]);
  });

  it('numbers each journal’s entries from 1, and names the file apart from the legal FEC', () => {
    const two = fecText([...entries, ...entries], ACCOUNTS)
      .split('\r\n')
      .slice(1, -1);
    expect(two.map((row) => row.split('\t').slice(0, 3).join(' '))).toEqual([
      'HA Achats prestataires 1',
      'HA Achats prestataires 1',
      'BQ Banque 1',
      'BQ Banque 1',
      'HA Achats prestataires 2',
      'HA Achats prestataires 2',
      'BQ Banque 2',
      'BQ Banque 2',
    ]);
    expect(journalFileName('2026-11-01', '2026-11-30')).toBe('journal-prestataires_20261101_20261130.txt');
  });

  it('encodes the text in ISO 8859-15, with the nearest character for those it lacks', () => {
    expect([...latin9('é€œŸ')]).toEqual([0xe9, 0xa4, 0xbd, 0xbe]);
    expect(new TextDecoder('latin1').decode(latin9('L’agence « Fictive » – ½ jour…'))).toBe(
      "L'agence « Fictive » - 1/2 jour...",
    );
    // A space of any width is a plain space; a letter it lacks loses its accent (« ź »); anything else is « ? ».
    expect(new TextDecoder('latin1').decode(latin9('1 234 Łódź ă 😀'))).toBe('1 234 ?ódz a ?');
    expect([...latin9('\t\r\n')]).toEqual([0x09, 0x0d, 0x0a]);
  });
});

describe('the transfers left out of the journal', () => {
  it('lists them by member then period, whatever order the members were read in', () => {
    const first = TeamMemberIdSchema.parse('0195f0c0-0000-7000-8000-000000000001');
    const second = TeamMemberIdSchema.parse('0195f0c0-0000-7000-8000-000000000002');
    const [p1, p2] = [PayPeriodSchema.parse('2026-10-01'), PayPeriodSchema.parse('2026-10-16')];
    const read = [
      { memberId: second, period: p2 },
      { memberId: first, period: p2 },
      { memberId: second, period: p1 },
      { memberId: first, period: p1 },
    ];
    expect(transfersLeftOutInOrder(read)).toEqual([
      { memberId: first, period: p1 },
      { memberId: first, period: p2 },
      { memberId: second, period: p1 },
      { memberId: second, period: p2 },
    ]);
    expect(read[0]).toEqual({ memberId: second, period: p2 });
  });
});
