import type { PayPeriod, ShiftReportList, ShiftReportStatus } from '@nirvana/contracts';
import type { JSX } from 'react';

import { useReports, useSchedulingSettings } from './api';
import {
  amountText,
  linesOf,
  MEMBER_STATUS,
  mergeLists,
  periodAt,
  periodLine,
  periodSums,
  previousPeriod,
  STATUS_TONES,
  toDoOf,
  type ShiftLine,
} from './model';

import { swapShiftLine } from '@/scheduling/model';
import { readerZone } from '@/scheduling/time';
import { Panel } from '@/shell/layout';

/** What the member's reports read: the period running in the agency's zone, and the one before for a late report. */
export interface MyReports {
  readonly period: PayPeriod | null;
  readonly list: ShiftReportList | undefined;
  readonly isError: boolean;
  readonly refetch: () => void;
}

export function useMyReports(now: Date): MyReports {
  const settings = useSchedulingSettings();
  const period = settings.data === undefined ? null : periodAt(now, settings.data.timeZone);
  const current = useReports(period ?? null, period !== null);
  const before = useReports(period === null ? null : previousPeriod(period), period !== null);
  const list =
    current.data === undefined || before.data === undefined
      ? undefined
      : mergeLists([current.data, before.data]);
  return {
    period,
    list,
    isError: settings.isError || current.isError || before.isError,
    refetch: () => {
      void settings.refetch();
      void current.refetch();
      void before.refetch();
    },
  };
}

/**
 * Aujourd'hui's « Mes rapports » (EQ-03): what is left to do first, a report to make or one sent back, then the
 * period's figures and, folded, each report of it. The hero's own shift is left to the hero's button.
 */
export function MyReportsCard({
  reports,
  heroShiftId,
  onOpen,
}: {
  reports: MyReports;
  heroShiftId: string | null;
  onOpen: (shiftId: string) => void;
}): JSX.Element | null {
  const { list, period } = reports;
  const zone = readerZone();
  if (reports.isError) {
    return (
      <Panel className="rp-mine nv-enter" eyebrow="Mes rapports">
        <div className="rp-sec">
          <div className="sc-empty">
            <p className="tm-warn">Le serveur ne répond pas : tes rapports n’ont pas pu être lus.</p>
            <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={reports.refetch}>
              Réessayer
            </button>
          </div>
        </div>
      </Panel>
    );
  }
  if (list === undefined || period === null) {
    return (
      <Panel className="rp-mine">
        <div className="sc-skeleton sc-skeleton--short" aria-hidden="true">
          <i />
          <i />
        </div>
      </Panel>
    );
  }
  const accounts = new Map(list.accounts.map((account) => [account.id, account]));
  const toDo = toDoOf(list).filter((one) => one.shift.id !== heroShiftId);
  const ofPeriod = list.reports.filter((one) => one.period === period);
  const sums = periodSums(ofPeriod);
  const lines = linesOf(list).filter((line) => line.report !== null && line.report.period === period);
  // The folded list is shift by shift: its summary counts the reports, a correction waiting is said on its line.
  const made = ofPeriod.filter((one) => one.correctsId === null);
  const count = (status: ShiftReportStatus): number => made.filter((one) => one.status === status).length;
  const validated = count('validated');
  const waiting = count('submitted');
  const sentBack = count('rejected');

  return (
    <Panel className="rp-mine nv-enter" eyebrow={`Mes rapports · quinzaine ${periodLine(period)}`}>
      <div className="rp-sec">
        {toDo.length === 0 ? null : (
          <ul className="rp-todo">
            {toDo.map(({ shift, report }, index) => {
              const account = accounts.get(shift.platformAccountId);
              return (
                <li key={shift.id} className="nv-enter" style={{ '--nv-i': index }}>
                  <button
                    type="button"
                    className="rp-todo__one nv-tap"
                    data-tone={report === null ? 'due' : 'warn'}
                    onClick={() => {
                      onOpen(shift.id);
                    }}
                  >
                    <span className="rp-todo__mark" aria-hidden="true" />
                    <span className="rp-todo__text">
                      <span className="rp-todo__title">
                        {report === null ? 'Rapport à faire' : 'Rapport renvoyé par l’agence'}
                      </span>
                      <span className="rp-todo__sub nv-num">
                        {swapShiftLine(shift.startsAt, shift.endsAt, account?.creatorName, zone)}
                      </span>
                      {(report?.reviewNote ?? null) === null ? null : (
                        <span className="rp-todo__note">« {report?.reviewNote} »</span>
                      )}
                    </span>
                    <span className="rp-todo__go">{report === null ? 'Faire' : 'Reprendre'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {sums.length === 0 ? (
          toDo.length === 0 ? (
            <p className="rp-mine__empty">
              Pas encore de rapport cette quinzaine. Il se fait d’ici, à la fin de chaque shift.
            </p>
          ) : null
        ) : (
          <div className="rp-figures">
            {sums.map((sum) => (
              <div key={sum.currency} className="rp-figures__row">
                {/* No report validated yet in this currency: no « Validé 0,00 $US » that reads as one at zero. */}
                {sum.validated === 0 && sum.waiting + sum.sentBack > 0 ? null : (
                  <div className="rp-figures__one">
                    <span className="rp-figures__label">Validé</span>
                    <span className="rp-figures__value nv-num">
                      {amountText(sum.validatedMinor, sum.currency)}
                    </span>
                  </div>
                )}
                {sum.waiting === 0 ? null : (
                  <div className="rp-figures__one">
                    <span className="rp-figures__label">En attente</span>
                    <span className="rp-figures__value rp-figures__value--quiet nv-num">
                      {amountText(sum.waitingMinor, sum.currency)}
                    </span>
                  </div>
                )}
                {sum.sentBack === 0 ? null : (
                  <div className="rp-figures__one">
                    <span className="rp-figures__label">Renvoyé</span>
                    <span className="rp-figures__value rp-figures__value--warn nv-num">
                      {amountText(sum.sentBackMinor, sum.currency)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {lines.length === 0 ? null : (
          <details className="nv-disclosure rp-mine__all">
            <summary>
              <span className="nv-disclosure__title">Tous mes rapports</span>
              <span className="nv-disclosure__sum">
                {[
                  validated === 0 ? null : `${String(validated)} validé${validated > 1 ? 's' : ''}`,
                  waiting === 0 ? null : `${String(waiting)} en attente`,
                  sentBack === 0 ? null : `${String(sentBack)} renvoyé${sentBack > 1 ? 's' : ''}`,
                ]
                  .filter((part) => part !== null)
                  .join(' · ')}
              </span>
            </summary>
            <ul className="nv-disclosure__body rp-lines">
              {lines.map((line) => (
                <MyLine
                  key={line.shift.id}
                  line={line}
                  creatorName={accounts.get(line.shift.platformAccountId)?.creatorName}
                  zone={zone}
                  onOpen={onOpen}
                />
              ))}
            </ul>
          </details>
        )}
      </div>
    </Panel>
  );
}

function MyLine({
  line,
  creatorName,
  zone,
  onOpen,
}: {
  line: ShiftLine;
  creatorName: string | undefined;
  zone: string;
  onOpen: (shiftId: string) => void;
}): JSX.Element | null {
  const { report } = line;
  if (report === null) return null;
  const pending = line.corrections.some((one) => one.status !== 'validated');
  return (
    <li>
      <button
        type="button"
        className="rp-line nv-tap"
        onClick={() => {
          onOpen(line.shift.id);
        }}
      >
        <span className="rp-line__when nv-num">
          {swapShiftLine(line.shift.startsAt, line.shift.endsAt, creatorName, zone)}
        </span>
        <span className="rp-line__amount nv-num">
          {amountText(
            report.status === 'validated' ? line.validatedMinor : report.amount.amountMinor,
            report.amount.currency,
          )}
        </span>
        <span className={`rp-chip rp-chip--${STATUS_TONES[report.status]}`}>
          {MEMBER_STATUS[report.status]}
          {pending ? ' · correction en attente' : ''}
        </span>
      </button>
    </li>
  );
}
