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
} from '@nirvana/contracts';
import { useState, type JSX } from 'react';

import { Answers, MyLeaves, MySwaps, namesOf } from './Exchanges';
import { LeavePanel } from './LeavePanel';
import { SwapPanel } from './SwapPanel';

import { ReportPanel } from '@/reports/ReportPanel';
import { useReportsOf } from '@/reports/api';
import { MEMBER_STATUS, periodAt, reportOf, STATUS_TONES } from '@/reports/model';
import { useReopening, type ReportDraft } from '@/reports/reopen';
import '@/reports/reports.css';
import { WeekNav } from '@/scheduling/WeekNav';
import { useLeaves, usePlanning, useSwaps } from '@/scheduling/api';
import '@/scheduling/exchanges.css';
import { accountLine, leaveDaysLine, phaseOf, type Phase } from '@/scheduling/model';
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
import { Page, PageHeader, Panel } from '@/shell/layout';

type Open =
  | { readonly kind: 'leave' }
  | { readonly kind: 'swap'; readonly shiftId: string }
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
export function MyPlanningPage({ userId }: { userId: string }): JSX.Element {
  const now = useNow();
  const zone = readerZone();
  const today = dayOf(now, zone);
  const [monday, setMonday] = useState(() => mondayOf(today));
  const [open, setOpen] = useState<Open | null>(null);
  const days = weekOf(monday);
  const planning = usePlanning({
    from: zonedInstant(monday, 0, zone).toISOString(),
    to: zonedInstant(addDays(monday, 7), 0, zone).toISOString(),
    creatorId: null,
  });
  // A chatter reads their own record alone: who they are, in which zone their leave days fall.
  const members = useMembers();
  const me = members.data?.find((member) => member.userId === userId) ?? null;
  const leaves = useLeaves(leaveRangeOf(today, zone));
  const swaps = useSwaps();
  const opened =
    open?.kind === 'swap' ? (planning.data?.shifts.find((shift) => shift.id === open.shiftId) ?? null) : null;
  // A finished shift says where its report is, and makes it from here as Aujourd'hui does (EQ-19).
  const reports = useReportsOf(periodsOf(planning.data));
  useReopening('/planning', (what) => {
    setOpen({ kind: 'report', shiftId: what.shiftId, draft: what.draft });
  });

  return (
    <Page>
      <PageHeader
        title="Planning"
        lead={`Tes shifts, à ton heure (${cityOf(zone)}).`}
        actions={
          <>
            <WeekNav monday={monday} thisMonday={mondayOf(today)} onMonday={setMonday} />
            <button
              type="button"
              className="nv-btn nv-btn--soft"
              disabled={me === null}
              aria-busy={members.isPending}
              onClick={() => {
                setOpen({ kind: 'leave' });
              }}
            >
              Demander un congé
            </button>
          </>
        }
      />
      {/* One body under the header: the page's grid gives its free height to that one. */}
      <div className="sc-stack">
        {members.isError && me === null ? (
          <div className="sc-inline-warn sc-unread nv-swap" role="alert">
            <p className="tm-warn">
              Le serveur ne répond pas : ta fiche n’a pas pu être lue, et un congé ne peut pas encore être
              demandé.
            </p>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              onClick={() => {
                void members.refetch();
              }}
            >
              Réessayer
            </button>
          </div>
        ) : null}
        {reports.failed ? (
          <div className="sc-inline-warn sc-unread nv-swap" role="alert">
            <p className="tm-warn">Tes rapports n’ont pas pu être lus.</p>
            <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={reports.retry}>
              Réessayer
            </button>
          </div>
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
        {planning.isError ? (
          <Panel className="nv-coming">
            <div className="nv-coming__in sc-notice">
              <h2>Le serveur ne répond pas</h2>
              <p>Ton planning n’a pas pu être lu. Réessaie dans un instant.</p>
              <button
                type="button"
                className="nv-btn nv-btn--soft nv-btn--sm"
                onClick={() => {
                  void planning.refetch();
                }}
              >
                Réessayer
              </button>
            </div>
          </Panel>
        ) : planning.data === undefined ? (
          <Panel>
            <div className="sc-skeleton" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          </Panel>
        ) : (
          <Week
            planning={planning.data}
            days={days}
            zone={zone}
            today={today}
            now={now}
            away={(leaves.data?.leaveRequests ?? []).filter(
              (leave) =>
                (leave.status === 'approved' || leave.status === 'pending') &&
                leave.firstDay <= addDays(monday, 6) &&
                leave.lastDay >= monday,
            )}
            offers={offersOf(swaps.data, me)}
            reports={reports.list}
            onSwap={(shiftId) => {
              setOpen({ kind: 'swap', shiftId });
            }}
            onReport={(shiftId) => {
              setOpen({ kind: 'report', shiftId, draft: null });
            }}
          />
        )}
        {me === null ? null : (
          <div className="sc-folds">
            {leaves.data === undefined ? null : <MyLeaves leaves={leaves.data.leaveRequests} now={now} />}
            {swaps.data === undefined ? null : <MySwaps list={swaps.data} memberId={me.id} zone={zone} />}
          </div>
        )}
        {open?.kind === 'leave' && me !== null ? (
          <LeavePanel
            today={dayOf(now, me.timeZone)}
            timeZone={me.timeZone}
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
            onClose={() => {
              setOpen(null);
            }}
          />
        ) : null}
        {opened === null ? null : (
          <SwapPanel
            shift={opened}
            creatorName={
              planning.data?.accounts.find((account) => account.id === opened.platformAccountId)?.creatorName
            }
            zone={zone}
            onClose={() => {
              setOpen(null);
            }}
          />
        )}
      </div>
    </Page>
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
  away,
  offers,
  reports,
  onSwap,
  onReport,
}: {
  planning: Planning;
  days: readonly string[];
  zone: string;
  today: string;
  now: Date;
  /** The reader's leaves that touch this week, approved or waiting. */
  away: readonly LeaveRequest[];
  offers: ReadonlyMap<string, readonly string[]>;
  /** The reports of the week's periods, `null` until read (when they cannot be, the page says so above the week). */
  reports: ShiftReportList | null;
  onSwap: (shiftId: string) => void;
  onReport: (shiftId: string) => void;
}): JSX.Element {
  const accounts = new Map(planning.accounts.map((account) => [account.id, account]));
  const agency = planning.settings.timeZone;
  const byDay = days
    .map((day) => ({
      day,
      shifts: planning.shifts
        .filter((shift) => dayOf(shift.startsAt, zone) === day)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    }))
    .filter(({ shifts }) => shifts.length > 0);
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
  const toDo = earlier
    .flatMap(({ shifts }) => shifts)
    .filter((shift) => phaseOf(shift, now) === 'past' && reportFor(shift)?.kind === 'todo').length;
  const daySection = ({ day, shifts }: { day: string; shifts: Shift[] }, index: number): JSX.Element => (
    <section
      key={day}
      className="sc-mine__day nv-enter"
      style={{ '--nv-i': index }}
      aria-labelledby={`sc-day-${day}`}
      data-today={day === today ? 'true' : undefined}
    >
      <h2 id={`sc-day-${day}`} className="sc-mine__date">
        {day === today ? 'Aujourd’hui' : longDay(day).replace(/^./u, (letter) => letter.toUpperCase())}
      </h2>
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
              offeredTo={offers.get(shift.id) ?? []}
              report={phase === 'past' ? reportFor(shift) : null}
              onSwap={onSwap}
              onReport={onReport}
            />
          );
        })}
      </ul>
    </section>
  );

  if (byDay.length === 0) {
    return (
      <div className="sc-mine nv-swap" key={days[0]}>
        {leaves}
        <Panel className="nv-coming">
          <div className="nv-coming__in sc-notice">
            <h2>Aucun shift cette semaine</h2>
            <p>
              Ton responsable te place sur le planning : tes shifts s’afficheront ici dès qu’ils sont posés.
            </p>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="sc-mine nv-swap" key={days[0]}>
      <p className="sc-mine__sum nv-num">
        {planning.shifts.length === 1 ? '1 shift' : `${String(planning.shifts.length)} shifts`} ·{' '}
        {lengthOf(total)}
      </p>
      {leaves}
      {earlier.length === 0 ? null : (
        <details className="nv-disclosure nv-plate sc-fold sc-mine__earlier">
          <summary>
            <span className="nv-disclosure__title">Plus tôt cette semaine ({earlierCount})</span>
            {toDo === 0 ? null : (
              <span className="nv-disclosure__sum">
                {toDo === 1 ? '1 rapport à faire' : `${String(toDo)} rapports à faire`}
              </span>
            )}
          </summary>
          <div className="nv-disclosure__body sc-mine">{earlier.map(daySection)}</div>
        </details>
      )}
      {ahead.map(daySection)}
    </div>
  );
}

function MyShiftRow({
  shift,
  account,
  zone,
  agency,
  phase,
  offeredTo,
  report,
  onSwap,
  onReport,
}: {
  shift: Shift;
  account: PlanningAccount | null;
  zone: string;
  agency: string;
  phase: Phase;
  /** The colleagues an open proposal of this shift waits on. */
  offeredTo: readonly string[];
  report: RowReport;
  onSwap: (shiftId: string) => void;
  onReport: (shiftId: string) => void;
}): JSX.Element {
  const day = `${longDay(dayOf(shift.startsAt, zone))}, ${rangeAt(shift.startsAt, shift.endsAt, zone)}`;
  const length = new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime();
  const sameHours =
    rangeAt(shift.startsAt, shift.endsAt, zone) === rangeAt(shift.startsAt, shift.endsAt, agency);
  return (
    <li
      className="nv-plate sc-mine__shift"
      data-phase={phase}
      data-actions={phase === 'later' ? 'true' : undefined}
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
      {phase === 'live' ? (
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
          className={`rp-chip rp-chip--${STATUS_TONES[report.report.status]} nv-tap sc-mine__report`}
          aria-label={`Rapport du ${day} : ${MEMBER_STATUS[report.report.status]}`}
          onClick={() => {
            onReport(shift.id);
          }}
        >
          {report.report.status === 'rejected'
            ? 'Renvoyé · Reprendre'
            : `Rapport ${MEMBER_STATUS[report.report.status].toLowerCase()}`}
        </button>
      )}
      {phase === 'later' ? (
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
