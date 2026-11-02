import {
  JOURNAL_ACCOUNT_NAMES,
  JournalAccountsSchema,
  type JournalAccountName,
  type JournalAccounts,
} from '@nirvana/contracts';

/**
 * The journal's accounts as Réglages › Facturation types them (EQ-06 lot 8c): eight fields, empty until the accountant
 * gives each, never a number proposed. An empty field is sent as `null`: the export then names it in its refusal. The
 * contract checks the rest (`JournalAccountsSchema`): its words are said under the field.
 */

export type AccountsDraft = Readonly<Record<JournalAccountName, string>>;

/** The fields from the accounts saved, each empty while the accountant has not given it. */
export function accountsDraftOf(accounts: JournalAccounts | null): AccountsDraft {
  const draft: Record<JournalAccountName, string> = {
    expense: '',
    supplier: '',
    vatDeductible: '',
    vatSelfAssessedDeductible: '',
    vatSelfAssessedDue: '',
    bank: '',
    purchaseJournal: '',
    bankJournal: '',
  };
  for (const name of JOURNAL_ACCOUNT_NAMES) draft[name] = accounts?.[name] ?? '';
  return draft;
}

/** « 401 nora » → « 401NORA »: an account as the export writes it, capitals and digits without a space. */
export const accountOf = (text: string): string | null => {
  const compact = text.replace(/\s/gu, '').toUpperCase();
  return compact === '' ? null : compact;
};

/** The body the form sends, or what is wrong with each field in the contract's words. */
export function accountsBodyOf(
  draft: AccountsDraft,
):
  | { readonly ok: true; readonly body: JournalAccounts }
  | { readonly ok: false; readonly problems: Partial<Record<JournalAccountName, string>> } {
  const parsed = JournalAccountsSchema.safeParse({
    expense: accountOf(draft.expense),
    supplier: accountOf(draft.supplier),
    vatDeductible: accountOf(draft.vatDeductible),
    vatSelfAssessedDeductible: accountOf(draft.vatSelfAssessedDeductible),
    vatSelfAssessedDue: accountOf(draft.vatSelfAssessedDue),
    bank: accountOf(draft.bank),
    purchaseJournal: accountOf(draft.purchaseJournal),
    bankJournal: accountOf(draft.bankJournal),
  });
  if (parsed.success) return { ok: true, body: parsed.data };
  const problems: Partial<Record<JournalAccountName, string>> = {};
  for (const issue of parsed.error.issues) {
    const name = JOURNAL_ACCOUNT_NAMES.find((one) => one === issue.path[0]);
    if (name !== undefined && problems[name] === undefined)
      problems[name] = `${issue.message.replace(/\.$/u, '')}.`;
  }
  return { ok: false, problems };
}

/** How many of the eight the accountant has given. */
export const givenCount = (accounts: JournalAccounts | null): number =>
  accounts === null ? 0 : JOURNAL_ACCOUNT_NAMES.filter((name) => accounts[name] !== null).length;
