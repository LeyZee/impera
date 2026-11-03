import type { Calendar, CalendarAgent, PlanningMember } from '@nirvana/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import {
  addMonths,
  agentRowLabel,
  agentSlotLabel,
  calendarRows,
  cellWho,
  cellWords,
  dayWords,
  minutesOn,
  monthLabel,
  monthMarks,
  nameFor,
  type CalendarCell,
  type CalendarRow,
} from './calendar';
import './calendar.css';
import { accountLine, leftOf, phaseOf } from './model';
import { dayNumber, lengthOf, longDay, rangeAt, shortDay, zonedInstant } from './time';

import { Panel } from '@/shell/layout';

/**
 * The team's calendar (CR-12, ADR 0045 § 1, ADR 0048): every creator's créneaux, who is on each and the agent, read
 * only. The week is the grid of Équipe › Planning, one row per creator; the month a dot per créneau, a day opened in
 * detail. Everything the agent does is in its violet and in words; the state of a créneau is said by text or a
 * pattern, never by colour alone.
 */

export interface CalendarProps {
  readonly calendar: Calendar;
  readonly days: readonly string[];
  readonly today: string;
  readonly now: Date;
  /** The reader's own member id: their shifts read « Toi ». */
  readonly me: string | null;
  /** The member whose shifts stand out, picked in the legend. */
  readonly focus: string | null;
  readonly loading: boolean;
  /** The reader can fill a créneau (the agency): one ahead with nobody reads « à pourvoir », in amber. */
  readonly fill?: boolean;
}

/** « NV » for Nora Vidal: which line of a day is whose, on a screen wide enough to say it. */
const initialsOf = (name: string): string =>
  name
    .split(/\s+/u)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');

const membersOf = (calendar: Calendar): Map<string, PlanningMember> =>
  new Map(calendar.members.map((member) => [member.id, member]));

/** The agent's line under a creator's name, in its violet: what mode, what hours. */
function AgentLine({ row }: { row: CalendarRow }): JSX.Element | null {
  return row.agent === null ? null : <AgentLabel agent={row.agent} />;
}

/** The agent of a creator in its violet, by mode and hours: « IA automatique · 9 h – 1 h » (ADR 0048 § 2). */
export function AgentLabel({ agent }: { agent: CalendarAgent }): JSX.Element {
  return (
    <span className="cal-agent" data-mode={agent.mode}>
      <span className="cal-agent__dot" aria-hidden="true" />
      {agentRowLabel(agent)}
    </span>
  );
}

function Slot({
  cell,
  members,
  me,
  focus,
  zone,
  now,
}: {
  cell: CalendarCell;
  members: ReadonlyMap<string, PlanningMember>;
  me: string | null;
  focus: string | null;
  zone: string;
  now: Date;
}): JSX.Element {
  const past = cell.to.getTime() <= now.getTime();
  const hours = rangeAt(cell.from.toISOString(), cell.to.toISOString(), zone);
  return (
    <div
      className="sc-slot cal-slot"
      data-ai={cell.agent === null || cell.aiAlone ? undefined : cell.agent.full ? 'full' : 'part'}
    >
      {/* What a screen reader hears; the marks below say the same to the eye. */}
      <span className="cal-sr">{cellWords(cell, members, me, zone, now)}</span>
      {cell.shifts.map((shift) => {
        const member = members.get(shift.memberId);
        const phase = phaseOf(shift, now);
        // Begun in an earlier créneau: drawn here too, its hours after « … » (ADR 0049 § 1).
        const carried = Date.parse(shift.startsAt) < cell.from.getTime();
        return (
          <div
            key={`${shift.memberId}-${shift.startsAt}`}
            className="sc-chip cal-chip"
            aria-hidden="true"
            data-phase={phase}
            data-carried={carried ? 'true' : undefined}
            data-mine={shift.memberId === me ? 'true' : undefined}
            data-muted={focus !== null && shift.memberId !== focus ? 'true' : undefined}
            style={member === undefined || member.color === null ? undefined : { '--sc-color': member.color }}
          >
            <span className="sc-chip__who">
              <span className="sc-chip__name">{nameFor(member, me)}</span>
            </span>
            <span className="sc-chip__hours nv-num">
              {carried ? '… ' : ''}
              {rangeAt(shift.startsAt, shift.endsAt, zone)}
            </span>
            {phase === 'live' ? <span className="sc-chip__left nv-num">{leftOf(shift, now)}</span> : null}
          </div>
        );
      })}
      {cell.aiAlone ? (
        <span className="cal-alone" aria-hidden="true">
          IA seule
          <span className="cal-hours nv-num">{hours}</span>
        </span>
      ) : cell.shifts.length === 0 ? (
        <span className="cal-free" data-past={past ? 'true' : undefined} aria-hidden="true">
          {past ? null : 'Libre'}
          <span className="cal-hours nv-num">{hours}</span>
        </span>
      ) : null}
      {/* The agent on the whole créneau is a violet edge (the legend says it); on part of it, its hours. */}
      {cell.agent === null || cell.aiAlone || cell.agent.full ? null : (
        <span className="cal-tag nv-num" aria-hidden="true">
          {agentSlotLabel(cell.agent, cell, zone)}
        </span>
      )}
    </div>
  );
}

/** The week: one row per creator, the day cut into the agency's créneaux; one day at a time on a phone. */
export function TeamWeek({ calendar, days, today, now, me, focus, loading }: CalendarProps): JSX.Element {
  const zone = calendar.settings.timeZone;
  const rows = calendarRows(calendar, days, now);
  const members = membersOf(calendar);
  const [picked, setPicked] = useState<number | null>(null);
  const pickedIndex = picked ?? Math.max(0, days.indexOf(today));
  const slotCount = rows[0]?.days.get(days[0] ?? today)?.length ?? 0;
  if (rows.length === 0) {
    return (
      <div className="nv-coming__in sc-notice">
        <h2>Aucune créatrice à afficher</h2>
        <p>Le planning de l’équipe apparaît ici dès qu’une créatrice a un compte.</p>
      </div>
    );
  }
  return (
    <>
      <div className="sc-days" role="radiogroup" aria-label="Jour affiché">
        {days.map((day, index) => (
          <button
            key={day}
            type="button"
            role="radio"
            className="sc-days__one"
            aria-checked={index === pickedIndex}
            data-today={day === today ? 'true' : undefined}
            onClick={() => {
              setPicked(index);
            }}
          >
            <span className="sc-days__name">{shortDay(day).split(' ')[0]}</span>
            <span className="sc-days__num nv-num">{dayNumber(day)}</span>
          </button>
        ))}
      </div>
      <div
        className="sc-grid cal-grid nv-swap"
        key={days[0]}
        role="table"
        aria-label={`Planning de l’équipe, semaine du ${longDay(days[0] ?? today)}`}
        aria-busy={loading}
        data-loading={loading ? 'true' : undefined}
      >
        <div className="sc-grid__row sc-grid__row--head" role="row">
          <span className="sc-grid__corner" role="columnheader">
            Créatrice
          </span>
          {days.map((day, index) => (
            <span
              key={day}
              role="columnheader"
              className="sc-grid__day"
              data-today={day === today ? 'true' : undefined}
              data-picked={index === pickedIndex ? 'true' : undefined}
              data-past={day < today ? 'true' : undefined}
            >
              <span className="sc-grid__dayname">{shortDay(day).split(' ')[0]}</span>
              <span className="sc-grid__daynum nv-num">{dayNumber(day)}</span>
            </span>
          ))}
        </div>
        {rows.map((row, rowIndex) => (
          <div
            key={row.creator.id}
            className="sc-grid__row sc-grid__row--slots nv-enter"
            style={{ '--nv-i': rowIndex, '--sc-slots': slotCount }}
            role="row"
          >
            <span className="sc-grid__account" role="rowheader">
              <span className="sc-grid__creator">{row.creator.name}</span>
              <AgentLine row={row} />
            </span>
            {days.map((day, index) => (
              <div
                key={day}
                className="sc-grid__cell"
                role="cell"
                data-today={day === today ? 'true' : undefined}
                data-picked={index === pickedIndex ? 'true' : undefined}
                data-past={day < today ? 'true' : undefined}
              >
                {(row.days.get(day) ?? []).map((cell) => (
                  <Slot
                    key={cell.from.getTime()}
                    cell={cell}
                    members={members}
                    me={me}
                    focus={focus}
                    zone={zone}
                    now={now}
                  />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * The month: six weeks from the Monday of the 1st, one dot per créneau and creator in each day (the member's colour,
 * the agent's violet ring when it holds it alone, a hollow dot when nobody does); a day touched opens in detail below.
 */
export function TeamMonth({
  calendar,
  days,
  month,
  today,
  now,
  me,
  focus,
  loading,
  fill = false,
}: CalendarProps & { readonly month: string }): JSX.Element {
  const zone = calendar.settings.timeZone;
  const rows = calendarRows(calendar, days, now);
  const members = membersOf(calendar);
  const inMonth = (day: string): boolean => day.startsWith(month);
  const [opened, setOpened] = useState<string | null>(null);
  const shown = opened !== null && days.includes(opened) ? opened : null;
  return (
    <>
      <div
        className="cal-month nv-swap"
        key={month}
        role="table"
        aria-label={`Planning de l’équipe, ${monthLabel(month)}`}
        aria-busy={loading}
        data-loading={loading ? 'true' : undefined}
      >
        <div className="cal-month__head" role="row">
          {days.slice(0, 7).map((day) => (
            <span key={day} role="columnheader" className="cal-month__dayname">
              {shortDay(day).split(' ')[0]}
            </span>
          ))}
        </div>
        {[0, 1, 2, 3, 4, 5].map((week) => (
          <div key={week} className="cal-month__week" role="row">
            {days.slice(week * 7, week * 7 + 7).map((day) => {
              const marks = rows.map((row) => ({ row, marks: monthMarks(row.days.get(day) ?? [], now) }));
              const { said, mine } = dayWords(rows, day, me, now, fill);
              return (
                <div key={day} role="cell" className="cal-month__cell">
                  <button
                    type="button"
                    className="cal-day"
                    aria-label={`${longDay(day)} : ${said}`}
                    aria-pressed={shown === day}
                    data-out={inMonth(day) ? undefined : 'true'}
                    data-today={day === today ? 'true' : undefined}
                    data-past={day < today ? 'true' : undefined}
                    data-mine={mine ? 'true' : undefined}
                    onClick={() => {
                      setOpened(shown === day ? null : day);
                    }}
                  >
                    <span className="cal-day__num nv-num">{dayNumber(day)}</span>
                    <span className="cal-day__marks" aria-hidden="true">
                      {marks.map(({ row, marks: list }) => (
                        <span key={row.creator.id} className="cal-day__line">
                          <span className="cal-day__creator">{initialsOf(row.creator.name)}</span>
                          {list.map((mark, index) =>
                            mark.kind === 'shift' ? (
                              <i
                                key={index}
                                className="cal-mark"
                                data-kind="shift"
                                data-muted={focus !== null && mark.memberId !== focus ? 'true' : undefined}
                                style={{
                                  '--sc-color': members.get(mark.memberId)?.color ?? 'var(--nv-ink-faint)',
                                }}
                              />
                            ) : (
                              <i
                                key={index}
                                className="cal-mark"
                                data-kind={mark.kind}
                                data-ahead={mark.kind === 'gap' && mark.ahead ? 'true' : undefined}
                                data-fill={fill && mark.kind === 'gap' && mark.ahead ? 'true' : undefined}
                              />
                            ),
                          )}
                        </span>
                      ))}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {shown === null ? null : (
        <DayDetail day={shown} rows={rows} members={members} me={me} zone={zone} now={now} />
      )}
    </>
  );
}

/** A day of the month in detail: each creator, each créneau, who is on it and the agent, in words. */
function DayDetail({
  day,
  rows,
  members,
  me,
  zone,
  now,
}: {
  day: string;
  rows: readonly CalendarRow[];
  members: ReadonlyMap<string, PlanningMember>;
  me: string | null;
  zone: string;
  now: Date;
}): JSX.Element {
  return (
    <section className="cal-detail nv-swap" key={day} aria-labelledby="cal-detail-title">
      <h3 id="cal-detail-title" className="cal-detail__title">
        {longDay(day)}
      </h3>
      {rows.map((row) => (
        <div key={row.creator.id} className="cal-detail__creator">
          <p className="cal-detail__name">
            {row.creator.name}
            <AgentLine row={row} />
          </p>
          <ul className="cal-detail__slots">
            {(row.days.get(day) ?? []).map((cell) => (
              <li key={cell.from.getTime()} className="cal-detail__slot">
                <span className="cal-detail__range nv-num">
                  {rangeAt(cell.from.toISOString(), cell.to.toISOString(), zone)}
                </span>
                <span className="cal-detail__who">{cellWho(cell, members, me, zone, now)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/**
 * The legend: each member in their colour, a touch to bring their shifts forward (44 px on a phone), the agent in its
 * violet, and the two patterns of a créneau.
 */
export function CalendarLegend({
  calendar,
  me,
  focus,
  onFocus,
}: {
  calendar: Calendar;
  me: string | null;
  focus: string | null;
  onFocus: (memberId: string | null) => void;
}): JSX.Element {
  const members = calendar.members.toSorted((a, b) =>
    a.id === me ? -1 : b.id === me ? 1 : a.displayName.localeCompare(b.displayName, 'fr'),
  );
  const agent = calendar.agent.some((one) => one.mode !== 'stop');
  return (
    <div className="cal-legend">
      {members.length === 0 ? null : (
        <div className="cal-legend__members" role="group" aria-label="Suivre un membre">
          {members.map((member) => (
            <button
              key={member.id}
              type="button"
              className="cal-legend__member"
              aria-pressed={focus === member.id}
              style={member.color === null ? undefined : { '--sc-color': member.color }}
              onClick={() => {
                onFocus(focus === member.id ? null : member.id);
              }}
            >
              <span className="cal-legend__swatch" aria-hidden="true" />
              {nameFor(member, me)}
            </button>
          ))}
        </div>
      )}
      <p className="cal-legend__keys">
        {agent ? (
          <span className="cal-legend__key">
            <span className="cal-agent__dot" aria-hidden="true" />
            L’IA (heures de réponse de l’agent)
          </span>
        ) : null}
        {agent ? (
          <span className="cal-legend__key">
            <span className="cal-alone cal-alone--key" aria-hidden="true">
              IA seule
            </span>
            Aucun chatteur, l’IA en automatique
          </span>
        ) : null}
        <span className="cal-legend__key">
          <span className="cal-free cal-free--key" aria-hidden="true" />
          Libre
        </span>
      </p>
    </div>
  );
}

/** « Toi : 12 h en novembre », the reader's hours in the month shown, at the agency's hour. */
export function MyMonthHours({
  calendar,
  me,
  month,
}: {
  calendar: Calendar;
  me: string | null;
  month: string;
}): JSX.Element | null {
  if (me === null) return null;
  const zone = calendar.settings.timeZone;
  const minutes = minutesOn(
    calendar.shifts,
    me,
    zonedInstant(`${month}-01`, 0, zone),
    zonedInstant(`${addMonths(month, 1)}-01`, 0, zone),
  );
  return (
    <p className="cal-mine nv-num">
      Toi : {minutes === 0 ? 'aucun shift' : lengthOf(minutes * 60_000)} en {monthLabel(month).split(' ')[0]}
    </p>
  );
}

/** ‹ novembre 2026 › and back to this month. */
export function MonthNav({
  month,
  thisMonth,
  onMonth,
}: {
  month: string;
  thisMonth: string;
  onMonth: (month: string) => void;
}): JSX.Element {
  return (
    <div className="sc-week" role="group" aria-label="Mois">
      <button
        type="button"
        className="sc-arrow"
        aria-label="Mois précédent"
        onClick={() => {
          onMonth(addMonths(month, -1));
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m10 3.5-4.5 4.5 4.5 4.5" />
        </svg>
      </button>
      <p className="sc-week__label cal-month__label nv-swap" key={month} aria-live="polite">
        {monthLabel(month)}
      </p>
      <button
        type="button"
        className="sc-arrow"
        aria-label="Mois suivant"
        onClick={() => {
          onMonth(addMonths(month, 1));
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m6 3.5 4.5 4.5-4.5 4.5" />
        </svg>
      </button>
      {month === thisMonth ? null : (
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm sc-week__back nv-swap"
          onClick={() => {
            onMonth(thisMonth);
          }}
        >
          Ce mois-ci
        </button>
      )}
    </div>
  );
}

/**
 * The team's calendar in its panel, as a Planning shows it: read, failed (said, with a retry), loading, or the week
 * or the month with its legend.
 */
export function TeamPanel({
  calendar,
  failed,
  onRetry,
  days,
  month,
  today,
  now,
  me,
  focus,
  onFocus,
  fill = false,
  creatorId = null,
}: {
  calendar: UseQueryResult<Calendar>;
  /** What the calendar waits on could not be read (the agency's hour, with the planning). */
  failed: boolean;
  onRetry: () => void;
  days: readonly string[];
  /** The month shown (`YYYY-MM`), `null` for the week. */
  month: string | null;
  today: string;
  now: Date;
  me: string | null;
  focus: string | null;
  onFocus: (memberId: string | null) => void;
  /** The agency reads « à pourvoir » where a chatter reads « Libre ». */
  fill?: boolean;
  /** The one creator shown, picked in the filters; `null` for all. */
  creatorId?: string | null;
}): JSX.Element {
  const read = calendar.data;
  const data =
    read === undefined || creatorId === null
      ? read
      : { ...read, creators: read.creators.filter((creator) => creator.id === creatorId) };
  if ((calendar.isError && data === undefined) || failed) {
    return (
      <Panel className="nv-coming">
        <div className="nv-coming__in sc-notice">
          <h2>Le serveur ne répond pas</h2>
          <p>Le planning de l’équipe n’a pas pu être lu. Réessaie dans un instant.</p>
          <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={onRetry}>
            Réessayer
          </button>
        </div>
      </Panel>
    );
  }
  if (data === undefined) {
    return (
      <Panel>
        <div className="sc-skeleton sc-skeleton--grid" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
      </Panel>
    );
  }
  const props = {
    calendar: data,
    days,
    today,
    now,
    me,
    focus,
    fill,
    loading: calendar.isFetching && calendar.isPlaceholderData,
  };
  return (
    <Panel className="sc-grid-panel">
      {month === null ? (
        <TeamWeek {...props} />
      ) : (
        <>
          <div className="cal-month__top">
            <MyMonthHours calendar={data} me={me} month={month} />
          </div>
          <TeamMonth {...props} month={month} />
        </>
      )}
      <CalendarLegend calendar={data} me={me} focus={focus} onFocus={onFocus} />
    </Panel>
  );
}

/** Minutes as the panels say them: « 12 h », « 7 h 30 », « 0 h ». */
const hoursOf = (minutes: number): string => (minutes === 0 ? '0\u00a0h' : lengthOf(minutes * 60_000));

/**
 * What the agency reads beside the calendar (ADR 0045 § 2, ADR 0048 § 3): each member's planned hours over the
 * period shown, and how each account is covered, by a chatter with the agent, a chatter alone, the agent alone or
 * nobody. Every figure is said in words; the bars only repeat them.
 */
export function AgencyLoad({
  calendar,
  period,
  focus,
}: {
  calendar: Calendar;
  /** « cette semaine », « en novembre ». */
  period: string;
  focus: string | null;
}): JSX.Element | null {
  const agency = calendar.agency;
  if (agency === null) return null;
  const members = membersOf(calendar);
  const load = agency.workload.toSorted((a, b) => b.minutes - a.minutes);
  const most = Math.max(1, ...load.map((one) => one.minutes));
  const accounts = new Map(agency.accounts.map((account) => [account.id, account]));
  return (
    <div className="cal-agency">
      <section className="nv-plate cal-load" aria-labelledby="cal-load-title">
        <h2 id="cal-load-title" className="cal-agency__title">
          Charge {period}
        </h2>
        {load.length === 0 ? (
          <p className="cal-agency__empty">Aucun shift planifié.</p>
        ) : (
          <ul className="cal-load__list">
            {load.map((one) => {
              const member = members.get(one.memberId);
              return (
                <li
                  key={one.memberId}
                  className="cal-load__one"
                  data-muted={focus !== null && one.memberId !== focus ? 'true' : undefined}
                  style={
                    member === undefined || member.color === null ? undefined : { '--sc-color': member.color }
                  }
                >
                  <span className="cal-load__name">
                    <span className="cal-legend__swatch" aria-hidden="true" />
                    {member?.displayName ?? 'Un membre'}
                  </span>
                  <span className="cal-load__bar" aria-hidden="true">
                    <i style={{ width: `${String((one.minutes / most) * 100)}%` }} />
                  </span>
                  <span className="cal-load__hours nv-num">{hoursOf(one.minutes)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="nv-plate cal-cover" aria-labelledby="cal-cover-title">
        <h2 id="cal-cover-title" className="cal-agency__title">
          Couverture des comptes {period}
        </h2>
        <ul className="cal-cover__list">
          {agency.coverage.map((one) => {
            const account = accounts.get(one.platformAccountId);
            const total = Math.max(1, one.withAgent + one.chatterAlone + one.agentAlone + one.nobody);
            const parts = [
              { kind: 'both', minutes: one.withAgent, label: 'Chatteur et IA' },
              { kind: 'chatter', minutes: one.chatterAlone, label: 'Chatteur seul' },
              { kind: 'agent', minutes: one.agentAlone, label: 'IA seule' },
              { kind: 'nobody', minutes: one.nobody, label: 'Personne' },
            ];
            return (
              <li key={one.platformAccountId} className="cal-cover__one">
                <p className="cal-cover__name">
                  {account === undefined ? 'Un compte' : `${account.creatorName}, ${accountLine(account)}`}
                </p>
                <span className="cal-cover__bar" aria-hidden="true">
                  {parts.map((part) =>
                    part.minutes === 0 ? null : (
                      <i
                        key={part.kind}
                        data-kind={part.kind}
                        style={{ width: `${String((part.minutes / total) * 100)}%` }}
                      />
                    ),
                  )}
                </span>
                <p className="cal-cover__words">
                  {parts.map((part) => (
                    <span key={part.kind} className="cal-cover__word" data-kind={part.kind}>
                      <i aria-hidden="true" />
                      {part.label} <span className="nv-num">{hoursOf(part.minutes)}</span>
                    </span>
                  ))}
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
