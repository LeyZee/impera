import type { OnDuty, Planning, ShiftReportList, ShiftTemplate, TeamMember } from '@nirvana/contracts';
import { useMemo, useRef, useState, type JSX } from 'react';

import { ShiftPanel, type ShiftStart } from './ShiftPanel';
import { ShiftSheet } from './ShiftSheet';
import { OnLeave, PendingLeaves, TeamSwaps, type InTheWay } from './TeamExchanges';
import { TeamNav } from './TeamNav';
import { useMembers } from './api';
import { Unread } from './parts';
import './team.css';

import { useReportsOf } from '@/reports/api';
import { incidentsOf, periodAt } from '@/reports/model';
import { WeekNav } from '@/scheduling/WeekNav';
import { useLeaves, usePlanning, useOnDuty, useSwaps, useTemplates } from '@/scheduling/api';
import '@/scheduling/exchanges.css';
import {
  accountLine,
  conflictLines,
  conflictTitle,
  gridOf,
  phaseOf,
  slotRowOf,
  type Chip,
  type Fill,
  type GridRow,
  type SlotCell,
} from '@/scheduling/model';
import '@/scheduling/scheduling.css';
import {
  addDays,
  cityOf,
  clockAt,
  dayOf,
  lengthOf,
  longDay,
  minuteOf,
  mondayOf,
  rangeAt,
  readerZone,
  shortDay,
  dayNumber,
  weekOf,
  zonedInstant,
} from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { Page, PageHeader, Panel } from '@/shell/layout';

type Open =
  { readonly kind: 'add'; readonly start: ShiftStart } | { readonly kind: 'shift'; readonly id: string };

const NONE: ReadonlySet<string> = new Set();
const NO_INCIDENTS: ReadonlyMap<string, readonly string[]> = new Map();

/**
 * The leaves read for the page: from the week shown, or this week when it is earlier, over a year less a day, so that
 * every request still to decide is there whatever the week.
 */
function leaveRangeOf(monday: string, thisMonday: string, zone: string): { from: string; to: string } {
  const start =
    monday < thisMonday
      ? monday
      : addDays(monday, 7) > addDays(thisMonday, 365)
        ? addDays(monday, 7 - 365)
        : thisMonday;
  return {
    from: zonedInstant(start, 0, zone).toISOString(),
    to: zonedInstant(addDays(start, 365), 0, zone).toISOString(),
  };
}

/**
 * Équipe › Planning (EQ-02, ADR 0024): the week as rows of accounts and columns of days, each shift on its member's
 * colour, each day cut into the agency's créneaux so that an empty one ahead reads « À pourvoir » (EQ-01); who is on
 * shift right now and who is away on one row above it, and the weekly shifts the server could not place in amber. Read at the
 * agency's hour, the one the team speaks in, or at the reader's own. The owner and an active manager place, move and
 * stop shifts; the server checks every write. The leaves and the chatters' swaps sit around it (ADR 0031): requests to
 * decide first, who is away this week, a shift to fill when its member is on leave, the swaps folded below.
 */
export function PlanningPage({
  userId,
  week,
  member = null,
  onWeek,
  onMember = () => undefined,
}: {
  userId: string;
  /** The Monday of the week in the address (`?semaine=`), `null` for this week. */
  week: string | null;
  /** The member whose shifts stand out (`?membre=`), from « Ses shifts » on his record (EQ-11). */
  member?: string | null;
  /** Writes the week shown into the address, `null` for this week. */
  onWeek: (monday: string | null) => void;
  onMember?: (memberId: string | null) => void;
}): JSX.Element {
  const now = useNow();
  const mine = readerZone();
  const [own, setOwn] = useState(false);
  const [creatorId, setCreatorId] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  // The agency's zone comes with the first planning read; until then the week is the reader's own.
  const [agency, setAgency] = useState<string | null>(null);
  const zone = own || agency === null ? mine : agency;
  const today = dayOf(now, zone);
  const thisMonday = mondayOf(today);
  const monday = week ?? thisMonday;
  const setMonday = (next: string): void => {
    onWeek(next === thisMonday ? null : next);
  };
  const days = weekOf(monday);
  const shown = usePlanning(rangeOf(monday, zone));
  const members = useMembers();
  const toolbar = useRef<HTMLDivElement>(null);
  const templates = useTemplates(true);
  const onDuty = useOnDuty(true);
  const leaves = useLeaves(leaveRangeOf(monday, thisMonday, zone));
  const swaps = useSwaps();
  // Shifts a leave's approval found in its way: lit on the grid, from week to week, while that leave waits.
  const [lit, setLit] = useState<InTheWay | null>(null);
  const ownMemberId = members.data?.find((member) => member.userId === userId)?.id ?? null;
  const flagged = useMemo(
    () =>
      lit !== null &&
      (leaves.data?.leaveRequests.some((leave) => leave.id === lit.leaveId && leave.status === 'pending') ??
        false)
        ? new Set(lit.shiftIds)
        : NONE,
    [lit, leaves.data],
  );
  const data = shown.data;
  if (data !== undefined && data.settings.timeZone !== agency) setAgency(data.settings.timeZone);
  // The reports of the week's shifts, read by their periods (one or two): an incident marks its shift (EQ-03).
  const periods = useMemo(
    () =>
      data === undefined
        ? []
        : [
            ...new Set(
              data.shifts.map((shift) => periodAt(new Date(shift.startsAt), data.settings.timeZone)),
            ),
          ].toSorted(),
    [data],
  );
  const reports = useReportsOf(periods).list;
  const incidents = useMemo(
    () => (reports === null ? NO_INCIDENTS : incidentsOf(reports.reports)),
    [reports],
  );
  const pickedIndex = picked ?? Math.max(0, days.indexOf(today));

  const add = (
    <button
      type="button"
      className="nv-btn nv-btn--neon"
      disabled={data?.accounts.length === 0}
      onClick={() => {
        setOpen({ kind: 'add', start: { accountId: null, day: days[pickedIndex] ?? today } });
      }}
    >
      Ajouter un shift
    </button>
  );

  return (
    <Page>
      <PageHeader
        title="Équipe"
        lead={
          agency === null
            ? 'Qui chatte sur quel compte, et quand.'
            : `Qui chatte sur quel compte, et quand. À l’heure ${zone === agency ? `de l’agence (${cityOf(agency)})` : `de ${cityOf(zone)}`}.`
        }
        actions={
          <>
            <TeamNav />
            {/* No button above a page that could not be read: it would only be greyed out (EQ-22). */}
            {data === undefined ? null : add}
          </>
        }
      />
      {shown.isError && data === undefined ? (
        <Unread
          text="Le serveur ne répond pas : le planning n’a pas pu être lu."
          onRetry={() => {
            void shown.refetch();
          }}
        />
      ) : data === undefined ? (
        <Panel>
          <div className="sc-skeleton sc-skeleton--grid" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
        </Panel>
      ) : (
        <div className="sc-board">
          <div className="sc-toolbar" ref={toolbar}>
            <WeekNav
              monday={monday}
              thisMonday={thisMonday}
              onMonday={(next) => {
                setMonday(next);
                setPicked(next === thisMonday ? null : 0);
              }}
            />
            {member === null ? null : (
              <Focus
                planning={data}
                memberId={member}
                name={members.data?.find((one) => one.id === member)?.displayName ?? null}
                onClear={() => {
                  onMember(null);
                  // The button goes with the band: the focus lands on the week, which stays.
                  toolbar.current?.querySelector<HTMLElement>('.sc-arrow')?.focus();
                }}
              />
            )}
            <Filters
              planning={data}
              creatorId={creatorId}
              onCreator={setCreatorId}
              agency={data.settings.timeZone}
              mine={mine}
              own={own}
              onOwn={setOwn}
            />
          </div>
          {leaves.data === undefined ? null : (
            <PendingLeaves
              list={leaves.data}
              ownMemberId={ownMemberId}
              zone={zone}
              onShowShifts={(inTheWay) => {
                // The week and the day of the first shift in the way, every creator shown, so that it is in sight.
                const first = dayOf(inTheWay.at, zone);
                const week = mondayOf(first);
                setMonday(week);
                setPicked(weekOf(week).indexOf(first));
                setCreatorId(null);
                setLit(inTheWay);
              }}
            />
          )}
          {/* Who is on shift and who is away, one row of names: the grid comes up the page (EQ-02). */}
          <div className="sc-people">
            <OnDutyStrip
              list={onDuty.data ?? null}
              planning={data}
              zone={zone}
              onShow={(id) => {
                setOpen({ kind: 'shift', id });
              }}
            />
            {leaves.data === undefined ? null : (
              <OnLeave list={leaves.data} from={days[0] ?? monday} to={days[6] ?? monday} now={now} />
            )}
          </div>
          <Conflicts
            planning={data}
            templates={templates.data ?? []}
            zone={zone}
            onShow={(id) => {
              setOpen({ kind: 'shift', id });
            }}
            onFill={(fill) => {
              setOpen({ kind: 'add', start: { accountId: fill.accountId, day: fill.day, fill } });
            }}
          />
          <Grid
            planning={data}
            rows={gridOf(data, days, zone).filter(
              (row) => creatorId === null || row.account.creatorId === creatorId,
            )}
            days={days}
            today={today}
            picked={pickedIndex}
            onPick={setPicked}
            now={now}
            zone={zone}
            loading={shown.isFetching && shown.isPlaceholderData}
            focus={member}
            flagged={flagged}
            incidents={incidents}
            onAdd={(start) => {
              setOpen({ kind: 'add', start });
            }}
            onShow={(id) => {
              setOpen({ kind: 'shift', id });
            }}
          />
          {swaps.data === undefined ? null : <TeamSwaps list={swaps.data} now={now} zone={zone} />}
        </div>
      )}
      {data === undefined || open === null ? null : (
        <Opened
          open={open}
          planning={data}
          members={members.data ?? null}
          templates={templates.data ?? []}
          zone={zone}
          now={now}
          reports={reports}
          onOpen={setOpen}
        />
      )}
    </Page>
  );
}

/** Monday 0 h to the next Monday 0 h, in `zone`. */
function rangeOf(monday: string, zone: string): { from: string; to: string; creatorId: null } {
  return {
    from: zonedInstant(monday, 0, zone).toISOString(),
    to: zonedInstant(addDays(monday, 7), 0, zone).toISOString(),
    creatorId: null,
  };
}

function Opened({
  open,
  planning,
  members,
  templates,
  zone,
  now,
  reports,
  onOpen,
}: {
  open: Open;
  planning: Planning;
  /** `null` while the team is not read, or could not be. */
  members: readonly TeamMember[] | null;
  templates: readonly ShiftTemplate[];
  zone: string;
  now: Date;
  /** The week's reports, `null` while they are not read. */
  reports: ShiftReportList | null;
  onOpen: (open: Open | null) => void;
}): JSX.Element | null {
  const close = (): void => {
    onOpen(null);
  };
  if (open.kind === 'add') {
    return (
      <ShiftPanel
        planning={planning}
        members={members}
        start={open.start}
        today={dayOf(now, planning.settings.timeZone)}
        onClose={close}
        onShowShift={(id) => {
          onOpen({ kind: 'shift', id });
        }}
      />
    );
  }
  const shift = planning.shifts.find((one) => one.id === open.id);
  if (shift === undefined) return null;
  return (
    <ShiftSheet
      key={shift.id}
      shift={shift}
      planning={planning}
      members={members ?? []}
      templates={templates}
      zone={zone}
      now={now}
      reports={reports === null ? null : reports.reports.filter((one) => one.shiftId === shift.id)}
      onClose={close}
    />
  );
}

/**
 * « Ses shifts », from a member's record (EQ-11): his shifts of the week stand out, the others are dimmed, and the
 * whole team comes back in one tap. He is named from the team, since the planning names only those with a shift or a
 * template in the week read. A landmark, not an announcement.
 */
function Focus({
  planning,
  memberId,
  name: teamName,
  onClear,
}: {
  planning: Planning;
  memberId: string;
  name: string | null;
  onClear: () => void;
}): JSX.Element {
  const name = teamName ?? planning.members.find((one) => one.id === memberId)?.displayName ?? 'Ce membre';
  const his = planning.shifts.filter((shift) => shift.memberId === memberId);
  const total = his.reduce(
    (sum, shift) => sum + new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime(),
    0,
  );
  const count = his.length === 1 ? '1 shift' : `${String(his.length)} shifts`;
  return (
    <p className="sc-focus nv-swap">
      <span className="sc-focus__text">
        <b>{name}</b>
        <span className="nv-num">
          {' '}
          · {his.length === 0 ? 'aucun shift cette semaine' : `${count} · ${lengthOf(total)}`}
        </span>
      </span>
      <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" onClick={onClear}>
        Toute l’équipe
      </button>
    </p>
  );
}

function Filters({
  planning,
  creatorId,
  onCreator,
  agency,
  mine,
  own,
  onOwn,
}: {
  planning: Planning;
  creatorId: string | null;
  onCreator: (creatorId: string | null) => void;
  agency: string;
  mine: string;
  own: boolean;
  onOwn: (own: boolean) => void;
}): JSX.Element | null {
  const creators = [
    ...new Map(planning.accounts.map((account) => [account.creatorId, account.creatorName])),
  ].sort(([, a], [, b]) => a.localeCompare(b, 'fr'));
  const zones = mine !== agency;
  if (creators.length < 2 && !zones) return null;
  return (
    <div className="sc-filters">
      {creators.length < 2 ? null : (
        <div className="tm-choices" role="radiogroup" aria-label="Créatrice">
          <button
            type="button"
            role="radio"
            className="nv-chip"
            aria-checked={creatorId === null}
            onClick={() => {
              onCreator(null);
            }}
          >
            Toutes
          </button>
          {creators.map(([id, name]) => (
            <button
              key={id}
              type="button"
              role="radio"
              className="nv-chip"
              aria-checked={creatorId === id}
              onClick={() => {
                onCreator(id);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      {zones ? (
        <div className="tm-choices" role="radiogroup" aria-label="Heure affichée">
          <button
            type="button"
            role="radio"
            className="nv-chip"
            aria-checked={!own}
            onClick={() => {
              onOwn(false);
            }}
          >
            {cityOf(agency)}
          </button>
          <button
            type="button"
            role="radio"
            className="nv-chip"
            aria-checked={own}
            onClick={() => {
              onOwn(true);
            }}
          >
            Mon heure ({cityOf(mine)})
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** « En poste maintenant »: who chats on what, until when. Empty, it says so in one line. */
function OnDutyStrip({
  list,
  planning,
  zone,
  onShow,
}: {
  list: readonly OnDuty[] | null;
  planning: Planning;
  zone: string;
  onShow: (shiftId: string) => void;
}): JSX.Element | null {
  if (list === null) return null;
  const accounts = new Map(planning.accounts.map((account) => [account.id, account]));
  const known = new Set<string>(planning.shifts.map((shift) => shift.id));
  return (
    <section className="sc-duty" aria-labelledby="sc-duty-title">
      <h2 id="sc-duty-title" className="sc-duty__title">
        <span className={`nv-dot${list.length === 0 ? '' : ' nv-tone--ok nv-dot--live'}`} />
        En poste maintenant
      </h2>
      {list.length === 0 ? (
        <p className="sc-duty__none">Personne pour l’instant.</p>
      ) : (
        <ul className="sc-duty__list">
          {list.map((one) => {
            const account = accounts.get(one.platformAccountId);
            const body = (
              <>
                <span
                  className="sc-swatch"
                  style={one.member.color === null ? undefined : { '--sc-color': one.member.color }}
                  aria-hidden="true"
                />
                <span className="sc-duty__who">{one.member.displayName}</span>
                <span className="sc-duty__where">{account?.creatorName ?? 'Une créatrice'}</span>
                <span className="sc-duty__until nv-num">jusqu’à {clockAt(one.endsAt, zone)}</span>
              </>
            );
            return (
              <li key={one.shiftId}>
                {known.has(one.shiftId) ? (
                  <button
                    type="button"
                    className="sc-duty__one"
                    onClick={() => {
                      onShow(one.shiftId);
                    }}
                  >
                    {body}
                  </button>
                ) : (
                  <span className="sc-duty__one">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * « N shifts à pourvoir »: the weekly shifts the server could not place this week, in amber, one line each, with the
 * shift in its way, or « Pourvoir » when its member is on leave (ADR 0031, EQ-03).
 */
function Conflicts({
  planning,
  templates,
  zone,
  onShow,
  onFill,
}: {
  planning: Planning;
  templates: readonly ShiftTemplate[];
  zone: string;
  onShow: (shiftId: string) => void;
  onFill: (fill: Fill) => void;
}): JSX.Element | null {
  const lines = conflictLines(planning.conflicts, templates, planning, zone);
  if (lines.length === 0) return null;
  const known = new Set<string>(planning.shifts.map((shift) => shift.id));
  return (
    <section className="nv-plate sc-conflicts nv-swap" role="status" aria-labelledby="sc-conflicts-title">
      <h2 id="sc-conflicts-title" className="sc-conflicts__title">
        {conflictTitle(lines)}
      </h2>
      <ul className="sc-conflicts__list">
        {lines.map((line) => {
          const shiftId = line.shiftId !== null && known.has(line.shiftId) ? line.shiftId : null;
          return (
            <li key={line.key} className="sc-conflicts__one">
              {/* One line a shift: « jeu. 29 · 23 h – 5 h · Inès — Josué est en congé » (EQ-02, EQ-03). */}
              <p className="sc-conflicts__text">
                <span className="sc-conflicts__when nv-num">{line.when}</span>
                <span className="sc-conflicts__what"> — {line.what}</span>
              </p>
              {line.fill !== null ? (
                <button
                  type="button"
                  className="nv-btn nv-btn--soft nv-btn--sm"
                  onClick={() => {
                    if (line.fill !== null) onFill(line.fill);
                  }}
                >
                  Pourvoir
                </button>
              ) : shiftId === null ? null : (
                <button
                  type="button"
                  className="nv-btn nv-btn--plain nv-btn--sm"
                  onClick={() => {
                    onShow(shiftId);
                  }}
                >
                  Voir le shift
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Grid({
  planning,
  rows,
  days,
  today,
  picked,
  onPick,
  now,
  zone,
  loading,
  focus,
  flagged,
  incidents,
  onAdd,
  onShow,
}: {
  planning: Planning;
  rows: readonly GridRow[];
  days: readonly string[];
  today: string;
  /** On a phone, the one day shown. */
  picked: number;
  onPick: (index: number) => void;
  now: Date;
  zone: string;
  loading: boolean;
  /** The member whose shifts stand out, the others dimmed; `null` for all. */
  focus: string | null;
  /** Shifts to point at: those a leave's approval found in its way. */
  flagged: ReadonlySet<string>;
  /** What the shifts' reports said went wrong, by shift. */
  incidents: ReadonlyMap<string, readonly string[]>;
  onAdd: (start: ShiftStart) => void;
  onShow: (shiftId: string) => void;
}): JSX.Element {
  if (planning.accounts.length === 0) {
    return (
      <Panel className="nv-coming">
        <div className="nv-coming__in sc-notice">
          <h2>Aucun compte à planifier</h2>
          <p>
            Une ligne apparaît ici pour chaque compte de créatrice : ajoute la créatrice et son compte Reveal
            d’abord.
          </p>
        </div>
      </Panel>
    );
  }
  const week = planning.shifts.filter((shift) =>
    rows.some((row) => row.account.id === shift.platformAccountId),
  );
  const total = week.reduce(
    (sum, shift) => sum + new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime(),
    0,
  );
  // The créneaux are the agency's: they line up at its hour, not at another one (EQ-01).
  const lined = zone === planning.settings.timeZone;
  const slotted = rows.map((row) =>
    lined
      ? slotRowOf(
          row,
          planning.shifts.filter((shift) => shift.platformAccountId === row.account.id),
          days,
          planning.settings,
          now,
        )
      : null,
  );
  const toFill = slotted.reduce(
    (sum, cells) =>
      sum + [...(cells?.values() ?? [])].reduce((inDay, slots) => inDay + slots.filter(isOpen).length, 0),
    0,
  );
  const slotCount = slotted.find((cells) => cells !== null)?.get(days[0] ?? today)?.length ?? 0;
  const marked = {
    repeat: week.some((shift) => shift.templateId !== null),
    incident: week.some((shift) => incidents.has(shift.id)),
  };
  return (
    <Panel className="sc-grid-panel">
      <div className="sc-days" role="radiogroup" aria-label="Jour affiché">
        {days.map((day, index) => (
          <button
            key={day}
            type="button"
            role="radio"
            className="sc-days__one"
            aria-checked={index === picked}
            data-today={day === today ? 'true' : undefined}
            onClick={() => {
              onPick(index);
            }}
          >
            <span className="sc-days__name">{shortDay(day).split(' ')[0]}</span>
            <span className="sc-days__num nv-num">{dayNumber(day)}</span>
          </button>
        ))}
      </div>
      <div
        className="sc-grid nv-swap"
        key={days[0]}
        role="table"
        aria-label={`Planning de la semaine du ${longDay(days[0] ?? today)}`}
        aria-busy={loading}
        data-loading={loading ? 'true' : undefined}
      >
        <div className="sc-grid__row sc-grid__row--head" role="row">
          <span className="sc-grid__corner" role="columnheader">
            <span className="nv-num">
              {week.length === 1 ? '1 shift' : `${String(week.length)} shifts`}
              {week.length === 0 ? '' : ` · ${lengthOf(total)}`}
              {toFill === 0 ? null : (
                <span className="sc-grid__tofill">
                  {toFill === 1 ? ' · 1 créneau à pourvoir' : ` · ${String(toFill)} créneaux à pourvoir`}
                </span>
              )}
            </span>
          </span>
          {days.map((day, index) => (
            <span
              key={day}
              role="columnheader"
              className="sc-grid__day"
              data-today={day === today ? 'true' : undefined}
              data-picked={index === picked ? 'true' : undefined}
              data-past={day < today ? 'true' : undefined}
            >
              <span className="sc-grid__dayname">{shortDay(day).split(' ')[0]}</span>
              <span className="sc-grid__daynum nv-num">{dayNumber(day)}</span>
            </span>
          ))}
        </div>
        {rows.map((row, rowIndex) => (
          <div
            key={row.account.id}
            className={`sc-grid__row nv-enter${slotCount === 0 ? '' : ' sc-grid__row--slots'}`}
            style={slotCount === 0 ? { '--nv-i': rowIndex } : { '--nv-i': rowIndex, '--sc-slots': slotCount }}
            role="row"
          >
            <span className="sc-grid__account" role="rowheader">
              <span className="sc-grid__creator">{row.account.creatorName}</span>
              <span className="sc-grid__handle">{accountLine(row.account)}</span>
            </span>
            {days.map((day, index) => (
              <Cell
                key={day}
                day={day}
                chips={row.days.get(day) ?? []}
                slots={slotted[rowIndex]?.get(day) ?? null}
                agency={planning.settings.timeZone}
                accountId={row.account.id}
                where={`${row.account.creatorName}, ${accountLine(row.account)}`}
                today={day === today}
                picked={index === picked}
                past={day < today}
                now={now}
                zone={zone}
                focus={focus}
                flagged={flagged}
                incidents={incidents}
                onAdd={onAdd}
                onShow={onShow}
              />
            ))}
          </div>
        ))}
      </div>
      {/* The two marks of a shift, said once under the grid (EQ-24). */}
      {marked.repeat || marked.incident ? (
        <p className="sc-legend">
          {marked.repeat ? (
            <span className="sc-legend__one">
              <RepeatIcon className="sc-legend__icon" />
              Revient chaque semaine
            </span>
          ) : null}
          {marked.incident ? (
            <span className="sc-legend__one">
              <IncidentIcon className="sc-chip__incident" />
              Incident signalé dans le rapport
            </span>
          ) : null}
        </p>
      ) : null}
    </Panel>
  );
}

/** A créneau with a stretch ahead and nobody on it: a dashed amber « À pourvoir » that opens a shift on that stretch. */
const isOpen = (slot: SlotCell): boolean => slot.open !== null;

function Cell({
  day,
  chips,
  slots,
  agency,
  accountId,
  where,
  today,
  picked,
  past,
  now,
  zone,
  focus,
  flagged,
  incidents,
  onAdd,
  onShow,
}: {
  day: string;
  chips: readonly Chip[];
  /** The day cut into the agency's créneaux, `null` when they do not line up (another hour, too many créneaux). */
  slots: readonly SlotCell[] | null;
  /** The agency's zone: the hours a new shift is made in. */
  agency: string;
  accountId: string;
  /** The creator and the account (« Nora Vidal, @nora sur Reveal »): two accounts of hers never read the same. */
  where: string;
  today: boolean;
  picked: boolean;
  past: boolean;
  now: Date;
  zone: string;
  focus: string | null;
  flagged: ReadonlySet<string>;
  incidents: ReadonlyMap<string, readonly string[]>;
  onAdd: (start: ShiftStart) => void;
  onShow: (shiftId: string) => void;
}): JSX.Element {
  const chipOf = (chip: Chip): JSX.Element => (
    <ShiftChip
      key={chip.shift.id}
      chip={chip}
      now={now}
      zone={zone}
      muted={focus !== null && chip.shift.memberId !== focus}
      flagged={flagged.has(chip.shift.id)}
      incident={incidents.has(chip.shift.id)}
      onShow={onShow}
    />
  );
  return (
    <div
      className="sc-grid__cell"
      role="cell"
      data-today={today ? 'true' : undefined}
      data-picked={picked ? 'true' : undefined}
      data-past={past ? 'true' : undefined}
    >
      {slots === null
        ? chips.map(chipOf)
        : slots.map((slot) => (
            <div key={slot.slot.startMinute} className="sc-slot">
              {slot.chips.map(chipOf)}
              {slot.open !== null ? (
                <OpenStretch
                  open={slot.open}
                  agency={agency}
                  zone={zone}
                  where={where}
                  onAdd={(hours) => {
                    onAdd({ accountId, ...hours });
                  }}
                />
              ) : slot.chips.length === 0 && !slot.covered && slot.to.getTime() <= now.getTime() ? (
                // A créneau gone by with nobody: left grey, nothing to do about it now.
                <span className="sc-slot__gone" aria-hidden="true" />
              ) : null}
            </div>
          ))}
      {past ? null : (
        <button
          type="button"
          className="sc-add"
          aria-label={`Ajouter un shift le ${longDay(day)} sur ${where}`}
          onClick={() => {
            onAdd({ accountId, day });
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
        </button>
      )}
    </div>
  );
}

/**
 * « À pourvoir » on what is left of a créneau with nobody: its hours, from now at the minute for the créneau under way,
 * and the new-shift panel opens on them.
 */
function OpenStretch({
  open,
  agency,
  zone,
  where,
  onAdd,
}: {
  open: { readonly from: Date; readonly to: Date };
  agency: string;
  zone: string;
  where: string;
  onAdd: (hours: Pick<ShiftStart, 'day' | 'hours'>) => void;
}): JSX.Element {
  const hours = rangeAt(open.from.toISOString(), open.to.toISOString(), zone);
  return (
    <button
      type="button"
      className="sc-slot__fill"
      aria-label={`À pourvoir : ${hours}, le ${longDay(dayOf(open.from, zone))} sur ${where}`}
      onClick={() => {
        onAdd({
          day: dayOf(open.from, agency),
          hours: { startMinute: minuteOf(open.from, agency), endMinute: minuteOf(open.to, agency) },
        });
      }}
    >
      <span className="sc-slot__label">À pourvoir</span>
      <span className="sc-slot__hours nv-num">{hours}</span>
    </button>
  );
}

/** The mark of a weekly shift; `titled` on a chip, where its tip says it (the legend says it in words). */
function RepeatIcon({ className, titled = false }: { className: string; titled?: boolean }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      {titled ? <title>Revient chaque semaine</title> : null}
      <path d="M3 7a5 5 0 0 1 8.5-3.5L13 5M13 2v3h-3M13 9a5 5 0 0 1-8.5 3.5L3 11M3 14v-3h3" />
    </svg>
  );
}

function IncidentIcon({ className, titled = false }: { className: string; titled?: boolean }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      {titled ? <title>Incident signalé dans le rapport</title> : null}
      <path d="M8 2.6 14.2 13.4H1.8Z" />
      <path d="M8 6.6v3M8 11.5v.01" />
    </svg>
  );
}

function ShiftChip({
  chip,
  now,
  zone,
  muted,
  flagged,
  incident,
  onShow,
}: {
  chip: Chip;
  now: Date;
  zone: string;
  /** Another member's, while one member's shifts stand out. */
  muted: boolean;
  flagged: boolean;
  /** Its report says something went wrong. */
  incident: boolean;
  onShow: (shiftId: string) => void;
}): JSX.Element {
  const { shift, member } = chip;
  const phase = phaseOf(shift, now);
  const name = member?.displayName ?? 'Un membre';
  return (
    <button
      type="button"
      className="sc-chip"
      data-phase={phase}
      data-muted={muted ? 'true' : undefined}
      data-flagged={flagged ? 'true' : undefined}
      data-incident={incident ? 'true' : undefined}
      data-repeat={shift.templateId === null ? undefined : 'true'}
      data-color={member?.color === null || member === null ? undefined : 'true'}
      style={member?.color === null || member === null ? undefined : { '--sc-color': member.color }}
      aria-label={`${name}, ${rangeAt(shift.startsAt, shift.endsAt, zone)}${chip.continued ? ', commencé la veille' : ''}${chip.overnight ? ', jusqu’au lendemain' : ''}${phase === 'live' ? ', en poste' : ''}${flagged ? ', pendant un congé à valider' : ''}${incident ? ', incident signalé' : ''}`}
      onClick={() => {
        onShow(shift.id);
      }}
    >
      <span className="sc-chip__who">
        {phase === 'live' ? <span className="nv-dot nv-tone--ok nv-dot--live" /> : null}
        {/* A long name gives way with an ellipsis; the marks keep their place (EQ-24). */}
        <span className="sc-chip__name">{name}</span>
        {incident ? <IncidentIcon className="sc-chip__incident" titled /> : null}
      </span>
      <span className="sc-chip__hours nv-num">
        {chip.continued ? '… ' : ''}
        {rangeAt(shift.startsAt, shift.endsAt, zone)}
        {chip.overnight ? <span className="sc-chip__night"> +1</span> : null}
      </span>
      {shift.templateId === null ? null : <RepeatIcon className="sc-chip__repeat" titled />}
    </button>
  );
}
