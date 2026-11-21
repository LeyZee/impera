import type { InvoiceListItem, TeamMemberId } from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import { useState, type JSX, type ReactNode } from 'react';

import { CommissionsNav } from './CommissionsNav';
import { AnswerDialog, DetailDialog, InvoiceRow } from './InvoiceRow';
import { InvoiceYears } from './InvoiceYears';
import { useAgencySettingsDown, useAgencyToday } from './data';
import { Loading, Unreachable } from './parts';

import { useInvoiceYears } from '@/invoices/api';
import '@/payroll/pay.css';
import { useSchedulingSettings } from '@/reports/api';
import '@/reports/reports.css';
import '@/scheduling/scheduling.css';
import '@/screens/team/team.css';
import { useMembers } from '@/screens/team/api';
import { Page, PageHeader, Panel, type PageWidth } from '@/shell/layout';

/** What the reader opened on a document: his answer, or its detail. */
type Opened =
  | { readonly kind: 'answer'; readonly item: InvoiceListItem; readonly answer: 'accept' | 'contest' }
  | { readonly kind: 'detail'; readonly item: InvoiceListItem };

/**
 * Commissions › Factures (EQ-06 lot 8, the chatter's) and Moi › Factures (the manager's own, lot 8b): the invoices the agency
 * issues in his name and the credit notes that correct them, the latest first, a year at a time. He accepts or contests
 * each while its delay runs; the payment reads on the document. No due date in colour: that is the agency's to watch.
 */
export function MyInvoicesPage({
  eyebrow = 'Commissions',
  tabs = <CommissionsNav />,
  width = 'wide',
  memberId,
}: {
  /** Commissions for a chatter; Moi for a manager, whose commissions are there (ADR 0024). */
  eyebrow?: string;
  /** The section's tabs, in the header's row of tabs. */
  tabs?: ReactNode;
  /** The section's column: Commissions' wide one, or Moi's narrow one (COH-02). */
  width?: PageWidth;
  /**
   * A manager's own member: an active manager reads every document of the agency, so his own list asks for his alone.
   * A chatter reads only his, without it.
   */
  memberId?: TeamMemberId;
}): JSX.Element {
  const today = useAgencyToday();
  const down = useAgencySettingsDown();
  const timeZone = useSchedulingSettings().data?.timeZone ?? null;
  const years = useInvoiceYears(memberId === undefined ? {} : { memberId }, today);
  // The day he joined: no year before it to look in (CHA-18). A member reads his own row alone; a manager is named.
  const members = useMembers().data;
  const mine =
    memberId === undefined
      ? members?.length === 1
        ? members[0]
        : undefined
      : members?.find((member) => member.id === memberId);
  const [opened, setOpened] = useState<Opened | null>(null);

  return (
    <Page width={width}>
      <PageHeader
        eyebrow={eyebrow}
        title="Factures"
        lead="Factures et avoirs émis en ton nom : accepte ou conteste chacun avant son délai."
        tabs={tabs}
      />
      <div className="py-board">
        <Panel className="nv-enter">
          {timeZone === null && down !== null ? (
            <Unreachable what="l’heure de l’agence" onRetry={down} />
          ) : timeZone === null ? (
            <Loading rows={3} />
          ) : (
            <InvoiceYears
              years={years}
              today={today}
              what="la liste de tes factures"
              hint="Ta première facture s’émet quand ton premier relevé est validé, une fois ton dossier complet."
              first="Aucune facture sur les dix dernières années : la première s’émet quand ton premier relevé est validé, une fois ton dossier complet."
              older="Les factures plus anciennes n’ont pas pu être lues : réessaie dans un instant."
              since={mine?.joinedOn ?? null}
              none={{
                whisper: 'Pas encore de facture.',
                text: 'Elle arrive avec ton premier relevé validé, une fois ton dossier rempli.',
                action: (
                  <Link to="/moi/dossier" className="nv-btn nv-btn--soft">
                    Ouvrir mon dossier
                  </Link>
                ),
              }}
              row={(item) => (
                <InvoiceRow
                  item={item}
                  who={null}
                  reader={{ contractor: true, agency: false, owner: false }}
                  timeZone={timeZone}
                  statementPeriod={null}
                  onAnswer={(answer) => {
                    setOpened({ kind: 'answer', item, answer });
                  }}
                  onSettle={() => undefined}
                  onDetail={() => {
                    setOpened({ kind: 'detail', item });
                  }}
                />
              )}
            />
          )}
        </Panel>
      </div>
      {opened?.kind === 'answer' ? (
        <AnswerDialog
          item={opened.item}
          answer={opened.answer}
          onClose={() => {
            setOpened(null);
          }}
        />
      ) : null}
      {opened?.kind === 'detail' && timeZone !== null ? (
        <DetailDialog
          item={opened.item}
          who={null}
          timeZone={timeZone}
          onClose={() => {
            setOpened(null);
          }}
        />
      ) : null}
    </Page>
  );
}
