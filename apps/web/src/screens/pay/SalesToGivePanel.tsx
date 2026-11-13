import { payPeriodLastDay, type PayPeriod } from '@impera/contracts';
import { useState, type JSX } from 'react';

import { SaleCards } from './HeldSalesPanel';
import type { PayNames } from './data';
import { Unreachable } from './parts';

import { useSaleGifts, useSalesToGive } from '@/payroll/api';
import { giftCountText } from '@/payroll/held-sales';
import { myDayTitle } from '@/payroll/my-sales';
import { useSchedulingSettings } from '@/reports/api';
import { addDays } from '@/scheduling/time';
import { Panel } from '@/shell/layout';

/** « novembre », the month of a period's first day, as the owner's count names it. */
const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' });
const monthName = (day: string): string => MONTH.format(new Date(`${day}T12:00:00Z`));

/**
 * Paie › Quinzaine, « Donner une vente » (ADR 0101 §§ 1, 2, 7, 17), for the owner and an active manager on an open
 * period: a chatter who convinced a fan says so to his manager, who finds the sale here by its day, a member's or the
 * agent's, among those where someone else was on shift, and gives it, whole or shared. The day goes back to the
 * period's first and forward to today at most. The owner reads under it how many sales each validator gave this month:
 * a share by reflex is the risk the default « Toute la vente » is there for.
 */
export function SalesToGivePanel({
  period,
  open,
  today,
  names,
  me,
  reads,
  owner,
}: {
  period: PayPeriod;
  /** No closing has closed the period: a sale may still be given there. */
  open: boolean;
  /** Today in the agency's zone. */
  today: string;
  names: PayNames;
  me: { readonly id: string };
  /** The owner or an active manager. */
  reads: boolean;
  owner: boolean;
}): JSX.Element | null {
  const first = period;
  const last = payPeriodLastDay(period) < today ? payPeriodLastDay(period) : today;
  const [day, setDay] = useState(last);
  const shown = open && reads && first <= today;
  const settings = useSchedulingSettings();
  const zone = settings.data?.timeZone ?? null;
  const toGive = useSalesToGive(period, day, shown);
  const gifts = useSaleGifts(period, shown && owner);
  if (!shown || zone === null) return null;

  const read = toGive.data?.day === day && toGive.data.period === period ? toGive.data : undefined;
  const nameOfUser = (userId: string): string => {
    if (userId === me.id) return 'Toi';
    return names.members.find((one) => one.userId === userId)?.displayName ?? 'Un ancien membre';
  };
  const counts = gifts.data?.period === period ? gifts.data.counts : [];

  return (
    <Panel className="nv-enter py-held py-give" eyebrow="Donner une vente">
      <div className="rp-sec">
        <p className="py-quiet">
          Un autre membre a convaincu le fan ? Retrouve la vente par son jour : seules s’affichent celles où
          un autre membre était en poste sur le compte, d’un chatteur ou de l’IA.
        </p>
        <div className="py-give__day" role="group" aria-label="Jour de la vente">
          <button
            type="button"
            className="sc-arrow"
            aria-label="Jour précédent"
            title="Jour précédent"
            disabled={day <= first}
            onClick={() => {
              setDay(addDays(day, -1));
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m10 3.5-4.5 4.5 4.5 4.5" />
            </svg>
          </button>
          <span className="py-give__label nv-num" aria-live="polite">
            {day === today ? 'Aujourd’hui · ' : ''}
            {myDayTitle(day)}
          </span>
          <button
            type="button"
            className="sc-arrow"
            aria-label="Jour suivant"
            title="Jour suivant"
            disabled={day >= last}
            onClick={() => {
              setDay(addDays(day, 1));
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m6 3.5 4.5 4.5-4.5 4.5" />
            </svg>
          </button>
        </div>
        {read === undefined ? (
          toGive.isError ? (
            <Unreachable
              what="les ventes de ce jour"
              onRetry={() => {
                void toGive.refetch();
              }}
            />
          ) : (
            <p className="py-quiet" aria-busy="true">
              Lecture des ventes…
            </p>
          )
        ) : read.sales.length === 0 ? (
          <p className="py-quiet">Aucune vente ce jour où un autre membre était en poste sur le compte.</p>
        ) : (
          <SaleCards period={period} sales={read.sales} names={names} me={me} zone={zone} />
        )}
        {!owner || counts.length === 0 ? null : (
          <div className="py-give__watch">
            <p className="py-give__watch-head">Ventes données en {monthName(period)}</p>
            <ul className="py-give__counts nv-num">
              {counts.map((count) => (
                <li key={count.decidedBy}>{giftCountText(count, nameOfUser)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}
