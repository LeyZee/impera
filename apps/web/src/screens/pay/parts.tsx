import type { CollectiveTier, CommissionStatement, PayPeriod } from '@nirvana/contracts';
import type { JSX } from 'react';

import type { PayNames } from './data';

import {
  dayMonthText,
  flowOf,
  gaugePercent,
  goalTiersInOrder,
  signedPercentText,
  tickAmountText,
  totalsOf,
  type PayChip,
} from '@/payroll/model';
import { followingPeriod, percentText, periodTitle, previousPeriod } from '@/reports/model';
import { accountLine } from '@/scheduling/model';

/** The pieces Paie's screens and Commissions share (EQ-05). */

export function Chip({ chip, title }: { chip: PayChip; title?: string | undefined }): JSX.Element {
  return (
    <span className={`rp-chip rp-chip--${chip.tone}`} title={title}>
      {chip.label}
    </span>
  );
}

/** A member's colour, or the swatch's own grey. */
export function Swatch({ color }: { color: string | null }): JSX.Element {
  return (
    <span
      className="sc-swatch"
      style={color === null ? undefined : { '--sc-color': color }}
      aria-hidden="true"
    />
  );
}

/** A change against the previous period, better or worse; « nouveau » when there is nothing to compare with. */
export function Delta({ bps, title }: { bps: number | null; title: string }): JSX.Element {
  if (bps === null)
    return (
      <span className="nv-delta" title={title}>
        nouveau
      </span>
    );
  return (
    <span className={`nv-delta nv-delta--${bps >= 0 ? 'better' : 'worse'}`} title={title}>
      {signedPercentText(Math.round(bps / 100) * 100)}
    </span>
  );
}

/** A gauge of the goal: how far the team is, and where the forecast puts it; the neon where it is the screen's one. */
export function Gauge({
  value,
  mark,
  neon = false,
}: {
  value: number;
  mark: number | null;
  neon?: boolean;
}): JSX.Element {
  return (
    <div
      className={neon ? 'nv-gauge nv-gauge--neon' : 'nv-gauge'}
      style={{
        '--nv-gauge-value': `${String(value)}%`,
        ...(mark === null ? {} : { '--nv-gauge-mark': `${String(mark)}%` }),
      }}
    >
      <span className="nv-gauge__fill" />
      {mark === null ? null : <span className="nv-gauge__mark" title="Prévision de fin" />}
    </div>
  );
}

/** A goal's tiers under its gauge, each at its share of the span, lit once reached; `title` says each on hover. */
export function GoalTicks({
  tiers,
  span,
  reached,
  title,
}: {
  tiers: readonly CollectiveTier[];
  span: number;
  reached: number | null;
  title: (tier: CollectiveTier) => string;
}): JSX.Element {
  return (
    <ul className="py-ticks nv-num" aria-label="Paliers">
      {goalTiersInOrder(tiers).map((one) => (
        <li
          key={one.reachedBps}
          style={{ '--py-at': `${String(gaugePercent(one.reachedBps, span))}%` }}
          data-reached={reached !== null && reached >= one.reachedBps ? 'true' : undefined}
          title={title(one)}
        >
          {percentText(one.reachedBps)}
          <span>{tickAmountText(one.bonusMinor)}</span>
        </li>
      ))}
    </ul>
  );
}

export function LockIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
    </svg>
  );
}

/**
 * A page's title when it shows one period (Quinzaine, Primes et malus, Objectifs): the period itself, the screen's main
 * fact. Its arrows go in the page's actions, out of the heading, so the heading's name is the period alone.
 */
export function PeriodHeading({ period }: { period: PayPeriod }): JSX.Element {
  return (
    <span className="nv-swap nv-num" key={period} aria-live="polite">
      {periodTitle(period)}
    </span>
  );
}

/** The previous and next period around `period`; never past the one under way. */
export function PeriodArrows({
  period,
  current,
  onPeriod,
}: {
  period: PayPeriod;
  current: PayPeriod | null;
  onPeriod: (period: PayPeriod) => void;
}): JSX.Element {
  return (
    <span className="sc-week" role="group" aria-label="Quinzaine">
      <button
        type="button"
        className="sc-arrow"
        aria-label="Quinzaine précédente"
        onClick={() => {
          onPeriod(previousPeriod(period));
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m10 3.5-4.5 4.5 4.5 4.5" />
        </svg>
      </button>
      <button
        type="button"
        className="sc-arrow"
        aria-label="Quinzaine suivante"
        disabled={current !== null && period >= current}
        onClick={() => {
          onPeriod(followingPeriod(period));
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m6 3.5 4.5 4.5-4.5 4.5" />
        </svg>
      </button>
    </span>
  );
}

/** A plate's shapes while it loads. */
export function Loading({ rows = 3 }: { rows?: number }): JSX.Element {
  return (
    <div className="py-skel" aria-hidden="true">
      <i style={{ '--py-w': '38%', '--py-h': '14px' }} />
      {Array.from({ length: rows }, (_, index) => (
        <i key={index} style={{ '--py-h': '52px' }} />
      ))}
    </div>
  );
}

/** A server that does not answer: said, with a retry, never an empty state that would lie. */
export function Unreachable({ what, onRetry }: { what: string; onRetry: () => void }): JSX.Element {
  return (
    <div className="rp-sec">
      <div className="sc-empty">
        <p className="tm-warn">Le serveur ne répond pas : {what} n’a pas pu être lue.</p>
        <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={onRetry}>
          Réessayer
        </button>
      </div>
    </div>
  );
}

export function Empty({ whisper, text }: { whisper: string; text: string }): JSX.Element {
  return (
    <div className="py-empty">
      <p className="py-empty__whisper">{whisper}</p>
      <p className="py-empty__text">{text}</p>
    </div>
  );
}

/** From the sales of each account to what is paid: the path of the money of a statement, as the engine computed it. */
export function MoneyPath({
  statement,
  names,
  you,
  payLabel,
}: {
  statement: CommissionStatement;
  names: Pick<PayNames, 'account'>;
  you: boolean;
  /** The name of what is paid, as the screen's hero says it, so that one amount has one name. */
  payLabel?: string;
}): JSX.Element {
  return (
    <>
      {statement.lines.length === 0 ? null : (
        <ul className="py-accounts">
          {statement.lines.map((line) => {
            const account = names.account(line.platformAccountId);
            const count = line.shiftReportIds.length;
            const rate = statement.rules.exchangeRates.find((one) => one.currency === line.currency);
            const steps = flowOf(line, statement.rules.commissionRateBps, account?.platform ?? null, you);
            return (
              <li key={line.platformAccountId} className="py-account">
                <p className="py-account__head">
                  <span className="py-account__name">{account?.creatorName ?? 'Un compte'}</span>
                  <span className="py-account__where">
                    {account === null ? '' : `${accountLine(account)} · `}
                    {count} rapport{count > 1 ? 's' : ''} de fin de shift
                    {line.lateReports.length === 0
                      ? ''
                      : `, dont ${String(line.lateReports.length)} validé${line.lateReports.length > 1 ? 's' : ''} après la clôture d’avant`}
                  </span>
                </p>
                <ol className="py-flow">
                  {steps.map((step, index) => (
                    <li key={step.label} className={index === steps.length - 1 ? 'py-flow__end' : undefined}>
                      <span className="py-flow__label">{step.label}</span>
                      <span
                        className="py-flow__op nv-num"
                        title={
                          step.label === 'En euros' && rate !== undefined
                            ? `Taux de référence de la BCE du ${dayMonthText(rate.day)}`
                            : undefined
                        }
                      >
                        {step.op}
                      </span>
                      <span className="py-flow__amount nv-num">{step.amount}</span>
                    </li>
                  ))}
                </ol>
              </li>
            );
          })}
        </ul>
      )}
      <dl className="py-lines nv-num">
        {totalsOf(statement, you, payLabel).map((row, index) => (
          <div
            key={`${row.label}-${String(index)}`}
            className={row.kind === 'line' ? undefined : `py-lines__${row.kind}`}
          >
            <dt>
              {row.kind === 'carry' ? <span>{row.label}</span> : row.label}
              {row.note === null ? null : <small>{row.note}</small>}
            </dt>
            <dd>{row.amount}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
