import { EARNINGS_PERIODS, type CreatorEarnings, type EarningsPeriod } from '@impera/contracts';
import { useRef, useState, type JSX, type KeyboardEvent } from 'react';

import { useCreatorEarnings } from './api';
import {
  countsOf,
  lineAmount,
  partOf,
  PERIOD_LABELS,
  periodName,
  SALE_TYPE_WORDS,
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
 * « Ta part » (CR-04, Charles: « elle voit sa part seulement »): what she earns over a day, a fortnight or a month,
 * read from Reveal, and each sale with her part of it. Never what the fan paid, the agency's share nor who sold: the
 * server sends none of it. While the period runs, the amount is « estimé ».
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
        <p className="vt-earn__part nv-num">{partOf(read)}</p>
        <p className="vt-earn__meta">
          {[countsOf(read), read.estimated ? 'estimé, période en cours' : null, 'lu chez Reveal']
            .filter((part) => part !== null)
            .join(' · ')}
        </p>
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

/** Each sale of the period, the newest first: when, what, the fan when Impera knows him, and her part of it. */
function Lines({ earnings }: { earnings: CreatorEarnings }): JSX.Element {
  if (earnings.lines.length === 0) {
    return <p className="vt-earn__none">Aucune vente sur cette période.</p>;
  }
  const many = earnings.period !== 'day';
  return (
    <>
      <ul className={many ? 'vt-earn__lines is-dated' : 'vt-earn__lines'}>
        {earnings.lines.map((line, index) => (
          <li
            key={`${line.occurredAt}-${String(index)}`}
            className={line.event === 'refund' ? 'vt-earn__line is-refund' : 'vt-earn__line'}
          >
            <span className="vt-earn__when nv-num">
              {many ? `${dayOfSale(line.occurredAt)} · ` : ''}
              {clockAt(line.occurredAt, SALES_ZONE)}
            </span>
            <span className="vt-earn__what">
              <b>{line.event === 'refund' ? 'Remboursement' : SALE_TYPE_WORDS[line.saleType]}</b>
              {line.fanName === null ? null : <span className="vt-earn__fan">{line.fanName}</span>}
            </span>
            <span className="vt-earn__amount nv-num">{lineAmount(line)}</span>
          </li>
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
