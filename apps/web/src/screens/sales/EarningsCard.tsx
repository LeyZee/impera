import {
  EARNINGS_PERIODS,
  type CreatorEarnings,
  type CreatorEarningsLine,
  type CreatorEarningsTotal,
  type EarningsPeriod,
} from '@impera/contracts';
import { useId, useRef, useState, type JSX, type KeyboardEvent } from 'react';

import { useCreatorEarnings } from './api';
import {
  countsOf,
  lineAmount,
  partOf,
  pathOf,
  per100,
  PERIOD_LABELS,
  periodName,
  refundOf,
  SALE_TYPE_WORDS,
  shareText,
  stepAmount,
  stepDay,
} from './earnings-view';
import './earnings.css';

import { clockAt, dayOf } from '@/scheduling/time';
import '@/scheduling/scheduling.css';
import { useNow } from '@/scheduling/useNow';
import { Panel, PanelSection } from '@/shell/layout';
import { Failure, Skeleton, SkeletonCard } from '@/shell/states';

/** Her sales are counted on Reveal's days, in Paris: the same days as her figures on Reveal. */
const SALES_ZONE = 'Europe/Paris';

/** « ven. 20 nov. »: a sale's day, short, so every line's label starts at the same place. */
const SALE_DAY = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: SALES_ZONE,
});
const dayOfSale = (at: string): string => SALE_DAY.format(new Date(at));

const STEPS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * « Ta part » (CR-04, ADR 0157, Charles: « transparence à fond »): what she earns over a day, a fortnight or a month,
 * read from Reveal, with the whole path of her sales (what her fans paid, the VAT, Reveal, the agency, her) and her
 * share, then each sale, whose own path unfolds. Never who sold: the server sends none of it. While the period runs,
 * the amounts are « estimés ».
 */
export function EarningsCard(): JSX.Element {
  const [period, setPeriod] = useState<EarningsPeriod>('day');
  const [day, setDay] = useState<string | null>(null);
  const earnings = useCreatorEarnings(period, day);
  const today = dayOf(useNow(), SALES_ZONE);
  const choose = (next: EarningsPeriod): void => {
    setPeriod(next);
    setDay(null);
  };
  if (earnings.data === undefined && earnings.isError) {
    return (
      <Panel className="vt-earn" title="Ta part">
        <Failure
          inline
          onRetry={() => {
            void earnings.refetch();
          }}
        />
      </Panel>
    );
  }
  if (earnings.data === undefined) {
    // A silent server is said once, on top of the page, by the reads of the fans; this card waits with them.
    return (
      <Skeleton label="Chargement de ta part…">
        <SkeletonCard lines={3} />
      </Skeleton>
    );
  }
  const read = earnings.data;
  return (
    <Panel
      className="vt-earn nv-enter"
      title="Ta part"
      actions={<PeriodChoice period={period} onPick={choose} />}
    >
      <PanelSection>
        <div className="vt-earn__head">
          <div className="sc-week" role="group" aria-label="Période">
            <button
              type="button"
              className="sc-arrow"
              aria-label="Période précédente"
              title="Période précédente"
              onClick={() => {
                setDay(stepDay(read, -1));
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m10 3.5-4.5 4.5 4.5 4.5" />
              </svg>
            </button>
            <p className="sc-week__label nv-swap" key={`${read.period}${read.from}`} aria-live="polite">
              {periodName(read, today)}
            </p>
            <button
              type="button"
              className="sc-arrow"
              aria-label="Période suivante"
              title="Période suivante"
              disabled={read.latest}
              onClick={() => {
                setDay(stepDay(read, 1));
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m6 3.5 4.5 4.5-4.5 4.5" />
              </svg>
            </button>
            {read.latest ? null : (
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm sc-week__back nv-swap"
                onClick={() => {
                  setDay(null);
                }}
              >
                Revenir à aujourd’hui
              </button>
            )}
          </div>
        </div>
        <div className="vt-earn__hero">
          <p className="vt-earn__part nv-num">{partOf(read)}</p>
          {read.totals.length === 1 &&
          read.totals[0] !== undefined &&
          read.totals[0].shareOfNetBp !== null ? (
            <span className="vt-earn__share nv-num">{shareText(read.totals[0].shareOfNetBp)} du net</span>
          ) : null}
        </div>
        <p className="vt-earn__meta">
          {[countsOf(read), read.estimated ? 'estimé, période en cours' : null, 'lu chez Reveal']
            .filter((part) => part !== null)
            .join(' · ')}
        </p>
        {read.totals.map((total) => (
          <Path key={total.currency} total={total} several={read.totals.length > 1} />
        ))}
        <h3 className="nv-eyebrow vt-earn__label">Tes ventes</h3>
        <Lines earnings={read} />
      </PanelSection>
    </Panel>
  );
}

/** Jour, Quinzaine, Mois: one choice, the arrows walking it as a radio group. */
function PeriodChoice({
  period,
  onPick,
}: {
  period: EarningsPeriod;
  onPick: (period: EarningsPeriod) => void;
}): JSX.Element {
  const group = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const at = EARNINGS_PERIODS.indexOf(period);
    const next = EARNINGS_PERIODS[(at + step + EARNINGS_PERIODS.length) % EARNINGS_PERIODS.length];
    if (next === undefined) return;
    group.current?.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus();
    onPick(next);
  };
  return (
    <div
      ref={group}
      className="nv-seg nv-glass nv-glass--thin vt-earn__seg"
      role="radiogroup"
      aria-label="Période"
      style={{
        '--nv-seg-count': EARNINGS_PERIODS.length,
        '--nv-seg-index': EARNINGS_PERIODS.indexOf(period),
      }}
      onKeyDown={onKeyDown}
    >
      <span className="nv-seg__thumb nv-glass nv-glass--thin" aria-hidden="true" />
      {EARNINGS_PERIODS.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          className="nv-seg__opt"
          data-value={value}
          aria-checked={value === period}
          tabIndex={value === period ? 0 : -1}
          onClick={() => {
            onPick(value);
          }}
        >
          {PERIOD_LABELS[value]}
        </button>
      ))}
    </div>
  );
}

/**
 * Where the money of her fans went over the period, in one currency: a bar cut where it went (the VAT and Reveal in the
 * neutral fold, the agency blue, her rose, as on the Dashboard), then each step with its amount, the agency's and hers
 * with their share of the net. The bar is drawn only over money that came in.
 */
function Path({ total, several }: { total: CreatorEarningsTotal; several: boolean }): JSX.Element {
  const steps = pathOf(total);
  const sentence = per100(total);
  const drawn = total.grossInclVatMinor > 0 && steps.every((step) => step.minor >= 0);
  return (
    <section
      className="vt-path"
      aria-label={several ? `Où va l’argent, en ${total.currency}` : 'Où va l’argent'}
    >
      {sentence === null ? null : <p className="vt-path__lead">{sentence}</p>}
      {drawn ? (
        <div className="vt-path__bar" aria-hidden="true">
          {steps.map((step) => (
            <span
              key={step.part}
              className="vt-path__seg"
              data-part={step.part}
              style={{ flexGrow: step.minor }}
            />
          ))}
        </div>
      ) : null}
      <dl className="vt-path__steps">
        <div className="vt-path__row is-paid">
          <dt>Payé par tes fans</dt>
          <dd className="nv-num">{stepAmount(total.grossInclVatMinor, total.currency)}</dd>
        </div>
        {steps.map((step) => (
          <div key={step.part} className="vt-path__row" data-part={step.part}>
            <dt>
              <span className="vt-path__key" aria-hidden="true" />
              {step.label}
              {step.part === 'agency' || step.part === 'creator' ? (
                <span className="vt-path__pct nv-num">
                  {shareText(step.part === 'creator' ? total.shareOfNetBp : total.agencyShareOfNetBp)} du net
                </span>
              ) : null}
            </dt>
            <dd className="nv-num">
              {step.part === 'creator' ? '' : '−'}
              {stepAmount(step.minor, total.currency)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Each sale of the period, the newest first: when, what, the fan when Impera knows him, what he paid and her part. */
function Lines({ earnings }: { earnings: CreatorEarnings }): JSX.Element {
  if (earnings.lines.length === 0) {
    return <p className="vt-earn__none">Aucune vente sur cette période.</p>;
  }
  const many = earnings.period !== 'day';
  return (
    <>
      <ul className={many ? 'vt-earn__lines is-dated' : 'vt-earn__lines'}>
        {earnings.lines.map((line, index) => (
          <Line key={`${line.occurredAt}-${String(index)}`} line={line} dated={many} />
        ))}
      </ul>
      {earnings.linesOmitted === 0 ? null : (
        <p className="vt-earn__none">
          Et {String(earnings.linesOmitted)} ventes plus anciennes, comptées dans ta part.
        </p>
      )}
    </>
  );
}

/** One sale: a press unfolds its own path, its share of the net beside her part. */
function Line({ line, dated }: { line: CreatorEarningsLine; dated: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  const detail = useId();
  const refund = line.event === 'refund';
  const from = refundOf(line, dayOf(line.occurredAt, SALES_ZONE));
  return (
    <li className={refund ? 'vt-earn__line is-refund' : 'vt-earn__line'}>
      <button
        type="button"
        className="vt-earn__row"
        aria-expanded={open}
        aria-controls={detail}
        onClick={() => {
          setOpen((before) => !before);
        }}
      >
        <span className="vt-earn__when nv-num">
          {dated ? `${dayOfSale(line.occurredAt)} · ` : ''}
          {clockAt(line.occurredAt, SALES_ZONE)}
        </span>
        <span className="vt-earn__what">
          <b>{refund ? 'Remboursement' : SALE_TYPE_WORDS[line.saleType]}</b>
          {from === null ? null : <span className="vt-earn__fan">{from}</span>}
          {line.fanName === null ? null : <span className="vt-earn__fan">{line.fanName}</span>}
        </span>
        <span className="vt-earn__paid nv-num">
          {refund ? 'rendu ' : 'payé '}
          {stepAmount(line.grossInclVatMinor, line.currency)}
        </span>
        <span className="vt-earn__amount nv-num">{lineAmount(line)}</span>
        <svg className="vt-earn__chev" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4.5 6 3.5 3.5L11.5 6" />
        </svg>
      </button>
      {open ? (
        <ul id={detail} className="vt-earn__detail nv-swap">
          {pathOf(line).map((step) => (
            <li key={step.part} data-part={step.part}>
              <span className="vt-path__key" aria-hidden="true" />
              {step.label}
              <span className="nv-num">
                {stepAmount(step.minor, line.currency)}
                {step.part === 'creator' && line.shareOfNetBp !== null
                  ? ` · ${shareText(line.shareOfNetBp)} du net`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
