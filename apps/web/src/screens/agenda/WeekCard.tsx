import {
  SHOOT_ITEM_LATE_UNPROCESSABLE,
  SHOOT_ITEM_NOT_ACCEPTED_UNPROCESSABLE,
  type HerDelivery,
  type HerShootDay,
  type ShootItem,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { NOT_SENT, type Outcome } from './api';
import { acceptWeek, readWeekAgain, tickShootItem, useCreatorWeek } from './week-api';
import {
  dayWhen,
  droppedOf,
  dueIn,
  dueShort,
  hasWeek,
  leftToDrop,
  NEED_WORDS,
  progressOf,
  shootDaysWords,
  shotOf,
} from './week-model';
import './week-card.css';

import { longDay } from '@/scheduling/time';

/** What a refused or unsent gesture of her week says, in her words. */
function failureOf(outcome: Exclude<Outcome<null>, { kind: 'ok' }>): string {
  if (outcome.kind !== 'refused') return NOT_SENT[outcome.kind];
  if (outcome.code === SHOOT_ITEM_LATE_UNPROCESSABLE)
    return 'Ce jour de tournage date de plus de deux jours : ses coches ne changent plus.';
  if (outcome.code === SHOOT_ITEM_NOT_ACCEPTED_UNPROCESSABLE)
    return 'Accepte d’abord ta semaine, puis coche.';
  return 'Ta semaine a changé entre-temps. Elle est relue.';
}

/**
 * Her week of shooting (ADR 0140), above her agenda, read in a few seconds: three steps (shoot on her days, drop
 * everything, before Sunday night), then each « Jour de tournage » with what there is to shoot, to tick line by line,
 * and what is left to drop, which fills itself with her drops. She accepts it in one gesture; she never reads how it
 * was computed, nor the minutes the agency counts. Nothing shows until the agency sent her week.
 */
export function WeekCard({
  monday,
  zone,
  today,
}: {
  monday: string;
  zone: string;
  today: string;
}): JSX.Element | null {
  const client = useQueryClient();
  const read = useCreatorWeek(monday);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const week = read.data;
  if (week === undefined || !hasWeek(week)) return null;

  const run = (key: string, gesture: Promise<Outcome<null>>): void => {
    setBusy(key);
    setFailed(null);
    void gesture.then(async (outcome) => {
      if (outcome.kind !== 'ok') setFailed(failureOf(outcome));
      await readWeekAgain(client);
      setBusy(null);
    });
  };

  const days = week.shootDays.filter((day) => day.state !== 'declined');
  const shot = shotOf(days);
  const dropped = week.delivery === null ? null : droppedOf(week.delivery.lines);
  return (
    <article className="wk-card nv-plate" data-cat="shoot" aria-labelledby="wk-title">
      <header className="wk-head">
        <WeekMark />
        <div className="wk-heading">
          <span className="wk-tag">De l’agence</span>
          <b id="wk-title" className="wk-title">
            Ta semaine de tournage
          </b>
        </div>
      </header>
      <ol className="wk-steps" aria-label="Ta semaine en trois étapes">
        <Step
          n={1}
          icon="shoot"
          verb="Tourne"
          what={days.length === 0 ? 'rien cette semaine' : shootDaysWords(days)}
          done={shot.total > 0 && shot.done === shot.total}
        />
        {dropped === null ? null : (
          <Step
            n={2}
            icon="drop"
            verb="Dépose"
            what={`${String(dropped.done)} sur ${String(dropped.total)}`}
            done={week.delivery?.delivered ?? false}
          />
        )}
        {week.delivery === null ? null : (
          <Step
            n={3}
            icon="clock"
            verb="Avant"
            what={dueShort(week.delivery.dueAt, zone)}
            hint={dueIn(week.delivery.dueAt, zone, today)}
            done={week.delivery.delivered}
          />
        )}
      </ol>
      {week.toAccept ? (
        <div className="wk-ask">
          <p className="wk-ask__text">
            L’agence a préparé ta semaine. Si elle te va, accepte-la : tes jours de tournage arrivent dans ton
            agenda et tu pourras cocher au fur et à mesure.
          </p>
          <button
            type="button"
            className="nv-btn nv-btn--neon wk-ask__go"
            disabled={busy !== null}
            aria-busy={busy === 'accept'}
            onClick={() => {
              run('accept', acceptWeek(monday));
            }}
          >
            Accepter ma semaine
          </button>
        </div>
      ) : null}
      {failed === null ? null : (
        <p className="wk-failed" role="alert">
          {failed}
        </p>
      )}
      <div className="wk-days">
        {days.map((day) => (
          <ShootDay
            key={day.suggestionId}
            day={day}
            today={today}
            busy={busy}
            onTick={(item) => {
              run(item.id, tickShootItem(item.id, !item.done));
            }}
          />
        ))}
      </div>
      {week.delivery === null ? null : <Delivery delivery={week.delivery} zone={zone} today={today} />}
    </article>
  );
}

type IconName = 'shoot' | 'drop' | 'clock' | ShootItem['need'];

/** The small drawn marks of her week: one per kind of thing she shoots, never a stock icon. */
function Icon({ name }: { name: IconName }): JSX.Element {
  return (
    <svg className="wk-icon" viewBox="0 0 24 24" aria-hidden="true">
      {name === 'shoot' || name === 'feed_shoot' ? (
        <>
          <path
            className="wk-icon__fill"
            d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z"
          />
          <circle cx="12" cy="13" r="3.2" />
        </>
      ) : name === 'feed_video' ? (
        <>
          <rect className="wk-icon__fill" x="3.5" y="6" width="17" height="12" rx="2.5" />
          <path className="wk-icon__ink" d="m10.5 9.5 4 2.5-4 2.5Z" />
        </>
      ) : name === 'reveal_story' ? (
        <>
          <rect className="wk-icon__fill" x="7" y="3" width="10" height="18" rx="2.5" />
          <circle cx="12" cy="10" r="2.2" />
          <path d="M9.5 16.5h5" />
        </>
      ) : name === 'script' ? (
        <>
          <path className="wk-icon__fill" d="M6 4h9l3 3v13H6Z" />
          <path d="M9 11h6M9 14.5h6" />
        </>
      ) : name === 'idea' ? (
        <>
          <path
            className="wk-icon__fill"
            d="M12 3.5a5.5 5.5 0 0 0-3.2 10c.8.6 1.2 1.4 1.2 2.2h4c0-.8.4-1.6 1.2-2.2a5.5 5.5 0 0 0-3.2-10Z"
          />
          <path d="M10 19h4" />
        </>
      ) : name === 'mass_dm' ? (
        <>
          <rect className="wk-icon__fill" x="3.5" y="6" width="17" height="12" rx="2.5" />
          <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
        </>
      ) : name === 'drop' ? (
        <>
          <path className="wk-icon__fill" d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
          <path d="M12 15V4.5M7.5 9 12 4.5 16.5 9" />
        </>
      ) : (
        <>
          <circle className="wk-icon__fill" cx="12" cy="12.5" r="8" />
          <path d="M12 8.5v4l2.8 1.8" />
        </>
      )}
    </svg>
  );
}

/** One of the three steps of her week: what to do, and its word for this week. */
function Step({
  n,
  icon,
  verb,
  what,
  hint,
  done,
}: {
  n: number;
  icon: IconName;
  verb: string;
  what: string;
  hint?: string;
  done: boolean;
}): JSX.Element {
  return (
    <li className="wk-step" data-done={done || undefined} data-late={hint === 'passé' || undefined}>
      <span className="wk-step__mark">
        <Icon name={icon} />
        <span className="wk-step__n nv-num" aria-hidden="true">
          {done ? '✓' : n}
        </span>
      </span>
      <span className="wk-step__verb">{verb}</span>
      <span className="wk-step__what nv-num">{what}</span>
      {hint === undefined ? null : <span className="wk-step__hint">{hint}</span>}
    </li>
  );
}

/** A clapperboard, the mark of her week: the game's, never a stock icon. */
function WeekMark(): JSX.Element {
  return (
    <span className="wk-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path className="wk-mark__board" d="M4 10h16v9.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5Z" />
        <path className="wk-mark__clap" d="m3.6 6.6 15.2-3.4.9 3.9-15.2 3.4Z" />
        <path className="wk-mark__stripes" d="m7.5 5.7 2 3.2M11.5 4.8l2 3.2M15.5 3.9l2 3.2" />
      </svg>
    </span>
  );
}

function ShootDay({
  day,
  today,
  busy,
  onTick,
}: {
  day: HerShootDay;
  today: string;
  busy: string | null;
  onTick: (item: ShootItem) => void;
}): JSX.Element {
  const { done, total } = progressOf(day);
  const open = day.state === 'accepted' && day.taskId !== null;
  const when = dayWhen(day.day, today);
  return (
    <section
      className="wk-day"
      aria-label={`Jour de tournage, ${longDay(day.day)}`}
      data-today={day.day === today || undefined}
      data-full={(total > 0 && done === total) || undefined}
    >
      <div className="wk-day__head">
        <b className="wk-day__date">{longDay(day.day)}</b>
        <span className="wk-day__when">{when}</span>
        <span className="wk-day__count nv-num" aria-label={`${String(done)} sur ${String(total)} tournés`}>
          {done} / {total}
        </span>
      </div>
      <span className="wk-bar" aria-hidden="true">
        <i style={{ width: `${total === 0 ? '0' : ((done / total) * 100).toFixed(1)}%` }} />
      </span>
      <ul className="wk-lines">
        {day.items.map((item) => (
          <li key={item.id} className="wk-line" data-done={item.done ? 'true' : undefined}>
            {open ? (
              <button
                type="button"
                className="ag-check"
                data-cat="shoot"
                aria-pressed={item.done}
                aria-busy={busy === item.id}
                disabled={busy !== null}
                aria-label={item.done ? `Décocher ${item.label}` : `Cocher ${item.label}`}
                onClick={() => {
                  onTick(item);
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m3.5 8.5 3 3 6-7" />
                </svg>
              </button>
            ) : (
              <span className="wk-line__kind" aria-hidden="true">
                <Icon name={item.need} />
              </span>
            )}
            {item.sheet === null ? (
              <div className="wk-line__body">
                <span className="wk-line__label">{item.label}</span>
              </div>
            ) : (
              // The whole line opens its shooting sheet; its first words show before, the tick stays its own target.
              <details className="wk-line__body wk-line__sheet">
                <summary className="wk-line__summary">
                  <span className="wk-line__words">
                    <span className="wk-line__label">{item.label}</span>
                    <span className="wk-line__peek">{item.sheet}</span>
                  </span>
                  <svg className="wk-line__chevron" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m6 3 5 5-5 5" />
                  </svg>
                </summary>
                <p className="wk-line__text">{item.sheet}</p>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Delivery({
  delivery,
  zone,
  today,
}: {
  delivery: HerDelivery;
  zone: string;
  today: string;
}): JSX.Element {
  const left = leftToDrop(delivery.lines);
  const due = dueIn(delivery.dueAt, zone, today);
  return (
    <section className="wk-delivery" aria-label="À déposer" data-delivered={delivery.delivered || undefined}>
      <div className="wk-day__head">
        <b className="wk-day__date">À déposer</b>
        {delivery.delivered ? (
          <span className="wk-done">Tout est arrivé, merci</span>
        ) : (
          <span className="wk-day__when nv-num" data-late={due === 'passé' || undefined}>
            avant {dueShort(delivery.dueAt, zone)}
          </span>
        )}
      </div>
      <ul className="wk-tally">
        {delivery.lines.map((line) => {
          const got = Math.min(line.received, line.asked);
          return (
            <li key={line.need} className="wk-tally__line" data-full={got >= line.asked || undefined}>
              <span className="wk-line__kind" aria-hidden="true">
                <Icon name={line.need} />
              </span>
              <span className="wk-tally__word">{NEED_WORDS[line.need]}</span>
              <span className="wk-tally__count nv-num">
                {got} / {line.asked}
              </span>
              <span className="wk-bar wk-tally__bar" aria-hidden="true">
                <i
                  style={{ width: `${line.asked === 0 ? '100' : ((got / line.asked) * 100).toFixed(1)}%` }}
                />
              </span>
            </li>
          );
        })}
      </ul>
      {left.length === 0 ? null : (
        <Link to="/contenu" className="nv-btn nv-btn--soft wk-drop">
          <Icon name="drop" />
          Déposer mes contenus
        </Link>
      )}
    </section>
  );
}
