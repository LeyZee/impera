import {
  SHIFT_REPORT_OPENS_BEFORE_END_MINUTES,
  type Me,
  type MyShift,
  type ShiftReport,
} from '@impera/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { TodoCard } from './TodoCard';
import './today.css';

import { urgencies } from '@/agent/queue';
import { MyReportsCard, useMyReports, type MyReports } from '@/reports/MyReports';
import { ReportPanel } from '@/reports/ReportPanel';
import { MEMBER_STATUS, reportOf, STATUS_TONES } from '@/reports/model';
import { useReopening, type ReportDraft } from '@/reports/reopen';
import '@/reports/reports.css';
import { MyAwayCard } from '@/scheduling/MyAwayCard';
import { useMyShifts } from '@/scheduling/api';
import { accountLine, dayStateOf, myAwayOf, progressOf, type DayState } from '@/scheduling/model';
import '@/scheduling/scheduling.css';
import {
  clockAt,
  dayOf,
  dayWordOf,
  lengthOf,
  longDay,
  rangeAt,
  readerZone,
  untilOf,
} from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { useMembers } from '@/screens/team/api';
import { todosAcrossQuery } from '@/screens/tracking/api';
import { ServerSilent } from '@/shell/ServerSilent';
import { Page, PageHeader, Panel } from '@/shell/layout';

/**
 * Aujourd'hui (ADR 0024, EQ-02, EQ-03): the chatter's shift first, where to go and until when, and « Faire mon
 * rapport » as it ends; then the reports left to do and the period's, then the next shift. Read in the chatter's own
 * time, his record's as on Planning (recette EXT-10). What waits on his invoices follows (EQ-06 lot 8d). The goal and
 * the announcements come with their own cards.
 */
export function TodayPage({ user }: { user: Me }): JSX.Element {
  const mine = useMyShifts();
  const now = useNow();
  // One clock on the page, the one of his record, as Planning reads it; the device's only while the record is not read
  // (recette EXT-10, as CHAT-11 for Planning).
  const members = useMembers();
  const zone = members.data?.find((member) => member.userId === user.id)?.timeZone ?? readerZone();
  const today = dayOf(now, zone);
  const reports = useMyReports(now);
  const [open, setOpen] = useState<{ readonly shiftId: string; readonly draft: ReportDraft | null } | null>(
    null,
  );
  const openReport = (shiftId: string): void => {
    setOpen({ shiftId, draft: null });
  };
  useReopening('/aujourdhui', (what) => {
    setOpen({ shiftId: what.shiftId, draft: what.draft });
  });

  return (
    <Page>
      {/* The title and the day say it all: no sentence under them (D-03). */}
      <PageHeader eyebrow={longDay(today)} title="Aujourd’hui" />
      {mine.isError ? (
        <ServerSilent
          text="Tes shifts n’ont pas pu être lus. Rien ici n’est à jour en attendant."
          onRetry={() => {
            void mine.refetch();
          }}
        />
      ) : mine.data === undefined ? (
        // As wide as the day it stands for, not the whole page (DASH-22).
        <div className="sc-today">
          <Panel className="sc-hero">
            <div className="sc-skeleton" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          </Panel>
        </div>
      ) : (
        <Day
          state={dayStateOf(mine.data, now)}
          now={now}
          zone={zone}
          today={today}
          reports={reports}
          onReport={openReport}
          user={user}
        />
      )}
      {open === null ? null : (
        <ReportPanel
          key={open.shiftId + (open.draft?.id ?? '')}
          shiftId={open.shiftId}
          draft={open.draft}
          from="/aujourdhui"
          zone={zone}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </Page>
  );
}

function Day({
  state,
  now,
  zone,
  today,
  reports,
  onReport,
  user,
}: {
  state: DayState;
  now: Date;
  zone: string;
  today: string;
  reports: MyReports;
  onReport: (shiftId: string) => void;
  user: Me;
}): JSX.Element {
  const next = state.kind === 'on' || state.kind === 'ended' ? state.next : null;
  const heroShift = state.kind === 'on' || state.kind === 'ended' ? state.shift : null;
  const list = reports.list;
  const made = heroShift === null || list === undefined ? null : reportOf(list.reports, heroShift.id);
  const report: HeroReport =
    heroShift === null || list === undefined
      ? { kind: 'none' }
      : made !== null
        ? { kind: 'made', report: made }
        : // The list is read each minute; the shift's own opening time says it on the minute.
          list.shifts.some((shift) => shift.id === heroShift.id) || reportOpensAt(heroShift) <= now
          ? { kind: 'due' }
          : { kind: 'later' };
  // Away from the team, that is the day's one state: no shift is his to hold (CHAT-09).
  const away = myAwayOf(user);
  return (
    <div className="sc-today">
      {away === null ? (
        <Hero
          state={state}
          now={now}
          zone={zone}
          today={today}
          report={report}
          onReport={() => {
            if (heroShift !== null) onReport(heroShift.id);
          }}
        />
      ) : (
        <MyAwayCard status={away} />
      )}
      <TodoCard user={user} reports={reports} heroShiftId={heroShift?.id ?? null} onReport={onReport} />
      <MyReportsCard reports={reports} heroShiftId={heroShift?.id ?? null} zone={zone} onOpen={onReport} />
      {next === null ? null : <NextCard shift={next} now={now} zone={zone} today={today} />}
      <Link to="/planning" className="sc-more">
        Tout mon planning
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m6 3.5 4.5 4.5-4.5 4.5" />
        </svg>
      </Link>
    </div>
  );
}

/** « dans 3 h 05 » within a day; further ahead, the day beside it says it better than « dans 2 jours ». */
const soonOf = (milliseconds: number): string | null =>
  milliseconds < 86_400_000 ? untilOf(milliseconds) : null;

/** The report of the hero's shift: not open yet, to make now, or made (and how it stands). */
type HeroReport =
  { readonly kind: 'none' | 'later' | 'due' } | { readonly kind: 'made'; readonly report: ShiftReport };

/** When a shift takes its report: `SHIFT_REPORT_OPENS_BEFORE_END_MINUTES` before its end, never before its start. */
const reportOpensAt = (shift: MyShift): Date =>
  new Date(
    Math.max(
      new Date(shift.startsAt).getTime(),
      new Date(shift.endsAt).getTime() - SHIFT_REPORT_OPENS_BEFORE_END_MINUTES * 60_000,
    ),
  );

function Hero({
  state,
  now,
  zone,
  today,
  report,
  onReport,
}: {
  state: DayState;
  now: Date;
  zone: string;
  today: string;
  report: HeroReport;
  onReport: () => void;
}): JSX.Element {
  if (state.kind === 'none') {
    return (
      <Panel className="sc-hero sc-hero--none nv-enter">
        <p className="sc-hero__kicker">Aucun shift prévu</p>
        <h2 className="sc-hero__title">Rien pour l’instant</h2>
        <p className="sc-hero__note">
          Ton responsable te place sur le planning : ton prochain shift s’affichera ici.
        </p>
      </Panel>
    );
  }
  const { shift } = state;
  const left = new Date(shift.endsAt).getTime() - now.getTime();
  // What waits in Suivi, said on the way in: the shift's one job is there (D-03). Nothing before Suivi opens.
  const queue = useQuery({ ...todosAcrossQuery, enabled: state.kind !== 'later' });
  const waiting = queue.data?.items.length ?? 0;
  // An AI outage behind twenty fans is one urgency, as Suivi shows it (« urgent panne », 06/11).
  const urgent = urgencies(queue.data?.items ?? []);
  const toStart = new Date(shift.startsAt).getTime() - now.getTime();
  return (
    <Panel className={`sc-hero sc-hero--${state.kind} nv-enter`}>
      <div className="sc-hero__top">
        <span className={`nv-status sc-state sc-state--${state.kind}`}>
          <span
            // A shift that ended is a normal state, not a warning: a neutral dot, the amber stays the report's (DASH-25).
            className={`nv-dot ${state.kind === 'on' ? 'nv-tone--ok nv-dot--live' : state.kind === 'soon' ? 'nv-tone--warn' : ''}`}
          />
          {state.kind === 'on'
            ? 'En poste'
            : state.kind === 'ended'
              ? 'Shift fini'
              : state.kind === 'soon'
                ? 'Bientôt en poste'
                : 'Prochain shift'}
        </span>
        <span className="sc-hero__when nv-num">
          {state.kind === 'on'
            ? `encore ${lengthOf(left)}`
            : state.kind === 'ended'
              ? // The hours below say when it ended; no window of Suivi is promised (CHAT-02).
                null
              : soonOf(toStart)}
        </span>
      </div>
      <div className="sc-hero__who">
        <h2 className="sc-hero__title">{shift.creatorName}</h2>
        <p className="sc-hero__where">{accountLine(shift)}</p>
      </div>
      <p className="sc-hero__hours nv-num">
        {state.kind === 'later' ? (
          <span className="sc-hero__day">{dayWordOf(shift.startsAt, zone, today)}</span>
        ) : null}
        {rangeAt(shift.startsAt, shift.endsAt, zone)}
      </p>
      {state.kind === 'on' ? (
        <div
          className="nv-gauge sc-hero__gauge"
          role="progressbar"
          aria-label="Avancée du shift"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressOf(shift, now) * 100)}
          style={{ '--nv-gauge-value': `${String(Math.round(progressOf(shift, now) * 1000) / 10)}%` }}
        >
          <span className="nv-gauge__fill" />
        </div>
      ) : null}
      <p className="sc-hero__note">{noteOf(state, zone)}</p>
      {urgent === 0 || state.kind === 'later' ? null : (
        <p className="td-urgent">
          <span className="nv-dot nv-tone--bad" aria-hidden="true" />
          {urgent === 1 ? '1 urgence à traiter d’abord' : `${String(urgent)} urgences à traiter d’abord`}
        </p>
      )}
      {state.kind === 'later' ? null : (
        <div className="sc-hero__actions">
          {report.kind === 'due' ? (
            <button type="button" className="nv-btn nv-btn--neon rp-hero__go" onClick={onReport}>
              Faire mon rapport
            </button>
          ) : null}
          {/* The report, when due, takes the light; otherwise Suivi does, the shift's work being there. */}
          <Link
            to="/suivi"
            className={`nv-btn ${report.kind === 'due' ? 'nv-btn--soft' : 'nv-btn--neon'}`}
            aria-label={waiting === 0 ? 'Ouvrir Suivi' : `Ouvrir Suivi, ${String(waiting)} à traiter`}
          >
            Ouvrir Suivi
            {waiting === 0 ? null : (
              <span className="td-suivi__count nv-num" aria-hidden="true">
                {waiting} à traiter
              </span>
            )}
          </Link>
          {report.kind === 'made' ? (
            <button type="button" className="rp-hero__made nv-tap" onClick={onReport}>
              <span className={`rp-chip rp-chip--${STATUS_TONES[report.report.status]}`}>
                Rapport {MEMBER_STATUS[report.report.status].toLowerCase()}
              </span>
              <span className="rp-hero__see">Voir</span>
            </button>
          ) : report.kind === 'later' && state.kind === 'on' ? (
            <span className="rp-hero__later nv-num">
              Rapport à partir de {clockAt(reportOpensAt(state.shift), zone)}
            </span>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

/**
 * What Impera brings him around his shift, in one line: the account line already says the platform. Until EQ-13 opens a
 * shift's conversations in Suivi, only the passations handed to him arrive there: no window is promised (CHAT-02).
 */
function noteOf(state: Exclude<DayState, { kind: 'none' }>, zone: string): string {
  const { shift } = state;
  switch (state.kind) {
    case 'on':
      return 'Les passations qu’on te confie arrivent dans Suivi.';
    case 'ended':
      return 'Ton shift est fini. Les passations qu’on t’a confiées restent dans Suivi.';
    case 'soon':
      return `Ton shift commence à ${clockAt(shift.startsAt, zone)}. Les passations qu’on te confie arrivent dans Suivi.`;
    case 'later':
      return 'Les passations qu’on te confie arriveront dans Suivi.';
  }
}

function NextCard({
  shift,
  now,
  zone,
  today,
}: {
  shift: MyShift;
  now: Date;
  zone: string;
  today: string;
}): JSX.Element {
  const soon = soonOf(new Date(shift.startsAt).getTime() - now.getTime());
  return (
    <Panel className="sc-next nv-enter">
      <p className="nv-eyebrow">Ensuite</p>
      <div className="sc-next__row">
        <div className="sc-next__main">
          <p className="sc-next__who">{shift.creatorName}</p>
          <p className="sc-next__where">{accountLine(shift)}</p>
        </div>
        <div className="sc-next__side">
          <p className="sc-next__hours nv-num">
            {dayWordOf(shift.startsAt, zone, today)} · {rangeAt(shift.startsAt, shift.endsAt, zone)}
          </p>
          {soon === null ? null : <p className="sc-next__in">{soon}</p>}
        </div>
      </div>
    </Panel>
  );
}
