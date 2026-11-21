import type { JSX } from 'react';

import { LevelInsignia } from './LevelInsignia';
import { TROPHY_NAMES, TrophyBadge, type TrophyKind } from './TrophyBadge';
import { useMemberTrophyCase } from './api';
import './rewards.css';

const isTrophy = (kind: string): kind is TrophyKind => kind in TROPHY_NAMES;

const plural = (count: number, one: string, many: string): string => (count > 1 ? many : one);

/**
 * A chatter's record › « Jeu » (ADR 0104 § 20): the owner and a manager do not play; they read a member's rank,
 * streak and trophies here, and change nothing. No amount, and no place among the others (§ 18). Nothing shows when
 * the read fails or for a member who does not play. Read in this order (Charles, 16/11): the rank first, large; two
 * figures side by side; the trophies last, the latest first.
 */
export function MemberGameBlock({ memberId, name }: { memberId: string; name: string }): JSX.Element | null {
  const trophyCase = useMemberTrophyCase(memberId, true).data;
  if (trophyCase === undefined) return null;
  const streak = trophyCase.streaks.find((one) => one.kind === 'shift') ?? { current: 0, best: 0 };
  const trophies = trophyCase.items.filter((item) => isTrophy(item.kind));
  const earned = trophies
    .filter((item) => item.earnedAt !== null)
    .toSorted((a, b) => (b.earnedAt ?? '').localeCompare(a.earnedAt ?? ''));
  // A tier gain is `tier:<fortnight>:<threshold>`: what counts here is the fortnights that reached one.
  const tiers = new Set(
    trophyCase.items.filter((item) => item.family === 'medal').map((item) => item.kind.split(':')[1]),
  ).size;
  const { level } = trophyCase;
  return (
    <section className="tm-block nv-enter rw-member" style={{ '--nv-i': 5 }} aria-label="Jeu">
      <h3 className="nv-h3">Jeu</h3>
      <div className="rw-member__rank">
        <LevelInsignia rank={level?.rank ?? 1} earned={level !== null} size={56} />
        <div>
          <p className="rw-member__eyebrow">Rang</p>
          <p className="rw-member__name" data-none={level === null}>
            {level === null ? 'Pas encore de rang' : level.name}
          </p>
        </div>
      </div>
      <dl className="rw-member__facts">
        <div>
          <dt>Série en cours</dt>
          <dd>
            <span className="rw-member__figure nv-num" data-zero={streak.current === 0}>
              {streak.current}
            </span>
            <span className="rw-member__unit">
              {plural(streak.current, 'shift', 'shifts')} avec le rapport à l’heure
              {streak.best > streak.current ? (
                <span className="rw-member__best">Meilleure&nbsp;: {streak.best}</span>
              ) : null}
            </span>
          </dd>
        </div>
        <div>
          <dt>Quinzaines avec un palier</dt>
          <dd>
            <span className="rw-member__figure nv-num" data-zero={tiers === 0}>
              {tiers}
            </span>
          </dd>
        </div>
      </dl>
      <p className="rw-member__label">
        Trophées{' '}
        <span className="nv-num">
          {earned.length} sur {trophies.length}
        </span>
      </p>
      {earned.length === 0 ? (
        <p className="tm-muted rw-member__none">Aucun trophée pour l’instant.</p>
      ) : (
        <ul className="rw-member__trophies" aria-label="Trophées gagnés">
          {earned.map((item) =>
            isTrophy(item.kind) ? (
              <li key={item.kind}>
                <TrophyBadge kind={item.kind} size={44} />
                <span>{TROPHY_NAMES[item.kind]}</span>
              </li>
            ) : null,
          )}
        </ul>
      )}
      <p className="tm-hint rw-member__foot">En lecture seule. Rien ici ne touche la paie de {name}.</p>
    </section>
  );
}
