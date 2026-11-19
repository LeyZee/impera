import type { AgencyInsights, AgencyUnit } from '@impera/contracts';
import { placeSegmentThumb } from '@impera/design-system';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import { Chevron } from '../parts';

import {
  compareChoices,
  compareValue,
  neighbours,
  ofUnit,
  periodChoices,
  periodStart,
  UNIT_OPTIONS,
  withCompare,
  type AgencySelection,
} from './period';

import { DayField } from '@/scheduling/DayField';
import { Select } from '@/shell/Select';

const STEPS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** How far back the list under the period's name goes: two years of months, half a year of weeks, two months of days. */
const CHOICES: Readonly<Record<Exclude<AgencyUnit, 'custom'>, number>> = { day: 60, week: 26, month: 24 };

/** Jour, Semaine, Mois, Personnalisé: a segment whose thumb slides; a radio group, one stop in the Tab order. */
function UnitControl({
  unit,
  onChange,
}: {
  unit: AgencyUnit;
  onChange: (unit: AgencyUnit) => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const index = UNIT_OPTIONS.findIndex((one) => one.id === unit);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    placeSegmentThumb(
      element,
      index,
      UNIT_OPTIONS.length,
      placed.current ? (thumbRef.current ?? undefined) : undefined,
    );
    placed.current = true;
  }, [index]);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = UNIT_OPTIONS[(index + step + UNIT_OPTIONS.length) % UNIT_OPTIONS.length];
    if (next === undefined) return;
    ref.current?.querySelector<HTMLButtonElement>(`[data-unit="${next.id}"]`)?.focus();
    onChange(next.id);
  };
  return (
    <div
      className="nv-seg nv-glass nv-glass--thin ins-period"
      role="radiogroup"
      aria-label="Période"
      ref={ref}
      onKeyDown={onKeyDown}
    >
      <span className="nv-seg__thumb nv-glass nv-glass--thin" ref={thumbRef} aria-hidden="true" />
      {UNIT_OPTIONS.map((one) => (
        <button
          key={one.id}
          type="button"
          role="radio"
          className="nv-seg__opt"
          data-unit={one.id}
          aria-label={one.label}
          aria-checked={one.id === unit}
          tabIndex={one.id === unit ? 0 : -1}
          onClick={() => {
            onChange(one.id);
          }}
        >
          {one.short === undefined ? (
            one.label
          ) : (
            <>
              <span className="ins-period__long">{one.label}</span>
              <span className="ins-period__short">{one.short}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}

/** ‹ and ›: the period before and after, the second off on the period running (ADR 0146 § 1). */
function Arrow({
  toward,
  target,
  label,
  onChange,
}: {
  toward: 'previous' | 'next';
  target: AgencySelection | null;
  label: string;
  onChange: (selection: AgencySelection) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="ins-when__arrow"
      data-toward={toward}
      aria-label={label}
      disabled={target === null}
      onClick={() => {
        if (target !== null) onChange(target);
      }}
    >
      <Chevron className="ins-when__chevron" />
    </button>
  );
}

/** The two days of « Personnalisé », typed (never the system's calendar): the period follows once both are days. */
function CustomDays({
  selection,
  today,
  onChange,
}: {
  selection: Extract<AgencySelection, { unit: 'custom' }>;
  today: string;
  onChange: (selection: AgencySelection) => void;
}): JSX.Element {
  const id = useId();
  const [from, setFrom] = useState(selection.from);
  const [to, setTo] = useState(selection.to);
  const wrong = from > to;
  const apply = (nextFrom: string, nextTo: string): void => {
    if (nextFrom !== '' && nextTo !== '' && nextFrom <= nextTo) {
      onChange({ unit: 'custom', from: nextFrom, to: nextTo });
    }
  };
  return (
    <div className="ins-when__days" role="group" aria-label="Jours choisis">
      <label className="ins-when__day-label" htmlFor={`${id}-from`}>
        Du
      </label>
      <DayField
        id={`${id}-from`}
        className="ins-when__day"
        value={from}
        today={today}
        toward="past"
        invalid={wrong}
        describedBy={wrong ? `${id}-wrong` : undefined}
        onChange={(day) => {
          setFrom(day);
          apply(day, to);
        }}
      />
      <label className="ins-when__day-label" htmlFor={`${id}-to`}>
        au
      </label>
      <DayField
        id={`${id}-to`}
        className="ins-when__day"
        value={to}
        today={today}
        toward="past"
        invalid={wrong}
        describedBy={wrong ? `${id}-wrong` : undefined}
        onChange={(day) => {
          setTo(day);
          apply(from, day);
        }}
      />
      {wrong ? (
        <p id={`${id}-wrong`} className="ins-when__wrong" role="alert">
          Le premier jour vient après le dernier.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The days « L'agence en chiffres » reads (ADR 0146): the unit, the period with its arrows and its list, and the
 * comparison. Before the first answer it shows the unit alone: the period's name and its neighbours need the server's
 * days.
 */
export function PeriodBar({
  selection,
  insights,
  onChange,
}: {
  selection: AgencySelection;
  insights: AgencyInsights | null;
  onChange: (selection: AgencySelection) => void;
}): JSX.Element {
  const unit = (
    <UnitControl
      unit={selection.unit}
      onChange={(next) => {
        onChange(ofUnit(next, insights));
      }}
    />
  );
  // The answer on screen may still be the last one while the new days load: never name days it does not hold.
  const shown =
    insights !== null && (insights.span.unit === selection.unit || insights.span.unit === 'rolling')
      ? insights
      : null;
  if (shown === null) return <div className="ins-when">{unit}</div>;
  const today = shown.span.today;
  const around = neighbours(selection, shown);
  const compare = compareChoices(selection, shown.from, today);
  return (
    <div className="ins-when">
      {unit}
      {selection.unit === 'custom' ? (
        // The days chosen replace the name, and the arrows go: a span is typed, not stepped.
        <div className="ins-when__nav nv-glass nv-glass--thin">
          <CustomDays
            key={`${selection.from}:${selection.to}`}
            selection={selection}
            today={today}
            onChange={onChange}
          />
        </div>
      ) : (
        <div className="ins-when__nav nv-glass nv-glass--thin">
          <Arrow toward="previous" target={around.previous} label="Période précédente" onChange={onChange} />
          <Select
            className="ins-when__select"
            ariaLabel="Période lue"
            search="never"
            value={periodStart(selection.unit, shown.from)}
            options={periodChoices(selection.unit, today, CHOICES[selection.unit])}
            onChange={(start) => {
              onChange({ unit: selection.unit, at: start });
            }}
          />
          <Arrow toward="next" target={around.next} label="Période suivante" onChange={onChange} />
        </div>
      )}
      <Select
        className="ins-when__select ins-when__compare"
        ariaLabel="Période comparée"
        search="never"
        value={compareValue(selection)}
        options={compare}
        onChange={(value) => {
          onChange(withCompare(selection, value));
        }}
      />
    </div>
  );
}
