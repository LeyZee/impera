import { SHIFT_REPORT_OPENS_BEFORE_END_MINUTES, type MyShift, type ShiftReport } from '@nirvana/contracts';
import { Link } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { MyReportsCard, useMyReports, type MyReports } from '@/reports/MyReports';
import { ReportPanel } from '@/reports/ReportPanel';
import { MEMBER_STATUS, reportOf, STATUS_TONES } from '@/reports/model';
import { useReopening, type ReportDraft } from '@/reports/reopen';
import '@/reports/reports.css';
import { useMyShifts } from '@/scheduling/api';
import { accountLine, dayStateOf, platformName, progressOf, type DayState } from '@/scheduling/model';
import '@/scheduling/scheduling.css';
import { addDays, clockAt, dayOf, lengthOf, longDay, rangeAt, readerZone, untilOf } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { ServerSilent } from '@/shell/ServerSilent';
import { Page, PageHeader, Panel } from '@/shell/layout';

/**
 * Aujourd'hui (ADR 0024, EQ-02, EQ-03): the chatter's shift first, where to go and until when, and « Faire mon
 * rapport » as it ends; then the reports left to do and the period's, then the next shift. Read in the chatter's own
 * time, the browser's. The goal and the announcements come with their own cards.
 */
export function TodayPage(): JSX.Element {
  const mine = useMyShifts();
  const now = useNow();
  const zone = readerZone();
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
      <PageHeader
        eyebrow={longDay(today)}
        title="Aujourd’hui"
        lead="Ton shift, où aller et jusqu’à quand, puis tes rapports à faire."
      />
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
        />
      )}
      {open === null ? null : (
        <ReportPanel
          key={open.shiftId + (open.draft?.id ?? '')}
          shiftId={open.shiftId}
          draft={open.draft}
          from="/aujourdhui"
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
}: {
  state: DayState;
  now: Date;
  zone: string;
  today: string;
  reports: MyReports;
  onReport: (shiftId: string) => void;
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
  return (
    <div className="sc-today">
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
      <MyReportsCard reports={reports} heroShiftId={heroShift?.id ?? null} onOpen={onReport} />
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

/** « Aujourd'hui », « Demain » or « jeudi 29 octobre »: the day of a shift, in the chatter's time. */
function dayWord(instant: string, zone: string, today: string): string {
  const day = dayOf(instant, zone);
  if (day === today) return 'Aujourd’hui';
  if (day === addDays(today, 1)) return 'Demain';
  const long = longDay(day);
  return long.charAt(0).toUpperCase() + long.slice(1);
}

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
              ? `Suivi ouvert encore ${lengthOf(new Date(shift.accessEndsAt).getTime() - now.getTime())}`
              : soonOf(toStart)}
        </span>
      </div>
      <div className="sc-hero__who">
        <h2 className="sc-hero__title">{shift.creatorName}</h2>
        <p className="sc-hero__where">{accountLine(shift)}</p>
      </div>
      <p className="sc-hero__hours nv-num">
        {state.kind === 'later' ? (
          <span className="sc-hero__day">{dayWord(shift.startsAt, zone, today)}</span>
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
      {state.kind === 'later' ? null : (
        <div className="sc-hero__actions">
          {report.kind === 'due' ? (
            <button type="button" className="nv-btn nv-btn--neon rp-hero__go" onClick={onReport}>
              Faire mon rapport
            </button>
          ) : null}
          <Link to="/suivi" className="nv-btn nv-btn--soft">
            Ouvrir Suivi
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

/** What the state means for Nirvana: when the creator's conversations open and close (ADR 0025). */
function noteOf(state: Exclude<DayState, { kind: 'none' }>, zone: string): string {
  const { shift } = state;
  const name = shift.creatorName;
  switch (state.kind) {
    case 'on':
      return `Tu chattes sur ${platformName(shift.platform)}. Dans Nirvana, les conversations de ${name} restent ouvertes jusqu’à ${clockAt(shift.accessEndsAt, zone)}.`;
    case 'ended':
      return `Les conversations de ${name} restent ouvertes dans Suivi jusqu’à ${clockAt(shift.accessEndsAt, zone)}, le temps de finir.`;
    case 'soon':
      return `Les conversations de ${name} sont déjà ouvertes dans Suivi. Ton shift commence à ${clockAt(shift.startsAt, zone)}.`;
    case 'later':
      return `Les conversations de ${name} s’ouvriront dans Suivi à ${clockAt(shift.accessStartsAt, zone)}.`;
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
            {dayWord(shift.startsAt, zone, today)} · {rangeAt(shift.startsAt, shift.endsAt, zone)}
          </p>
          {soon === null ? null : <p className="sc-next__in">{soon}</p>}
        </div>
      </div>
    </Panel>
  );
}
