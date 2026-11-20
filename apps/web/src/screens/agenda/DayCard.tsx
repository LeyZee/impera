import { DAY_ITEM_LATE_UNPROCESSABLE, type DayLine, type DayPlatform } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { NOT_SENT, type Outcome } from './api';
import { readDayAgain, tickDayItem, useCreatorDay } from './day-api';
import { doneAfterTap, firstSentence, kindOf, PLATFORM_WORDS, tallyOf } from './day-model';
import { colorVars, useWeekColors, type ColorKind } from './week-colors';
import { Icon, Palette } from './week-parts';
import './week-card.css';

import { longDay } from '@/scheduling/time';

/** What a refused or unsent tick of her day says, in her words. */
function failureOf(outcome: Exclude<Outcome<null>, { kind: 'ok' }>): string {
  if (outcome.kind !== 'refused') return NOT_SENT[outcome.kind];
  if (outcome.code === DAY_ITEM_LATE_UNPROCESSABLE)
    return 'Cette journée est passée : ses coches ne changent plus.';
  return 'Ta journée a changé entre-temps. Elle est relue.';
}

/**
 * Her day (ADR 0140, second avenant): what she posts today, to tick as she goes (Charles, 20/11). The essentials lead,
 * large; the rest is a bonus, grouped by network, never in red. Nothing is ever published for her: these are her lists.
 * Each line opens a sentence or two on what it is for; her story that leads to Reveal says why it matters most.
 */
export function DayCard(): JSX.Element | null {
  const client = useQueryClient();
  const read = useCreatorDay();
  const palette = useWeekColors();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [painting, setPainting] = useState(false);
  const day = read.data;
  if (day === undefined || day.lines.length === 0) return null;

  const onTap = (line: DayLine, index: number): void => {
    const key = `${line.item}:${String(index)}`;
    setBusy(key);
    setFailed(null);
    void tickDayItem(day.day, line.item, doneAfterTap(line.done, index)).then(async (outcome) => {
      if (outcome.kind !== 'ok') setFailed(failureOf(outcome));
      await readDayAgain(client);
      setBusy(null);
    });
  };

  const essentials = day.lines.filter((line) => line.essential);
  const bonus = day.lines.filter((line) => !line.essential);
  const kinds = [...new Set<ColorKind>(day.lines.map(kindOf))];
  const essential = tallyOf(essentials);
  const extra = tallyOf(bonus);
  const settled = essential.done === essential.total;
  const platforms = [...new Set<DayPlatform>(bonus.map((line) => line.platform))];
  return (
    <article
      className="wk-card dy-card nv-plate"
      data-cat="shoot"
      aria-labelledby="dy-title"
      style={colorVars(kinds, palette.colors)}
    >
      <header className="wk-head">
        <DayMark />
        <div className="wk-heading">
          <b id="dy-title" className="wk-title">
            Ma journée
          </b>
          <span className="wk-due">
            {day.day === day.today ? `Aujourd’hui, ${longDay(day.day)}` : longDay(day.day)}
          </span>
        </div>
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm wk-paint"
          aria-label="Couleurs"
          aria-expanded={painting}
          aria-controls="dy-palette"
          onClick={() => {
            setPainting(!painting);
          }}
        >
          <span className="wk-paint__dots" aria-hidden="true">
            {kinds.slice(0, 3).map((kind) => (
              <i key={kind} data-need={kind} />
            ))}
          </span>
          <span className="wk-paint__word">Couleurs</span>
        </button>
      </header>
      {painting ? (
        <Palette
          id="dy-palette"
          kinds={kinds}
          colors={palette.colors}
          onPaint={palette.paint}
          onReset={palette.reset}
          onClose={() => {
            setPainting(false);
          }}
        />
      ) : null}
      {failed === null ? null : (
        <p className="wk-failed" role="alert">
          {failed}
        </p>
      )}
      <section
        className="dy-part dy-part--lead"
        aria-labelledby="dy-essentials"
        data-full={settled || undefined}
      >
        <div className="dy-part__head">
          <b id="dy-essentials" className="dy-part__title">
            L’essentiel du jour
          </b>
          <span
            className="wk-day__count nv-num"
            aria-label={`${String(essential.done)} sur ${String(essential.total)} faits`}
          >
            {essential.done} / {essential.total}
          </span>
        </div>
        {settled ? (
          <p className="dy-settled">L’essentiel est fait. Tout le reste, c’est du bonus ✨</p>
        ) : null}
        <ul className="wk-lines">
          {essentials.map((line) => (
            <DayRow key={line.item} line={line} busy={busy} onTap={onTap} />
          ))}
        </ul>
      </section>
      {bonus.length === 0 ? null : (
        <details className="dy-part dy-part--bonus" open>
          <summary className="dy-part__head dy-part__fold">
            <b className="dy-part__title">En bonus</b>
            <span className="dy-part__hint">Si tu as le temps</span>
            <span
              className="wk-day__count nv-num"
              aria-label={`${String(extra.done)} sur ${String(extra.total)} faits`}
            >
              {extra.done} / {extra.total}
            </span>
            <svg className="wk-line__chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m6 3 5 5-5 5" />
            </svg>
          </summary>
          {platforms.map((platform) => (
            <div key={platform} className="dy-group">
              <span className="dy-group__name">{PLATFORM_WORDS[platform]}</span>
              <ul className="wk-lines">
                {bonus
                  .filter((line) => line.platform === platform)
                  .map((line) => (
                    <DayRow key={line.item} line={line} busy={busy} onTap={onTap} />
                  ))}
              </ul>
            </div>
          ))}
        </details>
      )}
    </article>
  );
}

/** One line of her day: its network in its colour, its words and the start of its sheet, and one mark per post. */
function DayRow({
  line,
  busy,
  onTap,
}: {
  line: DayLine;
  busy: string | null;
  onTap: (line: DayLine, index: number) => void;
}): JSX.Element {
  const marks = Array.from({ length: line.target }, (_, index) => index);
  return (
    <li
      className="wk-line dy-line"
      data-need={kindOf(line)}
      data-done={line.done >= line.target ? 'true' : undefined}
    >
      <span className="wk-kind" aria-hidden="true">
        <Icon name={kindOf(line)} />
      </span>
      <details className="wk-line__body wk-line__sheet">
        <summary className="wk-line__summary">
          <span className="wk-line__words">
            <span className="wk-line__label">{line.label}</span>
            <span className="wk-line__peek">{firstSentence(line.sheet)}</span>
          </span>
          <svg className="wk-line__chevron" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m6 3 5 5-5 5" />
          </svg>
        </summary>
        <p className="wk-line__text">{line.sheet}</p>
      </details>
      <span className="dy-marks" data-many={line.target > 1 || undefined}>
        {marks.map((index) => {
          const on = index < line.done;
          const words =
            line.target === 1
              ? `${on ? 'Décocher' : 'Cocher'} ${line.label}`
              : `${line.label} : ${String(index + 1)} sur ${String(line.target)}`;
          return (
            <button
              key={index}
              type="button"
              className="wk-tick dy-tick"
              aria-pressed={on}
              aria-busy={busy === `${line.item}:${String(index)}`}
              disabled={busy !== null}
              aria-label={words}
              onClick={() => {
                onTap(line, index);
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m3.5 8.5 3 3 6-7" />
              </svg>
            </button>
          );
        })}
      </span>
    </li>
  );
}

/** A small sun, the mark of her day: the game's, never a stock icon. */
function DayMark(): JSX.Element {
  return (
    <span className="wk-mark dy-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <circle className="dy-mark__sun" cx="12" cy="12" r="4.2" />
        <path
          className="dy-mark__rays"
          d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"
        />
      </svg>
    </span>
  );
}
