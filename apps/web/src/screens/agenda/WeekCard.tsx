import {
  SHOOT_ITEM_LATE_UNPROCESSABLE,
  SHOOT_ITEM_NOT_ACCEPTED_UNPROCESSABLE,
  type HerDelivery,
  type HerShootDay,
  type ShootItem,
  type WeekNeed,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type CSSProperties, type JSX } from 'react';

import { NOT_SENT, type Outcome } from './api';
import { acceptWeek, readWeekAgain, tickShootItem, useCreatorWeek } from './week-api';
import { DEFAULT_COLORS, SWATCHES, SWATCH_WORDS, useWeekColors, type Swatch } from './week-colors';
import { dayWhen, dueIn, dueShort, hasWeek, leftToDrop, NEED_WORDS, nextDay, progressOf } from './week-model';
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
 * Her week of shooting (ADR 0140), above her agenda, read in a few seconds (Charles, 20/11): one thing leads, her next
 * shooting day with what to bring back, each kind of thing in its own colour, which she can change; her other days
 * fold under it; what is left to drop closes it, with its deadline. She accepts it in one gesture; she never reads how
 * it was computed, nor the minutes the agency counts. Nothing shows until the agency sent her week.
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
  const palette = useWeekColors();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [painting, setPainting] = useState(false);
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
  const onTick = (item: ShootItem): void => {
    run(item.id, tickShootItem(item.id, !item.done));
  };

  const days = week.shootDays.filter((day) => day.state !== 'declined');
  const lead = nextDay(days, today);
  const others = days.filter((day) => day !== lead);
  const kinds = [
    ...new Set<WeekNeed>([
      ...days.flatMap((day) => day.items.map((item) => item.need)),
      ...(week.delivery?.lines.map((line) => line.need) ?? []),
    ]),
  ];
  // Her colours reach every line through one variable a kind.
  const style: CSSProperties = {};
  for (const need of kinds) style[`--wk-${need}`] = `var(--wk-sw-${palette.colors[need]})`;
  return (
    <article className="wk-card nv-plate" data-cat="shoot" aria-labelledby="wk-title" style={style}>
      <header className="wk-head">
        <WeekMark />
        <div className="wk-heading">
          <b id="wk-title" className="wk-title">
            Ta semaine de tournage
          </b>
          {week.delivery === null ? null : (
            <span className="wk-due nv-num">
              Tout déposer avant {dueShort(week.delivery.dueAt, zone)}
              <DueIn words={dueIn(week.delivery.dueAt, zone, today)} />
            </span>
          )}
        </div>
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm wk-paint"
          aria-label="Couleurs"
          aria-expanded={painting}
          aria-controls="wk-palette"
          onClick={() => {
            setPainting(!painting);
          }}
        >
          <span className="wk-paint__dots" aria-hidden="true">
            {kinds.slice(0, 3).map((need) => (
              <i key={need} data-need={need} />
            ))}
          </span>
          <span className="wk-paint__word">Couleurs</span>
        </button>
      </header>
      {painting ? (
        <Palette
          kinds={kinds}
          colors={palette.colors}
          onPaint={palette.paint}
          onReset={palette.reset}
          onClose={() => {
            setPainting(false);
          }}
        />
      ) : null}
      {week.toAccept ? (
        <div className="wk-ask">
          <p className="wk-ask__text">
            L’agence a préparé ta semaine. Si elle te va, accepte-la : tes jours de tournage arrivent dans ton
            agenda et tu coches au fur et à mesure.
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
      {lead === null ? null : <ShootDay day={lead} today={today} busy={busy} onTick={onTick} lead />}
      {others.length === 0 ? null : (
        <div className="wk-days">
          {others.map((day) => (
            <ShootDay key={day.suggestionId} day={day} today={today} busy={busy} onTick={onTick} />
          ))}
        </div>
      )}
      {week.delivery === null ? null : <Delivery delivery={week.delivery} />}
    </article>
  );
}

/** « Dans 9 jours », a pill of its own; amber once the deadline passed. */
function DueIn({ words }: { words: string }): JSX.Element {
  return (
    <span className="wk-due__in" data-late={words === 'passé' || undefined}>
      {words.charAt(0).toUpperCase() + words.slice(1)}
    </span>
  );
}

/** Her colours, a row a kind: seven swatches, ours marked, one tap to change. Kept on this device. */
function Palette({
  kinds,
  colors,
  onPaint,
  onReset,
  onClose,
}: {
  kinds: readonly WeekNeed[];
  colors: Readonly<Record<WeekNeed, Swatch>>;
  onPaint: (need: WeekNeed, swatch: Swatch) => void;
  onReset: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div
      id="wk-palette"
      className="wk-palette"
      role="dialog"
      aria-label="Tes couleurs"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="wk-palette__top">
        <p className="wk-palette__lead">Choisis la couleur de chaque type de contenu.</p>
        <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" onClick={onClose}>
          Fermer
        </button>
      </div>
      <ul className="wk-palette__rows">
        {kinds.map((need) => (
          <li key={need} className="wk-palette__row">
            <span className="wk-kind" data-need={need} aria-hidden="true">
              <Icon name={need} />
            </span>
            <span className="wk-palette__word" id={`wk-pal-${need}`}>
              {NEED_WORDS[need]}
            </span>
            <span className="wk-swatches" role="radiogroup" aria-labelledby={`wk-pal-${need}`}>
              {SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  role="radio"
                  className="wk-swatch"
                  data-swatch={swatch}
                  aria-checked={colors[need] === swatch}
                  aria-label={SWATCH_WORDS[swatch]}
                  onClick={() => {
                    onPaint(need, swatch);
                  }}
                />
              ))}
            </span>
          </li>
        ))}
      </ul>
      {kinds.every((need) => colors[need] === DEFAULT_COLORS[need]) ? null : (
        <button type="button" className="nv-btn nv-btn--plain nv-btn--sm wk-palette__reset" onClick={onReset}>
          Remettre nos couleurs
        </button>
      )}
    </div>
  );
}

/** The small drawn marks of her week: one per kind of thing she shoots, never a stock icon. */
function Icon({ name }: { name: WeekNeed | 'drop' }): JSX.Element {
  return (
    <svg className="wk-icon" viewBox="0 0 24 24" aria-hidden="true">
      {name === 'feed_shoot' ? (
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
      ) : (
        <>
          <path className="wk-icon__fill" d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
          <path d="M12 15V4.5M7.5 9 12 4.5 16.5 9" />
        </>
      )}
    </svg>
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

/**
 * One of her shooting days. The lead one is open and large, « Prochain tournage »; the others fold to one line (their
 * date, when, how many), opened by a tap.
 */
function ShootDay({
  day,
  today,
  busy,
  onTick,
  lead = false,
}: {
  day: HerShootDay;
  today: string;
  busy: string | null;
  onTick: (item: ShootItem) => void;
  lead?: boolean;
}): JSX.Element {
  const { done, total } = progressOf(day);
  const open = day.state === 'accepted' && day.taskId !== null;
  const head = (
    <>
      <span className="wk-day__titles">
        {lead ? (
          <span className="wk-day__lead">{day.day === today ? 'Tournage du jour' : 'Prochain tournage'}</span>
        ) : null}
        <b className="wk-day__date">{longDay(day.day)}</b>
      </span>
      <span className="wk-day__when">{dayWhen(day.day, today)}</span>
      <span className="wk-day__count nv-num" aria-label={`${String(done)} sur ${String(total)} tournés`}>
        {done} / {total}
      </span>
    </>
  );
  const lines = (
    <>
      <span className="wk-bar" aria-hidden="true">
        <i style={{ width: `${total === 0 ? '0' : ((done / total) * 100).toFixed(1)}%` }} />
      </span>
      <ul className="wk-lines">
        {day.items.map((item) => (
          <Line key={item.id} item={item} open={open} busy={busy} onTick={onTick} />
        ))}
      </ul>
    </>
  );
  const shared = {
    'aria-label': `Jour de tournage, ${longDay(day.day)}`,
    'data-today': day.day === today || undefined,
    'data-full': (total > 0 && done === total) || undefined,
  };
  if (lead)
    return (
      <section className="wk-day wk-day--lead" {...shared}>
        <div className="wk-day__head">{head}</div>
        {lines}
      </section>
    );
  return (
    <details className="wk-day wk-day--later" {...shared}>
      <summary className="wk-day__head wk-day__fold">
        {head}
        <svg className="wk-line__chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m6 3 5 5-5 5" />
        </svg>
      </summary>
      {lines}
    </details>
  );
}

/** One line: its kind in its colour, its words and the start of its sheet, and her tick at the end, once accepted. */
function Line({
  item,
  open,
  busy,
  onTick,
}: {
  item: ShootItem;
  open: boolean;
  busy: string | null;
  onTick: (item: ShootItem) => void;
}): JSX.Element {
  return (
    <li className="wk-line" data-need={item.need} data-done={item.done ? 'true' : undefined}>
      <span className="wk-kind" aria-hidden="true">
        <Icon name={item.need} />
      </span>
      {item.sheet === null ? (
        <div className="wk-line__body">
          <span className="wk-line__label">{item.label}</span>
        </div>
      ) : (
        // The line opens its shooting sheet; its first words show before, the tick stays its own target.
        <details className="wk-line__body wk-line__sheet">
          <summary className="wk-line__summary">
            <span className="wk-line__words">
              <span className="wk-line__label">{item.label}</span>
              <span className="wk-line__peek">{item.sheet.split('\n')[0]}</span>
            </span>
            <svg className="wk-line__chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m6 3 5 5-5 5" />
            </svg>
          </summary>
          <p className="wk-line__text">{item.sheet}</p>
        </details>
      )}
      {open ? (
        <button
          type="button"
          className="wk-tick"
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
      ) : null}
    </li>
  );
}

function Delivery({ delivery }: { delivery: HerDelivery }): JSX.Element {
  const left = leftToDrop(delivery.lines);
  return (
    <section className="wk-delivery" aria-label="À déposer" data-delivered={delivery.delivered || undefined}>
      <div className="wk-day__head">
        <b className="wk-day__date">À déposer</b>
        {delivery.delivered ? <span className="wk-done">Tout est arrivé, merci</span> : null}
      </div>
      <ul className="wk-tally">
        {delivery.lines.map((line) => {
          const got = Math.min(line.received, line.asked);
          return (
            <li
              key={line.need}
              className="wk-tally__line"
              data-need={line.need}
              data-full={got >= line.asked || undefined}
            >
              <span className="wk-kind" aria-hidden="true">
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
