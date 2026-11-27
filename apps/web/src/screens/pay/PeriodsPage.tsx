import type { Me, PayPeriod, PayPeriodSummary } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type JSX } from 'react';

import { PayNav } from './PayNav';
import { useCurrentPeriod } from './data';
import { Chip, Empty, Loading } from './parts';

import { PAYROLL_KEY, PeriodCursorInvalid, usePayPeriods } from '@/payroll/api';
import {
  countsLine,
  dayAt,
  dayMonthText,
  opensOn,
  periodAmount,
  phaseChip,
  phaseOf,
  whoName,
} from '@/payroll/model';
import '@/payroll/pay.css';
import '@/reports/reports.css';
import { amountText, periodTitle } from '@/reports/model';
import '@/scheduling/scheduling.css';
import { useMembers } from '@/screens/team/api';
import { InvoiceArt } from '@/shell/art/EmptyArt';
import '@/screens/team/team.css';
import { Page, PageHeader, Panel } from '@/shell/layout';
import { Failure } from '@/shell/states';

/**
 * Paie › Relevés (EQ-05; « Historique » from 29/10 to 21/11, « Relevés » again everywhere by Charles's choice of 21/11):
 * the periods, the most recent first, each with its state and one amount — what was paid, or
 * what is left to pay — and its net, closing and statements beneath. One opens in Quinzaine.
 */
export function PeriodsPage({
  user,
  period = null,
  onOpen,
}: {
  user: Me;
  /** The quinzaine the other tabs showed, kept for them (GES-02): this screen lists them all. */
  period?: PayPeriod | null;
  onOpen: (period: PayPeriod) => void;
}): JSX.Element {
  const periods = usePayPeriods();
  const current = useCurrentPeriod();
  const members = useMembers();
  const client = useQueryClient();
  const me = { id: user.id, name: user.name };

  // A cursor the server no longer knows: the list reads again from its start, nothing to say.
  const lost = periods.error instanceof PeriodCursorInvalid;
  useEffect(() => {
    if (lost) void client.resetQueries({ queryKey: [...PAYROLL_KEY, 'periods'] });
  }, [lost, client]);

  const items = periods.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Page>
      <PageHeader
        eyebrow="Paie"
        title="Relevés"
        lead="Chaque quinzaine, ce qui a été validé et versé."
        tabs={<PayNav user={user} period={period} />}
      />
      <div className="py-board">
        <Panel className="nv-enter">
          {periods.isError && !lost && items.length === 0 ? (
            <div className="rp-sec">
              <Failure inline onRetry={() => void periods.refetch()} />
            </div>
          ) : periods.data === undefined ? (
            <Loading rows={4} />
          ) : items.length === 0 ? (
            <Empty
              art={<InvoiceArt />}
              whisper="Aucune quinzaine pour l’instant."
              text="Une quinzaine apparaît ici dès qu’un rapport de fin de shift est validé : son relevé se calcule aussitôt."
            />
          ) : (
            <div className="rp-sec">
              <ul className="py-periods">
                {items.map((summary, index) => (
                  <li
                    key={summary.window.period}
                    className="nv-enter"
                    style={{ '--nv-i': Math.min(index, 8) }}
                  >
                    <PeriodRow
                      summary={summary}
                      current={current}
                      closedBy={
                        summary.closedBy === null ? null : whoName(summary.closedBy, me, members.data ?? [])
                      }
                      onOpen={() => {
                        onOpen(summary.window.period);
                      }}
                    />
                  </li>
                ))}
              </ul>
              {periods.hasNextPage ? (
                <button
                  type="button"
                  className="nv-btn nv-btn--plain nv-btn--sm"
                  disabled={periods.isFetchingNextPage}
                  aria-busy={periods.isFetchingNextPage}
                  onClick={() => {
                    void periods.fetchNextPage();
                  }}
                >
                  {periods.isFetchingNextPage ? 'Lecture…' : 'Quinzaines plus anciennes'}
                </button>
              ) : null}
              {periods.isError && !lost && items.length > 0 ? (
                <Failure inline onRetry={() => void periods.fetchNextPage()}>
                  Les quinzaines plus anciennes n’ont pas pu être lues : réessaie dans un instant.
                </Failure>
              ) : null}
            </div>
          )}
        </Panel>
      </div>
    </Page>
  );
}

/** One period: its name, net, closing and statements on the line beneath; its state; one amount. */
function PeriodRow({
  summary,
  current,
  closedBy,
  onOpen,
}: {
  summary: PayPeriodSummary;
  current: PayPeriod | null;
  closedBy: string | null;
  onOpen: () => void;
}): JSX.Element {
  const { window } = summary;
  const amount = periodAmount(summary);
  const net = `${amountText(summary.netMinor, 'EUR')} de net`;
  const counts = countsLine(summary.statements);
  const sub = !summary.ended
    ? [
        window.period === current ? 'En cours' : 'Pas finie',
        `${net} à ce jour`,
        `se valide à partir du ${dayMonthText(opensOn(window))}`,
      ]
    : [
        // Finished but not closed: the pill says it, the line does not repeat it (GES-20).
        summary.closedAt === null
          ? ''
          : `Close le ${dayAt(summary.closedAt, window.timeZone)}${closedBy === null ? '' : ` par ${closedBy}`}`,
        net,
        counts,
        // What is left to pay is said apart from what already went: never one sum of both.
        summary.paidMinor > 0 && phaseOf(summary) !== 'paid'
          ? `déjà versé ${amountText(summary.paidMinor, 'EUR')}`
          : '',
      ];
  return (
    <button type="button" className="py-period nv-tap" onClick={onOpen}>
      <span>
        <span className="py-period__name nv-num">{periodTitle(window.period)}</span>
        <span className="py-period__sub nv-num">{sub.filter((part) => part !== '').join(' · ')}</span>
      </span>
      <Chip chip={phaseChip(summary)} />
      <span className="py-period__amount nv-num">
        {amountText(amount.minor, 'EUR')}
        <small>{amount.what}</small>
      </span>
      <span className="py-period__go" aria-hidden="true" />
    </button>
  );
}
