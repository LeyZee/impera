import { ringDash } from '@impera/design-system';
import type { JSX } from 'react';

import { dayHeroOf } from './model';
import './day-hero.css';

import { addDays, mondayOf } from '@/scheduling/time';
import { useAgenda, useWithPending } from '@/screens/agenda/api';
import { useCreatorDay } from '@/screens/agenda/day-api';
import { tallyOf } from '@/screens/agenda/day-model';
import { planOf, progressOf } from '@/screens/agenda/model';
import { useContent } from '@/screens/content/api';
import { dueNow, toShoot } from '@/screens/content/model';

const RADIUS = 52;

/**
 * « L'essentiel du jour », the one big thing on top of her Aujourd'hui (Charles, 21/11): one ring for all that is asked
 * of her today, wherever it lives, and a chip per source. Her lists to tick stay in « Ma journée » under it.
 */
export function DayHero({ today }: { today: string }): JSX.Element | null {
  const monday = mondayOf(today);
  const day = useCreatorDay().data;
  const { agenda } = useWithPending(useAgenda(monday, addDays(monday, 6)).data);
  const content = useContent().data;
  const hero = dayHeroOf({
    essentials: day === undefined ? null : tallyOf(day.lines.filter((line) => line.essential)),
    tasks: agenda === undefined ? null : progressOf(planOf(agenda, agenda.today)),
    toSend: content === undefined ? null : dueNow(toShoot(content.requests, content.drops), today).length,
  });
  if (hero === null) return null;
  const full = hero.total > 0 && hero.done >= hero.total;
  return (
    <section className="nv-plate dh-card nv-enter" aria-labelledby="dh-title">
      <div
        className="nv-ring dh-ring"
        data-full={full || undefined}
        role="img"
        aria-label={hero.total === 0 ? 'Rien à faire' : `${String(hero.done)} sur ${String(hero.total)} fait`}
      >
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="nv-ring__track" cx="60" cy="60" r={RADIUS} />
          {/* At nothing done, no value at all: a round cap of length 0 still draws a lit dot (CRE-06). */}
          {hero.share === 0 ? null : (
            <circle
              className="nv-ring__value"
              cx="60"
              cy="60"
              r={RADIUS}
              strokeDasharray={ringDash(hero.share, RADIUS)}
            />
          )}
        </svg>
        <span className="nv-ring__label nv-num" aria-hidden="true">
          {hero.total === 0 ? '–' : `${String(hero.done)}/${String(hero.total)}`}
          <span className="nv-ring__sub">fait</span>
        </span>
      </div>
      <div className="dh-text">
        <h2 id="dh-title" className="dh-title">
          {hero.title}
        </h2>
        <p className="dh-line">{hero.line}</p>
        {hero.chips.length === 0 ? null : (
          <ul className="dh-chips">
            {hero.chips.map((chip) => (
              <li
                key={chip.part}
                className="dh-chip"
                data-part={chip.part}
                data-settled={chip.settled || undefined}
              >
                {chip.words}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
