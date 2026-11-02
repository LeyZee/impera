import { DomainError, type JournalAccountName } from '@nirvana/contracts';

/** The export needs every account and journal the accountant gives: it never guesses one (EQ-06 lot 7b). */
export class JournalAccountsMissing extends DomainError {
  constructor(missing: readonly JournalAccountName[]) {
    super(
      'journal_accounts_missing_unprocessable',
      'Des comptes du journal manquent : le comptable les donne',
      {
        details: { missing },
      },
    );
  }
}
