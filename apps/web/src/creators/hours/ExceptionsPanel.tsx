import {
  SetAgentHourExceptionBodySchema,
  type AgentHourExceptionsView,
  type AgentHours,
  type DayRange,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { Segment } from '../persona/fields';

import { HOURS_ERRORS, hoursErrorKind } from './api';
import { exceptionsQueryKey, removeException, saveException, useAgentHourExceptions } from './exceptions-api';
import {
  dateWords,
  dayWords,
  endOf,
  fromToWords,
  gridDays,
  openedBeyondWeek,
  sortedRanges,
  spanWords,
} from './exceptions-model';

import { TimeField, useUnreadableTimes } from '@/scheduling/TimeField';
import { PasswordPrompt } from '@/settings/services/PasswordPrompt';
import { ReauthRequired } from '@/settings/services/api';

/** A day the editor opens on: 9 h to midnight, the usual day of her AI. */
const NEW_DAY: readonly DayRange[] = [{ startMinute: 9 * 60, endMinute: 1440 }];

interface Editing {
  readonly date: string;
  readonly ranges: readonly DayRange[];
  readonly off: boolean;
}

/**
 * « Jours modifiés » (ADR 0148 § 3): a date can leave her week; that day her ranges replace the week's, none is « pas
 * d'IA ce jour-là ». A past date no longer changes; one ahead can be set back (« Rétablir »). Her switch (Arrêt, pause,
 * global) always wins over a day. What a day opens beyond her week is said plainly (Sécurité, relecture de #865).
 */
export function ExceptionsPanel({
  creatorId,
  hours,
}: {
  creatorId: string;
  /** Her week as stored, to say what a day opens beyond it. */
  hours: AgentHours;
}): JSX.Element {
  const query = useAgentHourExceptions(creatorId);
  if (query.data === undefined) {
    return (
      <section
        className="nv-plate ps-panel"
        aria-labelledby="hr-days"
        aria-busy={!query.isError || undefined}
      >
        <p className="nv-eyebrow" id="hr-days">
          Jours modifiés
        </p>
        {query.isError ? <p className="ps-muted">{HOURS_ERRORS[hoursErrorKind(query.error)]}</p> : null}
      </section>
    );
  }
  return <Days creatorId={creatorId} hours={hours} view={query.data} />;
}

function Days({
  creatorId,
  hours,
  view,
}: {
  creatorId: string;
  hours: AgentHours;
  view: AgentHourExceptionsView;
}): JSX.Element {
  const client = useQueryClient();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reauth, setReauth] = useState<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);
  const times = useUnreadableTimes();
  const ahead = view.exceptions.filter((exception) => exception.date >= view.today);
  const kept = new Map(ahead.map((exception) => [exception.date, exception] as const));

  const run = async (write: () => Promise<AgentHourExceptionsView>, done: string): Promise<void> => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      client.setQueryData(exceptionsQueryKey(creatorId), await write());
      // Her switch in the header says whether she is in her hours: read again at once, not a minute later (CODE-03).
      void client.invalidateQueries({ queryKey: ['dashboard', 'creators'] });
      void client.invalidateQueries({ queryKey: ['dashboard', creatorId] });
      setEditing(null);
      setNotice(done);
    } catch (error) {
      if (error instanceof ReauthRequired) setReauth(() => () => void run(write, done));
      else setProblem(HOURS_ERRORS[hoursErrorKind(error)]);
    } finally {
      setBusy(false);
    }
  };

  const open = (date: string): void => {
    const exception = kept.get(date);
    setProblem(null);
    setNotice(null);
    setEditing(
      exception === undefined
        ? { date, ranges: NEW_DAY, off: false }
        : {
            date,
            ranges: exception.ranges.length === 0 ? NEW_DAY : exception.ranges,
            off: exception.ranges.length === 0,
          },
    );
  };

  const ranges = editing === null ? [] : editing.off ? [] : sortedRanges(editing.ranges);
  const checked = SetAgentHourExceptionBodySchema.safeParse({ ranges });
  const issue = checked.success ? null : (checked.error.issues[0]?.message ?? 'Une plage est à corriger');
  const beyond =
    editing === null || !checked.success ? [] : openedBeyondWeek(hours, view.timeZone, editing.date, ranges);

  return (
    <section className="nv-plate ps-panel" aria-labelledby="hr-days">
      <div className="ps-block hr-days">
        <p className="nv-eyebrow" id="hr-days">
          Jours modifiés
        </p>
        <p className="ps-hint">
          Un jour peut sortir de la semaine type : ce jour-là, ses plages remplacent celles de la semaine. La
          pause et l’arrêt l’emportent toujours.
        </p>
        {ahead.length === 0 ? (
          <p className="ps-muted">Aucun jour modifié : l’IA suit sa semaine type.</p>
        ) : (
          <ul className="hr-days__list">
            {ahead.map((exception) => {
              const day = dateWords(exception.date, view.today);
              return (
                <li key={exception.date} className="hr-days__item">
                  {/* The whole line opens the day; « Rétablir » stays its own button (avis Design, 19/11). */}
                  <button
                    type="button"
                    className="hr-days__row"
                    aria-label={`Modifier ${day}`}
                    aria-pressed={editing?.date === exception.date}
                    disabled={busy}
                    onClick={() => {
                      open(exception.date);
                    }}
                  >
                    <span className="hr-days__date">{day}</span>
                    <span className={exception.ranges.length === 0 ? 'hr-days__off' : 'hr-days__ranges'}>
                      {dayWords(exception.ranges)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="nv-iconbtn hr-days__icon"
                    aria-label={`Rétablir ${day}`}
                    title="Rétablir la semaine type"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => removeException(creatorId, exception.date),
                        `${day} suit de nouveau sa semaine type.`,
                      )
                    }
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {editing === null ? (
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm hr-days__ghost"
            onClick={() => {
              open(view.today);
            }}
          >
            Modifier un jour
          </button>
        ) : (
          <div className="hr-days__editor">
            <DayGrid
              today={view.today}
              picked={editing.date}
              kept={kept}
              onPick={(date) => {
                open(date);
              }}
            />
            <Segment
              label="Ce jour-là"
              options={[
                { value: 'ranges', label: 'Ses plages' },
                { value: 'off', label: 'Pas d’IA' },
              ]}
              value={editing.off ? 'off' : 'ranges'}
              onChange={(value) => {
                setEditing({ ...editing, off: value === 'off' });
              }}
            />
            {editing.off ? null : (
              <div className="hr-days__ranges-edit">
                {editing.ranges.map((range, index) => (
                  <div key={index} className="hr-days__range">
                    <span className="ps-hint">de</span>
                    <TimeField
                      className="hr-time"
                      value={range.startMinute}
                      label={`Plage ${String(index + 1)} : début`}
                      onChange={(startMinute) => {
                        setEditing({
                          ...editing,
                          ranges: editing.ranges.with(index, { ...range, startMinute }),
                        });
                      }}
                      onUnreadable={times.onUnreadable}
                    />
                    <span className="ps-hint">à</span>
                    <TimeField
                      className="hr-time"
                      value={range.endMinute % 1440}
                      label={`Plage ${String(index + 1)} : fin`}
                      onChange={(minute) => {
                        setEditing({
                          ...editing,
                          ranges: editing.ranges.with(index, { ...range, endMinute: endOf(minute) }),
                        });
                      }}
                      onUnreadable={times.onUnreadable}
                    />
                    <span className="ps-hint hr-days__midnight">
                      {range.endMinute === 1440 ? 'minuit' : ''}
                    </span>
                    {editing.ranges.length > 1 ? (
                      <button
                        type="button"
                        className="nv-iconbtn hr-days__icon"
                        aria-label={`Supprimer la plage ${String(index + 1)}`}
                        onClick={() => {
                          setEditing({ ...editing, ranges: editing.ranges.filter((_, at) => at !== index) });
                        }}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m7 7 10 10M17 7 7 17" />
                        </svg>
                      </button>
                    ) : (
                      <span className="hr-days__icon-gap" aria-hidden="true" />
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="nv-btn nv-btn--plain nv-btn--sm hr-days__ghost"
                  onClick={() => {
                    setEditing({
                      ...editing,
                      ranges: [...editing.ranges, { startMinute: 0, endMinute: 240 }],
                    });
                  }}
                >
                  Ajouter une plage
                </button>
              </div>
            )}
            {issue === null ? null : <p className="ps-error">{issue}</p>}
            {beyond.length === 0 ? null : (
              <p className="hr-days__beyond" role="note">
                Ce jour-là, l’IA répondra aussi {fromToWords(beyond)}, hors de sa semaine type.
              </p>
            )}
            <div className="hr-days__foot">
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm hr-days__ghost"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                }}
              >
                Annuler
              </button>
              <button
                type="button"
                className="nv-btn nv-btn--neon nv-btn--sm"
                disabled={busy || issue !== null || times.unreadable}
                onClick={() =>
                  void run(
                    () => saveException(creatorId, editing.date, ranges),
                    `${dateWords(editing.date, view.today)} : ${dayWords(ranges)}.`,
                  )
                }
              >
                Enregistrer ce jour
              </button>
            </div>
          </div>
        )}
        {reauth === null ? null : (
          <PasswordPrompt
            lead="Pour changer un jour, confirme ton mot de passe et ton code."
            onConfirmed={() => {
              const again = reauth;
              setReauth(null);
              again();
            }}
            onCancel={() => {
              setReauth(null);
            }}
          />
        )}
        {problem === null ? null : (
          <p className="ps-error" role="alert">
            {problem}
          </p>
        )}
        {notice === null ? null : (
          <p className="ps-hint" role="status">
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'] as const;
const WEEKDAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;
/** How far ahead the grid goes, in its pages of two weeks. */
const PAGES = 4;

/**
 * The days to pick from (avis Design, 19/11): two weeks a page, seven columns under L M M J V S D, the day's number in
 * its cell. A past day cannot be picked; one with a change of its own carries a violet dot; today is said quietly.
 */
function DayGrid({
  today,
  picked,
  kept,
  onPick,
}: {
  today: string;
  picked: string;
  kept: ReadonlyMap<string, unknown>;
  onPick: (date: string) => void;
}): JSX.Element {
  const [page, setPage] = useState(0);
  const days = gridDays(today, page);
  const first = days[0] ?? today;
  const last = days.at(-1) ?? today;
  return (
    <div className="hr-grid">
      <div className="hr-grid__head">
        <span className="hr-grid__span">{spanWords(first, last)}</span>
        <span className="hr-grid__nav">
          <button
            type="button"
            className="nv-iconbtn hr-days__icon"
            aria-label="Deux semaines plus tôt"
            disabled={page === 0}
            onClick={() => {
              setPage(page - 1);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m14 6-6 6 6 6" />
            </svg>
          </button>
          <button
            type="button"
            className="nv-iconbtn hr-days__icon"
            aria-label="Deux semaines plus tard"
            disabled={page === PAGES - 1}
            onClick={() => {
              setPage(page + 1);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m10 6 6 6-6 6" />
            </svg>
          </button>
        </span>
      </div>
      <div className="hr-grid__days" role="group" aria-label="Quel jour">
        {WEEKDAYS.map((letter, index) => (
          <span key={index} className="hr-grid__weekday" aria-hidden="true">
            {letter}
          </span>
        ))}
        {days.map((date, index) => (
          <button
            key={date}
            type="button"
            className="hr-grid__day"
            aria-label={`${WEEKDAY_NAMES[index % 7] ?? ''} ${String(Number(date.slice(8, 10)))}${date === today ? ', aujourd’hui' : ''}${kept.has(date) ? ', modifié' : ''}`}
            aria-pressed={date === picked}
            data-today={date === today || undefined}
            data-kept={kept.has(date) || undefined}
            disabled={date < today}
            onClick={() => {
              onPick(date);
            }}
          >
            {Number(date.slice(8, 10))}
          </button>
        ))}
      </div>
    </div>
  );
}
