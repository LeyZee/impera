import {
  REPORT_SIGNAL_CATEGORIES,
  type PayPeriod,
  type PlanningMember,
  type ShiftFeedbackLine,
  type ShiftFeedbackList,
  type ShiftIncidentStep,
} from '@impera/contracts';
import { useState, type JSX } from 'react';

import { IncidentTrack, SignalChips } from '@/reports/FeedbackPanel';
import {
  FEEDBACK_ERRORS,
  incidentStage,
  SIGNAL_CATEGORIES,
  STAGE_WORDS,
  stepIncident,
  useRefreshFeedbacks,
  useShiftFeedbacks,
} from '@/reports/feedback';
import { periodLine } from '@/reports/model';
import { accountLine, swapShiftLine } from '@/scheduling/model';
import { dayOf } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { Panel } from '@/shell/layout';
import { Failure } from '@/shell/states';

/** A member's colour on their swatch, or the swatch's own grey. */
const swatchOf = (member: PlanningMember | undefined): { '--sc-color': string } | undefined =>
  member?.color === null || member === undefined ? undefined : { '--sc-color': member.color };

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count > 1 ? many : one}`;

/** Who and where a feedback is from, on one line. */
function Whose({
  line,
  list,
  zone,
}: {
  line: ShiftFeedbackLine;
  list: ShiftFeedbackList;
  zone: string;
}): JSX.Element {
  const member = list.members.find((one) => one.id === line.memberId);
  const account = list.accounts.find((one) => one.id === line.platformAccountId);
  return (
    <div className="rp-fb__whose">
      <p className="rp-fb__who">
        <span className="sc-swatch" style={swatchOf(member)} aria-hidden="true" />
        {member?.displayName ?? 'Un membre'}
      </p>
      <p className="rp-fb__where">
        {account === undefined ? null : (
          <>
            <span className="rp-fb__creator">{account.creatorName}</span> · {accountLine(account)} ·{' '}
          </>
        )}
        <span className="nv-num">{swapShiftLine(line.shiftStartsAt, line.shiftEndsAt, undefined, zone)}</span>
      </p>
    </div>
  );
}

/**
 * The incidents not « Réglé » yet, first on Équipe › Rapports (trous béants n° 1): red, each with its track, « Vu » and
 * « Réglé » beside it. Absent when none waits: an urgency is never an empty card.
 */
export function IncidentsCard({ zone }: { zone: string }): JSX.Element | null {
  const open = useShiftFeedbacks(null);
  const refresh = useRefreshFeedbacks();
  const now = useNow(60_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ readonly id: string; readonly text: string } | null>(null);
  if (open.isError) {
    return (
      <Panel className="rp-incidents" eyebrow="Incidents">
        <div className="rp-sec">
          <Failure
            inline
            onRetry={() => {
              void open.refetch();
            }}
          />
        </div>
      </Panel>
    );
  }
  const list = open.data;
  if (list === undefined || list.feedbacks.length === 0) return null;
  const waiting = list.feedbacks.filter((one) => incidentStage(one) === 'sent').length;

  const say = async (line: ShiftFeedbackLine, step: ShiftIncidentStep): Promise<void> => {
    setBusy(line.id);
    setRefusal(null);
    const outcome = await stepIncident(line.id, step);
    if (outcome.kind !== 'ok') {
      setRefusal({
        id: line.id,
        text:
          outcome.kind === 'refused'
            ? FEEDBACK_ERRORS[outcome.code]
            : 'Le serveur ne répond pas : rien n’a été enregistré.',
      });
    }
    await refresh();
    setBusy(null);
  };

  return (
    <Panel
      className="rp-incidents nv-enter"
      eyebrow="Urgent"
      title={plural(list.feedbacks.length, 'incident à suivre', 'incidents à suivre')}
    >
      <div className="rp-sec">
        <p className="rp-incidents__lead">
          {waiting === 0
            ? 'Tous vus : dis « Réglé » quand c’est fini, le chatteur le voit.'
            : `${plural(waiting, 'pas encore vu', 'pas encore vus')} : le chatteur attend ta réponse.`}
        </p>
        <ul className="rp-incidents__list">
          {list.feedbacks.map((line, index) => {
            const stage = incidentStage(line);
            return (
              <li
                key={line.id}
                className="rp-incident-line nv-enter"
                style={{ '--nv-i': Math.min(index, 8) }}
                data-stage={stage ?? undefined}
                aria-busy={busy === line.id}
              >
                <div className="rp-incident-line__top">
                  <Whose line={line} list={list} zone={zone} />
                  {stage === null ? null : (
                    <span className="rp-stage" data-stage={stage}>
                      {STAGE_WORDS[stage]}
                    </span>
                  )}
                </div>
                <p className="rp-incident-line__text">{line.incident}</p>
                <IncidentTrack feedback={line} zone={zone} today={dayOf(now, zone)} />
                {refusal?.id === line.id ? <p className="tm-hint tm-hint--error">{refusal.text}</p> : null}
                <div className="rp-incident-line__acts">
                  {stage === 'sent' ? (
                    <button
                      type="button"
                      className="nv-btn nv-btn--soft"
                      disabled={busy !== null}
                      onClick={() => {
                        void say(line, 'seen');
                      }}
                    >
                      Vu
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="nv-btn nv-btn--plain rp-incident-line__done"
                    disabled={busy !== null}
                    onClick={() => {
                      void say(line, 'resolved');
                    }}
                  >
                    Réglé
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}

/** How many signals of each category a period carries, in their colours. */
function SignalBar({ list }: { list: ShiftFeedbackList }): JSX.Element | null {
  const counts = REPORT_SIGNAL_CATEGORIES.map((category) => ({
    category,
    count: list.feedbacks.reduce(
      (sum, line) => sum + line.signals.filter((signal) => signal.category === category).length,
      0,
    ),
  })).filter((one) => one.count > 0);
  const total = counts.reduce((sum, one) => sum + one.count, 0);
  if (total === 0) return null;
  return (
    <div className="rp-sigbar">
      <div className="rp-sigbar__track" aria-hidden="true">
        {counts.map((one) => (
          <span
            key={one.category}
            className="rp-sigbar__part"
            data-kind={SIGNAL_CATEGORIES[one.category].kind}
            style={{ '--rp-part': String(one.count) }}
          />
        ))}
      </div>
      <ul className="rp-sigbar__legend">
        {counts.map((one) => (
          <li key={one.category} className="rp-sigbar__key" data-kind={SIGNAL_CATEGORIES[one.category].kind}>
            {SIGNAL_CATEGORIES[one.category].label} <span className="nv-num">{one.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A period's mini feedbacks (ADR 0050 § 10), on the accounts whose pay reads the sales: what was said first in figures
 * (feedbacks, incidents, signals by category), then each one, its incident first.
 */
export function FeedbacksPanel({
  period,
  zone,
}: {
  period: PayPeriod | null;
  zone: string;
}): JSX.Element | null {
  const read = useShiftFeedbacks(period, period !== null);
  if (period === null) return null;
  if (read.isError) {
    return (
      <Panel className="rp-fbs" eyebrow="Retours de fin de shift">
        <div className="rp-sec">
          <Failure
            inline
            onRetry={() => {
              void read.refetch();
            }}
          />
        </div>
      </Panel>
    );
  }
  const list = read.data;
  if (list === undefined) {
    return (
      <Panel className="rp-fbs">
        <div className="sc-skeleton" aria-hidden="true">
          <i />
          <i />
        </div>
      </Panel>
    );
  }
  const incidents = list.feedbacks.filter((one) => one.incident !== null).length;
  const quiet = list.feedbacks.filter((one) => one.nothingToReport).length;
  return (
    <Panel
      className="rp-fbs"
      eyebrow="Retours de fin de shift"
      title={
        list.feedbacks.length === 0 ? 'Aucun retour' : plural(list.feedbacks.length, 'retour', 'retours')
      }
    >
      <div className="rp-sec">
        {list.feedbacks.length === 0 ? (
          <p className="tm-hint">
            Sur la quinzaine {periodLine(period)}, aucun retour : ils se font sur les comptes dont la paie lit
            les ventes relevées.
          </p>
        ) : (
          <>
            <div className="rp-fbs__figures">
              <p className="rp-fbs__figure" data-tone={incidents > 0 ? 'bad' : undefined}>
                <span className="rp-fbs__value nv-num">{incidents}</span>
                {incidents > 1 ? 'incidents' : 'incident'}
              </p>
              <p className="rp-fbs__figure">
                <span className="rp-fbs__value nv-num">{list.feedbacks.length - quiet}</span>
                avec un mot
              </p>
              <p className="rp-fbs__figure" data-tone="ok">
                <span className="rp-fbs__value nv-num">{quiet}</span>
                rien à signaler
              </p>
            </div>
            <SignalBar list={list} />
            <ul className="rp-fbs__list">
              {list.feedbacks.map((line, index) => {
                const stage = incidentStage(line);
                return (
                  <li key={line.id} className="rp-fb nv-enter" style={{ '--nv-i': Math.min(index, 8) }}>
                    <div className="rp-incident-line__top">
                      <Whose line={line} list={list} zone={zone} />
                      {stage === null ? (
                        line.nothingToReport ? (
                          <span className="rp-chip rp-chip--ok">Rien à signaler</span>
                        ) : null
                      ) : (
                        <span className="rp-stage" data-stage={stage}>
                          Incident · {STAGE_WORDS[stage]}
                        </span>
                      )}
                    </div>
                    {line.incident === null ? null : (
                      <p className="rp-review__incident">
                        <span className="rp-review__flag">Incident</span> {line.incident}
                      </p>
                    )}
                    {line.comment === null ? null : <p className="rp-fb__comment">« {line.comment} »</p>}
                    <SignalChips feedback={line} />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Panel>
  );
}
