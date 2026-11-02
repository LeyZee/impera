import {
  ACCOUNTING_JOURNAL_MEDIA_TYPE,
  DAS2_MEDIA_TYPE,
  type AccountingJournal,
  type AccountingJournalQuery,
  type Das2Export,
  type Das2Query,
} from '@nirvana/contracts';

import { das2Csv, das2Declaration, das2FileName } from '../domain/accounting';
import { JournalAccountsMissing } from '../domain/errors';
import { fecText, journalFileName, latin9 } from '../domain/fec';
import { journalEntries, ledgerAccountsOf } from '../domain/journal';
import type { Actor, PayrollAccountingStore } from '../domain/ports';

/**
 * The accountant's exports, the owner's alone (EQ-06 lot 7; ADR 0023 « export comptable par période »):
 *
 * - **the journal** (lot 7b): the contractors' journal from one day to another, in a file the accountant imports. It
 *   refuses while an account or a journal is missing (`journal_accounts_missing_unprocessable`, the names in
 *   `details.missing`): none is ever guessed.
 * - **the DAS2 recap** (lot 7c): who was paid more than 2 400 € in a calendar year, under the identity their invoice
 *   froze, with what the accountant checks before declaring (`domain/accounting.ts`). A recap, not the declaration:
 *   the accountant files it.
 */
export interface PayrollAccounting {
  journal(actor: Actor, query: AccountingJournalQuery): Promise<AccountingJournal>;
  das2(actor: Actor, query: Das2Query): Promise<Das2Export>;
}

export function createPayrollAccounting(store: PayrollAccountingStore): PayrollAccounting {
  return {
    journal: (actor, { from, to }) =>
      store.exportJournal(actor, from, to, (facts) => {
        const ledger = ledgerAccountsOf(facts.accounts);
        if ('missing' in ledger) throw new JournalAccountsMissing(ledger.missing);
        const { entries, unbalanced } = journalEntries(facts.contractors, ledger.accounts, from, to);
        return {
          fileName: journalFileName(from, to),
          mediaType: ACCOUNTING_JOURNAL_MEDIA_TYPE,
          content: Buffer.from(latin9(fecText(entries, ledger.accounts))).toString('base64'),
          entryCount: entries.length,
          unbalanced,
          transfersLeftOut: [...facts.transfersLeftOut],
        };
      }),

    das2: (actor, { year }) =>
      store.exportDas2(actor, year, (facts): Das2Export => {
        const beneficiaries = das2Declaration(year, facts.contractors);
        return {
          year,
          fileName: das2FileName(year),
          mediaType: DAS2_MEDIA_TYPE,
          content: Buffer.from(das2Csv(beneficiaries), 'utf8').toString('base64'),
          beneficiaries,
          // The sums are what left, never recomputed: a contractor charging VAT is paid excluding it (accountant's question).
          notes: ['amounts_as_sent'],
        };
      }),
  };
}
