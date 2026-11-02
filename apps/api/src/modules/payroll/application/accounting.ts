import {
  ACCOUNTING_JOURNAL_MEDIA_TYPE,
  type AccountingJournal,
  type AccountingJournalQuery,
} from '@nirvana/contracts';

import { JournalAccountsMissing } from '../domain/errors';
import { fecText, journalFileName, latin9 } from '../domain/fec';
import { journalEntries, ledgerAccountsOf } from '../domain/journal';
import type { Actor, PayrollAccountingStore } from '../domain/ports';

/**
 * The accountant's export (EQ-06 lot 7b; ADR 0023 « export comptable par période »): the contractors' journal from one
 * day to another, the owner's alone, in a file the accountant imports. It refuses while an account or a journal is
 * missing (`journal_accounts_missing_unprocessable`, the names in `details.missing`): none is ever guessed.
 */
export interface PayrollAccounting {
  journal(actor: Actor, query: AccountingJournalQuery): Promise<AccountingJournal>;
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
  };
}
