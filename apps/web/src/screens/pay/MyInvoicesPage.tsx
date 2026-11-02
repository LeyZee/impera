import type { InvoiceListItem } from '@nirvana/contracts';
import { useState, type JSX } from 'react';

import { CommissionsNav } from './CommissionsNav';
import { AnswerDialog, DetailDialog, InvoiceRow } from './InvoiceRow';
import { useAgencyToday } from './data';
import { Empty, Loading, Unreachable } from './parts';

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
 * Commissions › Factures (EQ-06 lot 8, the chatter's; the manager's own at Moi › Factures): the invoices the agency
 * issues in his name and the credit notes that correct them, the latest first, a year at a time. He accepts or contests
 * each while its delay runs; the payment reads on the document. No due date in colour: that is the agency's to watch.
 */
export function MyInvoicesPage(): JSX.Element {
  const today = useAgencyToday();
  const timeZone = useSchedulingSettings().data?.timeZone ?? null;
  const years = useInvoiceYears({}, today);
  const [opened, setOpened] = useState<Opened | null>(null);

  const documents = years.data?.pages.flatMap((page) => page.documents) ?? [];

  return (
    <Page>
      <PageHeader
        eyebrow="Commissions"
        title="Factures"
        lead="Les factures que l’agence émet en ton nom, et les avoirs qui les corrigent. Tu acceptes ou contestes chacune avant la fin de son délai."
        actions={<CommissionsNav />}
      />
      <div className="py-board">
        <Panel className="nv-enter">
          {years.isError && documents.length === 0 ? (
            <Unreachable
              what="la liste de tes factures"
              onRetry={() => {
                void years.refetch();
              }}
            />
          ) : years.data === undefined || timeZone === null ? (
            <Loading rows={3} />
          ) : documents.length === 0 ? (
            <Empty
              whisper="Aucune facture pour l’instant."
              text="Ta première facture s’émet quand ton premier relevé est validé, une fois ton dossier complet."
            />
          ) : (
            <div className="rp-sec">
              <ul className="iv-list">
                {documents.map((item, index) => (
                  <li key={item.id} className="nv-enter" style={{ '--nv-i': Math.min(index, 8) }}>
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
                  </li>
                ))}
              </ul>
              {years.hasNextPage ? (
                <button
                  type="button"
                  className="nv-btn nv-btn--plain nv-btn--sm iv-more"
                  disabled={years.isFetchingNextPage}
                  aria-busy={years.isFetchingNextPage}
                  onClick={() => {
                    void years.fetchNextPage();
                  }}
                >
                  {years.isFetchingNextPage ? 'Lecture…' : 'Plus anciennes'}
                </button>
              ) : null}
              {years.isError ? (
                <p className="tm-warn" role="alert">
                  Le serveur ne répond pas : les factures plus anciennes n’ont pas pu être lues.
                </p>
              ) : null}
            </div>
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
