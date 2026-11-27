import type { InvoiceListItem, PendingContractorDocuments } from '@impera/contracts';

/**
 * What waits for the owner on the invoices, in lines for the Dashboard (EQ-06 lot 8d, ADR 0024 « factures
 * contestées »): the invoices past due first (red, the one urgency), then those due within seven days and the contests
 * to settle (amber), then the documents to check. Short lines without a final stop: they are the rows of « À faire ». Counted from what the server computed (`due`, the acceptance), never
 * from a clock of the screen. No line, no card: the Dashboard says nothing while nothing waits.
 */

export type PaperworkTone = 'danger' | 'warn' | 'neutral';

export type PaperworkLine =
  | {
      readonly kind: 'invoices';
      readonly tone: PaperworkTone;
      readonly text: string;
      /** What it means, under the line; null for a line that says it all. */
      readonly detail: string | null;
    }
  | {
      readonly kind: 'documents';
      readonly tone: PaperworkTone;
      readonly text: string;
      /** Each member once, in the order of their oldest document, to open his file. */
      readonly members: readonly { readonly memberId: string; readonly name: string }[];
      readonly more: boolean;
    };

const count = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

export function paperworkLines(
  dues: readonly Pick<InvoiceListItem, 'due'>[],
  contests: readonly Pick<InvoiceListItem, 'acceptance'>[],
  pending: PendingContractorDocuments | null,
): PaperworkLine[] {
  const lines: PaperworkLine[] = [];
  const overdue = dues.filter((item) => item.due === 'overdue').length;
  const soon = dues.filter((item) => item.due === 'soon').length;
  const contested = contests.filter((item) => item.acceptance.state === 'contested').length;
  if (overdue > 0)
    lines.push({
      kind: 'invoices',
      tone: 'danger',
      text: count(overdue, 'facture en retard', 'factures en retard'),
      detail: 'L’échéance est passée sans règlement.',
    });
  if (soon > 0)
    lines.push({
      kind: 'invoices',
      tone: 'warn',
      text: `${count(soon, 'facture', 'factures')} à échéance dans les sept jours`,
      detail: null,
    });
  if (contested > 0)
    lines.push({
      kind: 'invoices',
      tone: 'warn',
      text: `${count(contested, 'contestation', 'contestations')} à trancher`,
      detail: null,
    });
  if (pending !== null && pending.documents.length > 0) {
    const members: { memberId: string; name: string }[] = [];
    for (const document of pending.documents)
      if (!members.some((one) => one.memberId === document.memberId))
        members.push({ memberId: document.memberId, name: document.displayName });
    const n = pending.documents.length;
    lines.push({
      kind: 'documents',
      tone: 'neutral',
      text: pending.more
        ? `Plus de ${count(n, 'pièce', 'pièces')} à examiner`
        : `${count(n, 'pièce', 'pièces')} à examiner`,
      members,
      more: pending.more,
    });
  }
  return lines;
}
