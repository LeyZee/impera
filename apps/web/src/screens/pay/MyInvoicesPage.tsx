import type { InvoiceListItem, TeamMemberId } from '@impera/contracts';
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
import { Page, PageHeader, Panel } from '@/shell/layout';

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
  actions = <CommissionsNav />,
  memberId,
}: {
  /** Commissions for a chatter; Moi for a manager, whose commissions are there (ADR 0024). */
  eyebrow?: string;
  actions?: ReactNode;
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
  const [opened, setOpened] = useState<Opened | null>(null);

  return (
    <Page>
      <PageHeader
        eyebrow={eyebrow}
        title="Factures"
        lead="Les factures que l’agence émet en ton nom, et les avoirs qui les corrigent. Tu acceptes ou contestes chacune avant la fin de son délai."
        actions={actions}
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
              older="Le serveur ne répond pas : les factures plus anciennes n’ont pas pu être lues."
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
