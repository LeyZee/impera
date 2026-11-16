import type { JSX } from 'react';

import { LevelInsignia } from './LevelInsignia';
import { TROPHY_NAMES, TrophyBadge, type TrophyKind } from './TrophyBadge';
import { useMemberTrophyCase } from './api';
import './rewards.css';

const isTrophy = (kind: string): kind is TrophyKind => kind in TROPHY_NAMES;

/**
 * A chatter's record › « Jeu » (ADR 0104 § 20): the owner and a manager do not play; they read a member's rank,
 * streak and trophies here, and change nothing. No amount, and no place among the others (§ 18). Nothing shows when
 * the read fails or for a member who does not play.
 */
export function MemberGameBlock({ memberId, name }: { memberId: string; name: string }): JSX.Element | null {
  const trophyCase = useMemberTrophyCase(memberId, true).data;
  if (trophyCase === undefined) return null;
  const streak = trophyCase.streaks.find((one) => one.kind === 'shift') ?? { current: 0, best: 0 };
  const trophies = trophyCase.items.filter((item) => isTrophy(item.kind));
  const earned = trophies.filter((item) => item.earnedAt !== null);
  // A tier gain is `tier:<fortnight>:<threshold>`: what counts here is the fortnights that reached one.
  const tiers = new Set(
    trophyCase.items.filter((item) => item.family === 'medal').map((item) => item.kind.split(':')[1]),
  ).size;
  const { level } = trophyCase;
  return (
    <section className="tm-block nv-enter rw-member" style={{ '--nv-i': 5 }} aria-label="Jeu">
      <h3>Jeu</h3>
      <p className="tm-hint">Ce que {name} a gagné dans son jeu. En lecture : rien ici ne touche sa paie.</p>
      <dl className="rw-member__facts">
        <div>
          <dt>Rang</dt>
          <dd className="rw-member__rank">
            {level === null ? (
              <span className="tm-muted">Pas encore de rang</span>
            ) : (
              <>
                <LevelInsignia rank={level.rank} size={28} />
                {level.name}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Série en cours</dt>
          <dd className="nv-num">
            {streak.current === 0
              ? 'Aucune'
              : `${String(streak.current)} shift${streak.current > 1 ? 's' : ''}`}
            {streak.best > streak.current ? (
              <span className="tm-muted"> · meilleure : {streak.best}</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Quinzaines avec un palier atteint</dt>
          <dd className="nv-num">{tiers === 0 ? <span className="tm-muted">Aucun</span> : tiers}</dd>
        </div>
      </dl>
      <p className="rw-member__label">Trophées</p>
      {earned.length === 0 ? (
        <p className="tm-muted rw-member__none">Aucun trophée pour l’instant.</p>
      ) : (
        <ul className="rw-member__trophies" aria-label="Trophées gagnés">
          {earned.map((item) =>
            isTrophy(item.kind) ? (
              <li key={item.kind}>
                <TrophyBadge kind={item.kind} size={28} />
                {TROPHY_NAMES[item.kind]}
              </li>
            ) : null,
          )}
        </ul>
      )}
    </section>
  );
}
