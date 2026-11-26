import type {
  LeaveRequest,
  PayPeriod,
  Planning,
  PlanningAccount,
  Shift,
  ShiftReport,
  ShiftReportList,
  ShiftSwapList,
  TeamMember,
} from '@impera/contracts';
import { useState, type JSX } from 'react';

import { Answers, MyLeaves, MySwaps, namesOf } from './Exchanges';
import { LeavePanel } from './LeavePanel';
import { AvailabilityPanel, MyAvailability } from './MyAvailability';
import { SwapPanel } from './SwapPanel';

import { ReportPanel } from '@/reports/ReportPanel';
import { useReportsOf } from '@/reports/api';
import {
  GAP_TO_EXPLAIN,
  gapWaits,
  MEMBER_STATUS,
  memberStatusOf,
  periodAt,
  reportOf,
  toneOf,
  WITHOUT_PAY_EFFECT,
  withoutPayEffect,
} from '@/reports/model';
import { useReopening, type ReportDraft } from '@/reports/reopen';
import '@/reports/reports.css';
import { CalendarLinkBody, SHIFT_LINK_WORDS } from '@/scheduling/CalendarLinkBody';
import { MyAwayCard } from '@/scheduling/MyAwayCard';
import { MonthNav, TeamPanel } from '@/scheduling/TeamCalendar';
import { WeekNav } from '@/scheduling/WeekNav';
import { useCalendar, useLeaves, useMyAvailability, usePlanning, useSwaps } from '@/scheduling/api';
import { monthWindow, type CalendarSearch } from '@/scheduling/calendar';
import '@/scheduling/exchanges.css';
import { accountLine, leaveDaysLine, phaseOf, type MyAwayStatus, type Phase } from '@/scheduling/model';
import '@/scheduling/scheduling.css';
import {
  addDays,
  cityOf,
  dayOf,
  lengthOf,
  longDay,
  mondayOf,
  rangeAt,
  readerZone,
  weekOf,
  zonedInstant,
} from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { useMembers } from '@/screens/team/api';
import '@/screens/team/team.css';
import { Dialog } from '@/shell/Dialog';
import { PlanningArt } from '@/shell/art/EmptyArt';
import { Page, PageHeader, Panel } from '@/shell/layout';
import { Empty, Failure } from '@/shell/states';

/** The chatter's Planning in the address: the week, and the team's calendar by week or month (CR-12). */
export type MyPlanningSearch = CalendarSearch & { readonly semaine?: string | undefined };

type Open =
  | { readonly kind: 'leave' }
  /** « Mes dispos »: the week he can work (ADR 0168, trou 16). */
  | { readonly kind: 'dispos' }
  /** « Dans mon téléphone »: the link that puts his shifts in his phone's calendar (CR-12; Moi › Calendrier before). */
  | { readonly kind: 'phone' }
  | { readonly kind: 'swap'; readonly shift: Shift; readonly creatorName: string | undefined }
  | { readonly kind: 'report'; readonly shiftId: string; readonly draft: ReportDraft | null };

/** A finished shift's report as its row says it: to make, or its status; `null` when its period is not read. */
type RowReport = { readonly kind: 'todo' } | { readonly kind: 'made'; readonly report: ShiftReport } | null;

/** The periods a week's shifts fall in, at the agency's hour: one, or two across a 1st or a 16th. */
function periodsOf(planning: Planning | undefined): PayPeriod[] {
  if (planning === undefined) return [];
  const zone = planning.settings.timeZone;
  return [...new Set(planning.shifts.map((shift) => periodAt(new Date(shift.startsAt), zone)))].toSorted();
}

/** A leave read a month back and eleven ahead: what is under way, what is coming, what was just answered. */
function leaveRangeOf(today: string, zone: string): { from: string; to: string } {
  return {
    from: zonedInstant(addDays(today, -31), 0, zone).toISOString(),
    to: zonedInstant(addDays(today, 334), 0, zone).toISOString(),
  };
}

/**
 * Planning of a chatter (ADR 0024, EQ-02): their own shifts, week by week, in their own time; the agency's hour
 * beside it when it differs, since that is the hour the team speaks in. The server sends their shifts alone. Their
 * leaves and swaps sit around it (ADR 0031): the proposals waiting for their answer first, a shift ahead offered to a
 * colleague from its row, a leave asked from the header, and their own leaves and swaps folded below.
 */
export function MyPlanningPage({
  userId,
  away = null,
  search = {},
  onSearch = () => undefined,
}: {
  userId: string;
  /** His status when he is away from the team: said first, and no shift of his reads « En poste » (CHAT-09). */
  away?: MyAwayStatus | null;
  /** What the address keeps (`?vue=equipe&affichage=mois&mois=…&semaine=…`), there again on return (CR-12). */
  search?: MyPlanningSearch;
  onSearch?: (next: MyPlanningSearch) => void;
}): JSX.Element {
  const now = useNow();
  // A chatter reads their own record alone: who they are, in which zone their shifts and leave days fall.
  const members = useMembers();
  const me = members.data?.find((member) => member.userId === userId) ?? null;
  // One « ton heure » on the whole page, the one of his record, as the leave asks it; the device's only while the
  // record is not read (recette 05/11, CHAT-11).
  const zone = me?.timeZone ?? readerZone();
  const today = dayOf(now, zone);
  const [shown, setShown] = useState<MyPlanningSearch>(search);
  const show = (patch: MyPlanningSearch): void => {
    const next = { ...shown, ...patch };
    setShown(next);
    onSearch(next);
  };
  const monday = shown.semaine ?? mondayOf(today);
  const setMonday = (next: string): void => {
    show({ semaine: next === mondayOf(today) ? undefined : next });
  };
  const team = shown.vue === 'equipe';
  const [open, setOpen] = useState<Open | null>(null);
  const availability = useMyAvailability();
  const days = weekOf(monday);
  const planning = usePlanning({
    from: zonedInstant(monday, 0, zone).toISOString(),
    to: zonedInstant(addDays(monday, 7), 0, zone).toISOString(),
    creatorId: null,
  });
  // The team's calendar speaks the agency's hour: its créneaux line up there (EQ-01). Read once that hour is known.
  const agency = planning.data?.settings.timeZone ?? null;
  const agencyToday = agency === null ? today : dayOf(now, agency);
  const thisMonth = agencyToday.slice(0, 7);
  const month = shown.mois ?? thisMonth;
  const byMonth = shown.affichage === 'mois';
  const window = agency === null || !team ? null : byMonth ? monthWindow(month, agency) : null;
  const calendar = useCalendar(
    agency === null || !team
      ? null
      : window !== null
        ? { from: window.from.toISOString(), to: window.to.toISOString() }
        : {
            from: zonedInstant(monday, 0, agency).toISOString(),
            to: zonedInstant(addDays(monday, 7), 0, agency).toISOString(),
          },
  );
  const [focus, setFocus] = useState<string | null>(null);
  const leaves = useLeaves(leaveRangeOf(today, zone));
  const swaps = useSwaps();
  // This week with nothing left ahead (a Sunday evening): the next one is read too and shown under it, so that the
  // shift of tomorrow is on screen without a turn of the week (recette visuelle 16/11, CHA-04).
  const thisMonday = mondayOf(today);
  const weekDone =
    !team &&
    monday === thisMonday &&
    planning.data !== undefined &&
    mineOf(planning.data, me).shifts.every((shift) => phaseOf(shift, now) === 'past');
  const following = usePlanning(
    {
      from: zonedInstant(addDays(monday, 7), 0, zone).toISOString(),
      to: zonedInstant(addDays(monday, 14), 0, zone).toISOString(),
      creatorId: null,
    },
    weekDone,
  );
  const nextWeek = weekDone && following.data !== undefined ? mineOf(following.data, me) : null;
  const swapOf = (shiftId: string): Open | null => {
    // A shift of the next week, shown under this one when it is done, is offered from there too (CHA-04).
    const source = [planning.data, nextWeek]
      .filter((one) => one !== undefined && one !== null)
      .find((one) => one.shifts.some((shift) => shift.id === shiftId));
    const shift = source?.shifts.find((one) => one.id === shiftId);
    if (source === undefined || shift === undefined) return null;
    const creatorName = source.accounts.find(
      (account) => account.id === shift.platformAccountId,
    )?.creatorName;
    return { kind: 'swap', shift, creatorName };
  };
  // A finished shift says where its report is, and makes it from here as Aujourd'hui does (EQ-19).
  const reports = useReportsOf(periodsOf(planning.data));
  useReopening('/planning', (what) => {
    setOpen({ kind: 'report', shiftId: what.shiftId, draft: what.draft });
  });

  return (
    <Page width="narrow">
      <PageHeader
        title="Planning"
        lead={
          team && agency !== null
            ? `Qui chatte quand dans l’équipe, à l’heure de l’agence (${cityOf(agency)}).`
            : `Tes shifts, à ton heure (${cityOf(zone)}).`
        }
        actions={
          <>
            {team && byMonth ? (
              <MonthNav
                month={month}
                thisMonth={thisMonth}
                onMonth={(next) => {
                  show({ mois: next === thisMonth ? undefined : next });
                }}
              />
            ) : (
              <WeekNav monday={monday} thisMonday={mondayOf(today)} onMonday={setMonday} />
            )}
          </>
        }
      />
      {/* One body under the header: the page's grid gives its free height to that one. */}
      <div className="sc-stack">
        {away === null ? null : <MyAwayCard status={away} />}
        <div className="cal-bar">
          <div className="tm-choices" role="radiogroup" aria-label="Planning affiché">
            <button
              type="button"
              role="radio"
              className="nv-chip"
              aria-checked={!team}
              onClick={() => {
                show({ vue: undefined });
              }}
            >
              Mes shifts
            </button>
            <button
              type="button"
              role="radio"
              className="nv-chip"
              aria-checked={team}
              onClick={() => {
                show({ vue: 'equipe' });
              }}
            >
              L’équipe
            </button>
          </div>
          {team ? (
            <div className="tm-choices" role="radiogroup" aria-label="Période">
              <button
                type="button"
                role="radio"
                className="nv-chip"
                aria-checked={!byMonth}
                onClick={() => {
                  show({ affichage: undefined });
                }}
              >
                Semaine
              </button>
              <button
                type="button"
                role="radio"
                className="nv-chip"
                aria-checked={byMonth}
                onClick={() => {
                  show({ affichage: 'mois' });
                }}
              >
                Mois
              </button>
            </div>
          ) : (
            // His own shifts in his phone's calendar: where the shifts are, not a tab of Moi (ADR 0134, lot 1).
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm cal-bar__end"
              onClick={() => {
                setOpen({ kind: 'phone' });
              }}
            >
              <PhoneMark />
              Dans mon téléphone
            </button>
          )}
        </div>
        {/* The planning silent says it for the page: the lines of its other reads keep quiet then (ETA-05). */}
        {members.isError && me === null && !planning.isError ? (
          <Failure
            inline
            className="sc-inline-warn sc-unread nv-swap"
            onRetry={() => {
              void members.refetch();
            }}
          >
            Un congé ne peut pas encore être demandé : réessaie dans un instant.
          </Failure>
        ) : null}
        {reports.failed && !planning.isError ? (
          <Failure inline className="sc-inline-warn sc-unread nv-swap" onRetry={reports.retry}>
            Tes rapports n’ont pas pu être lus : réessaie dans un instant.
          </Failure>
        ) : null}
        {me === null || swaps.data === undefined ? null : (
          <Answers
            swaps={swaps.data.swapRequests.filter(
              (swap) => swap.targetMemberId === me.id && swap.status === 'proposed',
            )}
            list={swaps.data}
            zone={zone}
          />
        )}
        {team ? (
          <TeamPanel
            calendar={calendar}
            failed={planning.isError && agency === null}
            onRetry={() => {
              void (agency === null ? planning.refetch() : calendar.refetch());
              if (members.isError) void members.refetch();
            }}
            days={window?.days ?? weekOf(monday)}
            month={byMonth ? month : null}
            today={agencyToday}
            now={now}
            me={me?.id ?? null}
            focus={focus}
            onFocus={setFocus}
          />
        ) : planning.isError ? (
          <Failure
            onRetry={() => {
              void planning.refetch();
              if (members.isError) void members.refetch();
            }}
          />
        ) : planning.data === undefined || members.isPending ? (
          <Panel>
            <div className="sc-skeleton" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          </Panel>
        ) : (
          <Week
            planning={mineOf(planning.data, me)}
            days={days}
            zone={zone}
            today={today}
            now={now}
            held={away === null}
            away={(leaves.data?.leaveRequests ?? []).filter(
              (leave) =>
                (leave.status === 'approved' || leave.status === 'pending') &&
                leave.firstDay <= addDays(monday, 6) &&
                leave.lastDay >= monday,
            )}
            offers={offersOf(swaps.data, me)}
            reports={reports.list}
            nextWeek={nextWeek === null ? null : { planning: nextWeek, days: weekOf(addDays(monday, 7)) }}
            onSwap={(shiftId) => {
              setOpen(swapOf(shiftId));
            }}
            onReport={(shiftId) => {
              setOpen({ kind: 'report', shiftId, draft: null });
            }}
          />
        )}
        {me === null ? null : (
          // Under the team's calendar, as wide as it: both right edges on one line.
          <div className="sc-folds" data-wide={team ? 'true' : undefined}>
            {leaves.data === undefined ? null : (
              <MyLeaves
                leaves={leaves.data.leaveRequests}
                now={now}
                onAsk={() => {
                  setOpen({ kind: 'leave' });
                }}
              />
            )}
            {swaps.data === undefined ? null : <MySwaps list={swaps.data} memberId={me.id} zone={zone} />}
            <MyAvailability
              now={now}
              onEdit={() => {
                setOpen({ kind: 'dispos' });
              }}
            />
          </div>
        )}
        {open?.kind === 'phone' ? (
          <Dialog
            title="Mes shifts dans mon téléphone"
            lead="iPhone, Mac, Google Agenda"
            onClose={() => {
              setOpen(null);
            }}
          >
            <CalendarLinkBody words={SHIFT_LINK_WORDS} />
          </Dialog>
        ) : null}
        {open?.kind === 'dispos' && availability.data !== undefined ? (
          <AvailabilityPanel
            week={availability.data}
            onClose={() => {
              setOpen(null);
            }}
          />
        ) : null}
        {open?.kind === 'leave' && me !== null ? (
          <LeavePanel
            today={dayOf(now, me.timeZone)}
            timeZone={me.timeZone}
            memberId={me.id}
            onSwap={(shift, creatorName) => {
              setOpen({ kind: 'swap', shift, creatorName });
            }}
            onClose={() => {
              setOpen(null);
            }}
          />
        ) : null}
        {open?.kind === 'report' ? (
          <ReportPanel
            key={open.shiftId + (open.draft?.id ?? '')}
            shiftId={open.shiftId}
            draft={open.draft}
            from="/planning"
            zone={zone}
            onClose={() => {
              setOpen(null);
            }}
          />
        ) : null}
        {open?.kind === 'swap' ? (
          <SwapPanel
            shift={open.shift}
            creatorName={open.creatorName}
            zone={zone}
            onClose={() => {
              setOpen(null);
            }}
          />
        ) : null}
      </div>
    </Page>
  );
}

/**
 * « Mes shifts » holds his shifts alone: the server's planning of a member also carries the shifts of the swaps that
 * touch him, a colleague's offered to him or his own given away (recette 05/11, CHAT-05). Those live in the exchanges.
 * Without his record (it could not be read), the planning stays as the server sends it.
 */
function mineOf(planning: Planning, me: Pick<TeamMember, 'id'> | null): Planning {
  if (me === null) return planning;
  return { ...planning, shifts: planning.shifts.filter((shift) => shift.memberId === me.id) };
}

/** A phone, drawn in the line of the menu's icons. */
function PhoneMark(): JSX.Element {
  return (
    <svg className="cal-bar__mark" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4.25" y="1.75" width="7.5" height="12.5" rx="1.75" />
      <path d="M7 12h2" />
    </svg>
  );
}

/** The reader's open proposals by shift, with the colleague each one waits on. */
function offersOf(list: ShiftSwapList | undefined, me: TeamMember | null): ReadonlyMap<string, string[]> {
  const offers = new Map<string, string[]>();
  if (list === undefined || me === null) return offers;
  const names = namesOf(list);
  for (const swap of list.swapRequests) {
    if (swap.requesterId !== me.id || swap.status !== 'proposed') continue;
    offers.set(swap.shiftId, [...(offers.get(swap.shiftId) ?? []), names.member(swap.targetMemberId)]);
  }
  return offers;
}

function Week({
  planning,
  days,
  zone,
  today,
  now,
  held,
  away,
  offers,
  reports,
  nextWeek,
  onSwap,
  onReport,
}: {
  planning: Planning;
  days: readonly string[];
  zone: string;
  today: string;
  now: Date;
  /** His shifts are his to hold: not while he is away from the team (CHAT-09). */
  held: boolean;
  /** The reader's leaves that touch this week, approved or waiting. */
  away: readonly LeaveRequest[];
  offers: ReadonlyMap<string, readonly string[]>;
  /** The reports of the week's periods, `null` until read (when they cannot be, the page says so above the week). */
  reports: ShiftReportList | null;
  /** The week after, read when nothing is left ahead in this one (CHA-04); `null` otherwise. */
  nextWeek: { readonly planning: Planning; readonly days: readonly string[] } | null;
  onSwap: (shiftId: string) => void;
  onReport: (shiftId: string) => void;
}): JSX.Element {
  const accounts = new Map(
    [...planning.accounts, ...(nextWeek?.planning.accounts ?? [])].map((account) => [account.id, account]),
  );
  const agency = planning.settings.timeZone;
  const daysOf = (week: Planning, of: readonly string[]): { day: string; shifts: Shift[] }[] =>
    of
      .map((day) => ({
        day,
        shifts: week.shifts
          .filter((shift) => dayOf(shift.startsAt, zone) === day)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      }))
      .filter(({ shifts }) => shifts.length > 0);
  const byDay = daysOf(planning, days);
  const nextDays = nextWeek === null ? [] : daysOf(nextWeek.planning, nextWeek.days);
  const reportFor = (shift: Shift): RowReport => {
    if (!reports?.shifts.some((one) => one.id === shift.id)) return null;
    const report = reportOf(reports.reports, shift.id);
    return report === null ? { kind: 'todo' } : { kind: 'made', report };
  };
  const total = planning.shifts.reduce(
    (sum, shift) => sum + new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime(),
    0,
  );

  const leaves =
    away.length === 0 ? null : (
      <ul className="sc-away">
        {away.map((leave) => (
          <li key={leave.id} className="sc-away__one" data-status={leave.status}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.5 3.5h9a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM2.5 6.5h11M5.5 2v3M10.5 2v3M6 10h4" />
            </svg>
            <span className="sc-away__what">
              {leave.status === 'approved' ? 'En congé' : 'Congé demandé, en attente'}
            </span>
            <span className="sc-away__when">{leaveDaysLine(leave)}</span>
          </li>
        ))}
      </ul>
    );

  // The week under way opens on today: the days gone by fold above it, their reports to make said on the fold (EQ-17).
  // Another week keeps its order. A day stays out of the fold while one of its shifts is not over: a night shift begun
  // yesterday is still under way.
  const thisWeek = days.includes(today);
  const isGone = ({ day, shifts }: { day: string; shifts: Shift[] }): boolean =>
    thisWeek && day < today && shifts.every((shift) => phaseOf(shift, now) === 'past');
  const earlier = byDay.filter(isGone);
  const ahead = byDay.filter((one) => !isGone(one));
  const earlierCount = earlier.reduce((sum, { shifts }) => sum + shifts.length, 0);
  const pastReports = earlier
    .flatMap(({ shifts }) => shifts)
    .filter((shift) => phaseOf(shift, now) === 'past')
    .map(reportFor);
  const toDo = pastReports.filter((one) => one?.kind === 'todo').length;
  // A gap with the platform that waits for him is said on the fold too (ADR 0073 § 5).
  const toExplain = pastReports.filter((one) => one?.kind === 'made' && gapWaits(one.report, now)).length;
  const foldSum = [
    toDo === 0 ? null : toDo === 1 ? '1 rapport à faire' : `${String(toDo)} rapports à faire`,
    toExplain === 0
      ? null
      : toExplain === 1
        ? '1 écart à expliquer'
        : `${String(toExplain)} écarts à expliquer`,
  ]
    .filter((part) => part !== null)
    .join(' · ');
  // A day under « Semaine prochaine » is a level below it.
  const daySection = (
    { day, shifts }: { day: string; shifts: Shift[] },
    index: number,
    Heading: 'h2' | 'h3' = 'h2',
  ): JSX.Element => (
    <section
      key={day}
      className="sc-mine__day nv-enter"
      style={{ '--nv-i': index }}
      aria-labelledby={`sc-day-${day}`}
      data-today={day === today ? 'true' : undefined}
    >
      <Heading id={`sc-day-${day}`} className="nv-h3 sc-mine__date">
        {day === today ? 'Aujourd’hui' : longDay(day).replace(/^./u, (letter) => letter.toUpperCase())}
      </Heading>
      <ul className="sc-mine__list">
        {shifts.map((shift) => {
          const phase = phaseOf(shift, now);
          return (
            <MyShiftRow
              key={shift.id}
              shift={shift}
              account={accounts.get(shift.platformAccountId) ?? null}
              zone={zone}
              agency={agency}
              phase={phase}
              held={held}
              offeredTo={offers.get(shift.id) ?? []}
              report={phase === 'past' ? reportFor(shift) : null}
              now={now}
              onSwap={onSwap}
              onReport={onReport}
            />
          );
        })}
      </ul>
    </section>
  );

  // The week after, under a week with nothing left ahead: its days as this week's, under their own title (CHA-04).
  const following =
    nextDays.length === 0 ? null : (
      <section className="sc-mine sc-mine__next" aria-labelledby="sc-next-week">
        <h2 id="sc-next-week" className="nv-h2">
          Semaine prochaine
        </h2>
        {nextDays.map((one, index) => daySection(one, byDay.length + index, 'h3'))}
      </section>
    );

  if (byDay.length === 0) {
    return (
      <div className="sc-mine nv-swap" key={days[0]}>
        {leaves}
        <Empty plate art={<PlanningArt />} title="Aucun shift cette semaine">
          Ton responsable te place sur le planning : tes shifts s’afficheront ici dès qu’ils sont posés.
        </Empty>
        {following}
      </div>
    );
  }

  const aheadCount = ahead.reduce((sum, { shifts }) => sum + shifts.length, 0);
  return (
    <div className="sc-mine nv-swap" key={days[0]}>
      <p className="sc-mine__sum nv-num">
        {earlierCount === 0
          ? `${planning.shifts.length === 1 ? '1 shift' : `${String(planning.shifts.length)} shifts`} · ${lengthOf(total)}`
          : // Days gone by count apart: the week's total read as still ahead on a Sunday (CHA-04).
            `${String(aheadCount)} à venir · ${String(earlierCount)} ${earlierCount > 1 ? 'faits' : 'fait'}`}
      </p>
      {leaves}
      {earlier.length === 0 ? null : (
        <details className="nv-disclosure nv-plate sc-fold sc-mine__earlier">
          <summary>
            <span className="nv-disclosure__title">Plus tôt cette semaine ({earlierCount})</span>
            {foldSum === '' ? null : <span className="nv-disclosure__sum">{foldSum}</span>}
          </summary>
          <div className="nv-disclosure__body sc-mine">
            {earlier.map((one, index) => daySection(one, index))}
          </div>
        </details>
      )}
      {ahead.map((one, index) => daySection(one, index))}
      {following}
    </div>
  );
}

function MyShiftRow({
  shift,
  account,
  zone,
  agency,
  phase,
  held,
  offeredTo,
  report,
  now,
  onSwap,
  onReport,
}: {
  shift: Shift;
  account: PlanningAccount | null;
  zone: string;
  agency: string;
  phase: Phase;
  /**
   * His to hold: away from the team, a shift under way is not his « En poste » (CHAT-09), and none is his to offer
   * (CHT-31).
   */
  held: boolean;
  /** The colleagues an open proposal of this shift waits on. */
  offeredTo: readonly string[];
  report: RowReport;
  /** Whether a gap with the platform still waits for him (ADR 0073 § 5). */
  now: Date;
  onSwap: (shiftId: string) => void;
  onReport: (shiftId: string) => void;
}): JSX.Element {
  const explain = report !== null && report.kind !== 'todo' && gapWaits(report.report, now);
  const day = `${longDay(dayOf(shift.startsAt, zone))}, ${rangeAt(shift.startsAt, shift.endsAt, zone)}`;
  const length = new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime();
  const sameHours =
    rangeAt(shift.startsAt, shift.endsAt, zone) === rangeAt(shift.startsAt, shift.endsAt, agency);
  return (
    <li
      className="nv-plate sc-mine__shift"
      data-phase={phase}
      data-actions={phase === 'later' && held ? 'true' : undefined}
    >
      <div className="sc-mine__hours">
        <p className="sc-mine__range nv-num">{rangeAt(shift.startsAt, shift.endsAt, zone)}</p>
        <p className="sc-mine__length">{lengthOf(length)}</p>
      </div>
      <div className="sc-mine__main">
        <p className="sc-mine__who">{account?.creatorName ?? 'Une créatrice'}</p>
        <p className="sc-mine__where">
          {account === null ? null : accountLine(account)}
          {sameHours ? null : (
            <span className="sc-mine__agency">
              {' '}
              · {rangeAt(shift.startsAt, shift.endsAt, agency)} à {cityOf(agency)}
            </span>
          )}
        </p>
        {offeredTo.length === 0 ? null : (
          <p className="sc-mine__offer">Proposé à {offeredTo.join(', ')} · en attente de réponse</p>
        )}
      </div>
      {/* Only « En poste » says something the day and the row's place do not (EQ-18). */}
      {phase === 'live' && held ? (
        <span className="nv-status sc-phase sc-phase--live">
          <span className="nv-dot nv-tone--ok nv-dot--live" />
          En poste
        </span>
      ) : null}
      {report === null ? null : report.kind === 'todo' ? (
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm sc-mine__report"
          aria-label={`Faire mon rapport du ${day}`}
          onClick={() => {
            onReport(shift.id);
          }}
        >
          Faire mon rapport
        </button>
      ) : (
        <button
          type="button"
          className={`rp-chip rp-chip--${explain ? 'warn' : toneOf(report.report)} nv-tap sc-mine__report`}
          aria-label={`Rapport du ${day} : ${explain ? 'écart à expliquer' : memberStatusOf(report.report)}`}
          onClick={() => {
            onReport(shift.id);
          }}
        >
          {withoutPayEffect(report.report)
            ? WITHOUT_PAY_EFFECT
            : report.report.status === 'rejected'
              ? 'Renvoyé · Reprendre'
              : explain
                ? GAP_TO_EXPLAIN
                : `Rapport ${MEMBER_STATUS[report.report.status].toLowerCase()}`}
        </button>
      )}
      {/* Away from the team, he holds no shift: none to offer, the agency places them (recette 16/11, CHT-31). */}
      {phase === 'later' && held ? (
        <button
          type="button"
          className="sc-link sc-mine__swap"
          aria-label={`Échanger ton shift du ${day}`}
          onClick={() => {
            onSwap(shift.id);
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13" />
          </svg>
          Échanger
        </button>
      ) : null}
    </li>
  );
}
