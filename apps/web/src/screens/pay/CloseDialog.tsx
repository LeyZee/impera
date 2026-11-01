import {
  payPeriodLastDay,
  type CommissionStatement,
  type ExchangeRate,
  type PayrollPeriod,
} from '@nirvana/contracts';
import type { JSX } from 'react';

import { rateText } from '@/payroll/model';
import { amountText, followingPeriod, percentText, periodLine, signedAmountText } from '@/reports/model';
import { dayMonth } from '@/scheduling/time';
import { Dialog } from '@/screens/team/Dialog';

/**
 * The first validation of a period closes it for the whole team (ADR 0032): said before, with what it freezes — the
 * reports counted, the dollar's rate, the team's net and goal — and where a report validated after it goes. « Clore et
 * valider » hands the batch to the app's hold, like any validation: five seconds to take it back, then what passed.
 */
export function CloseDialog({
  period,
  batch,
  onConfirm,
  onClose,
}: {
  period: PayrollPeriod;
  batch: readonly CommissionStatement[];
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element {
  const { statements } = period;
  const reports = new Set(statements.flatMap((one) => one.lines.flatMap((line) => line.shiftReportIds))).size;
  const lastDay = payPeriodLastDay(period.period);
  const rate = statements
    .flatMap((one) => one.rules.exchangeRates)
    .filter((one) => one.day <= lastDay)
    .reduce<ExchangeRate | null>((best, one) => (best === null || one.day > best.day ? one : best), null);
  const foreign = statements.some((one) => one.lines.some((line) => line.currency !== 'EUR'));
  const team = statements.find((one) => one.team !== null)?.team ?? null;
  const collective = team?.collective ?? null;
  const net = statements.reduce((sum, one) => sum + one.netMinor, 0);
  const payable = statements.reduce((sum, one) => sum + one.payableMinor, 0);
  const count = batch.length;

  return (
    <Dialog
      className="py-dialog"
      title={`Clore la quinzaine ${periodLine(period.period)} ?`}
      lead={
        count === 1
          ? 'Tu valides un relevé : il clôt la quinzaine pour toute l’équipe.'
          : `Tu valides ${String(count)} relevés. Le premier clôt la quinzaine pour toute l’équipe.`
      }
      onClose={onClose}
    >
      <div className="tm-dialog__body">
        <dl className="py-lines nv-num">
          <div>
            <dt>
              Rapports comptés<small>tous les rapports validés de la quinzaine</small>
            </dt>
            <dd>{reports}</dd>
          </div>
          {foreign && rate !== null ? (
            <div>
              <dt>
                Taux du dollar
                <small>BCE, {dayMonth(rate.day)}, le dernier avant la fin de la quinzaine</small>
              </dt>
              <dd>{rateText(rate.rateMicros, rate.currency)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Net de l’équipe</dt>
            <dd>{amountText(team?.netMinor ?? net, 'EUR')}</dd>
          </div>
          {collective === null ? null : (
            <div>
              <dt>
                Objectif collectif
                <small>
                  {collective.tier === null
                    ? 'aucun palier atteint'
                    : `palier ${percentText(collective.tier.reachedBps)}, ${signedAmountText(collective.tier.bonusMinor, 'EUR')} par chatteur`}
                </small>
              </dt>
              <dd>{percentText(Math.floor(collective.reachedBps / 100) * 100)}</dd>
            </div>
          )}
          <div className="py-lines__pay">
            <dt>À verser</dt>
            <dd>{amountText(payable, 'EUR')}</dd>
          </div>
        </dl>
        <div className="rp-notice">
          <p className="rp-notice__text">
            Un rapport validé après la clôture ira sur la quinzaine{' '}
            {periodLine(followingPeriod(period.period))}, avec les règles de sa quinzaine. Rien de ce qui est
            figé ne change ensuite.
          </p>
        </div>
        <div className="py-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="nv-btn nv-btn--neon" data-autofocus onClick={onConfirm}>
            {count === 1 ? 'Clore et valider le relevé' : `Clore et valider ${String(count)} relevés`}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
