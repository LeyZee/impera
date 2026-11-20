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

import { ShootBrief } from './ShootBrief';
import { NOT_SENT, type Outcome } from './api';
import { acceptWeek, readWeekAgain, tickShootItem, useCreatorWeek } from './week-api';
import { dueWords, hasWeek, leftToDrop, NEED_WORDS, progressOf } from './week-model';
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
 * Her week of shooting (ADR 0140), above her agenda: her « Jour de tournage », each with what there is to shoot, to
 * tick line by line, and « Livrer ma semaine », which fills itself with her drops. She accepts it in one gesture; she
 * never reads how it was computed, nor the minutes the agency counts. Nothing shows until the agency sent her week.
 */
export function WeekCard({ monday, zone }: { monday: string; zone: string }): JSX.Element | null {
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
  return (
    <article className="wk-card nv-plate" data-cat="shoot" aria-labelledby="wk-title">
      <header className="wk-head">
        <WeekMark />
        <div className="wk-heading">
          <span className="wk-tag">De l’agence</span>
          <b id="wk-title" className="wk-title">
            Ta semaine de tournage
          </b>
          {week.delivery === null ? null : (
            <span className="wk-due nv-num">{dueWords(week.delivery.dueAt, zone)}</span>
          )}
        </div>
      </header>
      {week.toAccept ? (
        <div className="wk-ask">
          <p className="wk-ask__text">
            {days.length === 1
              ? 'Un jour pour tout tourner, puis tu déposes tout avant dimanche soir.'
              : `${String(days.length)} jours pour tout tourner, puis tu déposes tout avant dimanche soir.`}
          </p>
          <button
            type="button"
            className="nv-btn nv-btn--neon nv-btn--sm"
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
            busy={busy}
            onTick={(item) => {
              run(item.id, tickShootItem(item.id, !item.done));
            }}
          />
        ))}
      </div>
      {week.delivery === null ? null : <Delivery delivery={week.delivery} />}
    </article>
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
  busy,
  onTick,
}: {
  day: HerShootDay;
  busy: string | null;
  onTick: (item: ShootItem) => void;
}): JSX.Element {
  const { done, total } = progressOf(day);
  const open = day.state === 'accepted' && day.taskId !== null;
  return (
    <section className="wk-day" aria-label={`Jour de tournage, ${longDay(day.day)}`}>
      <div className="wk-day__head">
        <b className="wk-day__date">{longDay(day.day)}</b>
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
              <span className="ag-check" data-cat="shoot" data-closed="true" aria-hidden="true">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m3.5 8.5 3 3 6-7" />
                </svg>
              </span>
            )}
            <div className="wk-line__body">
              <span className="wk-line__label">{item.label}</span>
              {item.sheet === null ? null : <ShootBrief brief={item.sheet} folded />}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Delivery({ delivery }: { delivery: HerDelivery }): JSX.Element {
  const left = leftToDrop(delivery.lines);
  return (
    <section
      className="wk-delivery"
      aria-label="Livrer ma semaine"
      data-delivered={delivery.delivered || undefined}
    >
      <div className="wk-day__head">
        <b className="wk-day__date">Livrer ma semaine</b>
        {delivery.delivered ? <span className="wk-done">Tout est arrivé, merci</span> : null}
      </div>
      <ul className="wk-tally">
        {delivery.lines.map((line) => (
          <li key={line.need} className="wk-tally__line" data-full={line.received >= line.asked || undefined}>
            <span>{NEED_WORDS[line.need]}</span>
            <span className="nv-num">
              {Math.min(line.received, line.asked)} / {line.asked}
            </span>
          </li>
        ))}
      </ul>
      {left.length === 0 ? null : (
        <Link to="/contenu" className="nv-btn nv-btn--soft nv-btn--sm wk-drop">
          Déposer
        </Link>
      )}
    </section>
  );
}
