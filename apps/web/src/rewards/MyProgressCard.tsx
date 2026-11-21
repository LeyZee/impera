import type { Me } from '@impera/contracts';
import { countUp } from '@impera/design-system';
import { Link } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';

import { gaugeStart, keepShown, lastShown } from './GameGauge';
import { LevelInsignia } from './LevelInsignia';
import { rankPercent } from './MyRankCard';
import { TrophyBadge } from './TrophyBadge';
import { playsTheGame, useMyTrophyCase } from './api';
import { nextGoals, type Goal } from './progress';
import './rewards.css';

import { Panel } from '@/shell/layout';

const shifts = (count: number): string => `${String(count)} ${count > 1 ? 'shifts' : 'shift'}`;

const still = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const percentText = (value: number): string => `${String(Math.round(value))} %`;

/** Where the embers of the card rise from, in hundredths of its width. */
const EMBERS = [6, 17, 29, 41, 52, 64, 73, 85, 94] as const;

/** The steps of the way, lit once the bar has passed them. */
const MARKS = [25, 50, 75] as const;

/**
 * The way to the next rank, drawn as a game draws it: the bar fills on arrival, from where this browser last showed it
 * (so what was gained since is seen moving) or from nothing on a first visit, the figure counts with it, and a light
 * runs along it once. With « Réduire les animations » everything is in place from the first picture. Every fact is in
 * the words beside it: nothing is said by the movement alone (ADR 0104 § 19).
 */
function RankBar({
  userId,
  scope,
  percent,
  label,
  towards,
  rank,
}: {
  userId: string;
  scope: string;
  percent: number;
  label: string;
  /** The rank ahead: its name beside the figure, its insignia, still unlit, where the bar ends. */
  towards: string;
  rank: number;
}): JSX.Element {
  // Read once, on arrival: the movement plays once a visit.
  const [seen] = useState(() => gaugeStart(lastShown(userId, 'today-rank'), scope, percent));
  const [from] = useState(() => (still() ? percent : (seen ?? 0)));
  const [at, setAt] = useState(from);
  const figure = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    keepShown(userId, 'today-rank', { scope, percent });
  }, [userId, scope, percent]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setAt(percent);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [percent]);

  useLayoutEffect(() => {
    const element = figure.current;
    if (element === null) return undefined;
    return countUp(element, percent, percentText, { from, durationMs: 1000 });
  }, [percent, from]);

  const gained = seen === null ? 0 : Math.round(percent - seen);
  return (
    <div className="rw-quest__way">
      <div className="rw-quest__figures">
        {/* Written by the count only: React never owns this text. */}
        <span className="rw-quest__reach">
          <span className="rw-quest__percent nv-num" ref={figure} aria-hidden="true" />
          <span className="rw-quest__towards">vers {towards}</span>
        </span>
        {gained > 0 ? (
          <span className="rw-quest__gain nv-num">+{String(gained)}&nbsp;% depuis ta dernière visite</span>
        ) : null}
      </div>
      <div className="rw-quest__track">
        <div
          className="rw-quest__bar"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          style={{ '--rw-quest-at': `${String(at)}%` }}
        >
          <span className="rw-quest__fill" />
          {/* The fire the bar burns with: the flames trailing behind its head, the flame at its head, three sparks. Drawn only. */}
          <span className="rw-quest__fire" aria-hidden="true">
            <span className="rw-quest__trail">
              <i />
              <i />
            </span>
            <svg className="rw-quest__torch" viewBox="0 0 16 16" focusable="false">
              <path d="M8.300 0.500c.6 3.300 4.700 4.800 4.700 9.100 0 3.100-2.200 5.400-5 5.400s-5-2.100-5-5.200c0-1.900.8-3.200 1.600-4.100.2 1.300.7 2 1.400 2.400C5.700 5.400 6.400 2.400 8.300 0.500z" />
              <path d="M8.100 7.200c.3 1.500 2 2.200 2 4.100 0 1.400-.9 2.400-2.100 2.400s-2.100-.9-2.100-2.300c0-.9.400-1.500.8-1.900.1.600.3.900.6 1.100 0-1.100.1-2.400.8-3.400z" />
            </svg>
            <b />
            <b />
            <b />
          </span>
          {MARKS.map((mark) => (
            <i
              key={mark}
              className="rw-quest__mark"
              data-passed={percent >= mark}
              // A step the bar crosses on this arrival flashes as the fire reaches it.
              data-crossed={from < mark && percent >= mark}
              style={{
                left: `${String(mark)}%`,
                '--_d': percent > from ? (mark - from) / (percent - from) : 0,
              }}
            />
          ))}
        </div>
        <span className="rw-quest__end" aria-hidden="true">
          <LevelInsignia rank={rank} earned={false} size={30} />
        </span>
      </div>
    </div>
  );
}

/** One goal ahead: its shield, its name, the way there step by step when the steps are few, and what is left. */
function GoalRow({ goal, index }: { goal: Goal; index: number }): JSX.Element {
  return (
    <li className="rw-quest__goal nv-enter" data-near={goal.near} style={{ '--nv-i': index + 2 }}>
      <TrophyBadge kind={goal.kind} earned={false} size={48} />
      <div className="rw-quest__goal-main">
        <p className="rw-quest__goal-name">
          <span className="rw-quest__goal-what">{goal.name}</span>
          {goal.near ? <span className="rw-quest__near">Presque</span> : null}
        </p>
        <p className="rw-quest__goal-way">
          {goal.steps === null ? (
            <span className="rw-quest__mini" aria-hidden="true">
              <i style={{ width: `${String(goal.percent)}%` }} />
            </span>
          ) : (
            <span className="rw-quest__steps" aria-hidden="true">
              {Array.from({ length: goal.steps }, (_, step) => (
                <i key={step} data-done={step < goal.current} style={{ '--_i': step }} />
              ))}
            </span>
          )}
          <span className="rw-quest__left nv-num">{goal.left}</span>
        </p>
      </div>
    </li>
  );
}

/**
 * Aujourd'hui › « Ma progression » (ADR 0134, lot 1; ADR 0104 § 12 to § 19): where the chatter stands in the game and
 * what is within reach, the whole card leading to Moi › Trophées. His rank and the way to the next one as a bar that
 * moves, his series, and the goals he is closest to, the nearest first. Within the game's rules: his own facts only,
 * nobody else's, no amount (they are on « Mon rang »), nothing drawn by chance, no effect on pay. Nothing shows while
 * there is nothing to say, nor for who does not play.
 */
export function MyProgressCard({ user }: { user: Me }): JSX.Element | null {
  const trophyCase = useMyTrophyCase(playsTheGame(user)).data;
  const body = useRef<HTMLDivElement>(null);
  const shown = trophyCase !== undefined;
  // The card's light follows the pointer: where it is goes to the styles, nothing else is read from it.
  useEffect(() => {
    const card = body.current?.closest<HTMLElement>('.rw-quest');
    if (card === null || card === undefined) return undefined;
    const follow = (event: PointerEvent): void => {
      const box = card.getBoundingClientRect();
      card.style.setProperty('--rw-quest-x', `${String(event.clientX - box.left)}px`);
      card.style.setProperty('--rw-quest-y', `${String(event.clientY - box.top)}px`);
    };
    card.addEventListener('pointermove', follow);
    return () => {
      card.removeEventListener('pointermove', follow);
    };
  }, [shown]);
  if (trophyCase === undefined) return null;
  const { level } = trophyCase;
  const nextLevel = trophyCase.nextLevel ?? null;
  const streak = trophyCase.streaks.find((each) => each.kind === 'shift') ?? null;
  const running = streak !== null && streak.current > 0;
  const goals = nextGoals(trophyCase);
  const ranked = level !== null || nextLevel !== null;
  if (!ranked && !running && goals.length === 0) return null;
  return (
    <Panel className="rw-quest sc-linked nv-enter" eyebrow="Ma progression">
      <Link to="/moi/trophees" className="sc-card-link" aria-label="Voir mes trophées" />
      <div className="rw-quest__body" ref={body}>
        {/* Drawn only: the light that follows the pointer, the embers that rise under it. */}
        <span className="rw-quest__spot" aria-hidden="true" />
        <span className="rw-quest__embers" aria-hidden="true">
          {EMBERS.map((at) => (
            <i key={at} style={{ left: `${String(at)}%`, '--_i': at % 7 }} />
          ))}
        </span>
        <div className="rw-quest__head">
          {ranked ? (
            <span className="rw-quest__insignia">
              <span className="rw-quest__halo" aria-hidden="true" />
              <LevelInsignia rank={level?.rank ?? 1} earned={level !== null} size={64} />
            </span>
          ) : null}
          <div className="rw-quest__who">
            {ranked ? (
              <p className="rw-quest__name">{level === null ? 'Pas encore de rang' : level.name}</p>
            ) : null}
            {nextLevel === null ? null : (
              <p className="rw-quest__line">
                {level === null ? 'Premier rang' : 'Rang suivant'}&nbsp;: <b>{nextLevel.name}</b>
              </p>
            )}
            {running ? (
              <p className="rw-quest__streak nv-num">
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M8.3 1.5c.5 2.6 4 3.800 4 7.400 0 2.500-1.900 4.100-4.300 4.100S3.700 11.400 3.700 9c0-1.500.7-2.500 1.300-3.200.2 1 .6 1.600 1.200 1.900C5.900 5.400 6.600 3 8.300 1.500z" />
                </svg>
                Série en cours&nbsp;: <b>{shifts(streak.current)}</b>
                {streak.best > streak.current ? <span> · record {String(streak.best)}</span> : null}
              </p>
            ) : null}
          </div>
          <span className="rw-quest__go" aria-hidden="true">
            Mes trophées
            <svg viewBox="0 0 16 16" focusable="false">
              <path d="M6 3.5 10.5 8 6 12.500" />
            </svg>
          </span>
        </div>
        {nextLevel === null ? null : (
          <RankBar
            userId={user.id}
            scope={String(nextLevel.rank)}
            percent={rankPercent(nextLevel)}
            label={`Avancée vers le rang ${nextLevel.name}`}
            towards={nextLevel.name}
            rank={nextLevel.rank}
          />
        )}
        {goals.length === 0 ? null : (
          <div className="rw-quest__goals">
            <p className="rw-quest__label">À ta portée</p>
            <ul>
              {goals.map((goal, index) => (
                <GoalRow key={goal.kind} goal={goal} index={index} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}
