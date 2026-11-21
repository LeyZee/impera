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
import { Donut, useLit } from '@/shell/figures/figures';

/**
 * « L'essentiel du jour », the one big thing on top of her Aujourd'hui (Charles, 21/11): one ring for all that is asked
 * of her today, wherever it lives, a colour per source (the shared donut: an arc lights under the finger), and its
 * legend. Her lists to tick stay in « Ma journée » under it.
 */
export function DayHero({ today }: { today: string }): JSX.Element | null {
  const monday = mondayOf(today);
  const day = useCreatorDay().data;
  const { agenda } = useWithPending(useAgenda(monday, addDays(monday, 6)).data);
  const content = useContent().data;
  const { lit, setLit, row } = useLit();
  const hero = dayHeroOf({
    essentials: day === undefined ? null : tallyOf(day.lines.filter((line) => line.essential)),
    tasks: agenda === undefined ? null : progressOf(planOf(agenda, agenda.today)),
    toSend: content === undefined ? null : dueNow(toShoot(content.requests, content.drops), today).length,
  });
  if (hero === null) return null;
  const litChip = lit === null ? undefined : hero.chips[lit];
  return (
    <section className="nv-plate dh-card nv-enter" aria-labelledby="dh-title">
      <h2 id="dh-title" className="nv-h2 dh-title">
        {hero.title}
      </h2>
      <div className="nv-donut-row">
        <Donut
          label={hero.total === 0 ? 'Rien à faire' : `${String(hero.done)} sur ${String(hero.total)} fait`}
          slices={hero.chips.map((chip) => ({ key: chip.part, colour: chip.colour, value: chip.done }))}
          of={Math.max(hero.total, 1)}
          lit={lit}
          onLit={setLit}
        >
          {litChip === undefined ? (
            <>
              <b className="nv-donut__value nv-num">
                {hero.total === 0 ? '–' : `${String(hero.done)}/${String(hero.total)}`}
              </b>
              <span className="nv-donut__sub">fait</span>
            </>
          ) : (
            <>
              <b className="nv-donut__value nv-num">{`${String(litChip.done)}/${String(litChip.total)}`}</b>
              <span className="nv-donut__sub">{litChip.label}</span>
            </>
          )}
        </Donut>
        <div className="dh-text">
          <p className="dh-line">{hero.line}</p>
          {hero.chips.length === 0 ? null : (
            <ul className="nv-breakdown dh-legend">
              {hero.chips.map((chip, i) => (
                <li key={chip.part}>
                  <button
                    type="button"
                    className={lit === i ? 'nv-breakdown__row is-on' : 'nv-breakdown__row'}
                    data-settled={chip.settled || undefined}
                    {...row(i)}
                  >
                    <span className="nv-key" style={{ '--_c': chip.colour }} aria-hidden="true" />
                    <span className="nv-breakdown__label">{chip.label}</span>
                    <span className="nv-breakdown__value nv-num">
                      {chip.part === 'toSend' ? chip.words : `${String(chip.done)}/${String(chip.total)}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
