import type { TrophyCaseStreak } from '@impera/contracts';
import type { JSX } from 'react';

import { useCreatorTrophyCase } from './api';
import { CREATOR_TROPHY_NAMES, CreatorObject, highestMedal, isCreatorTrophy, medalName } from './creator-art';
import './rewards.css';

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count > 1 ? many : one}`;

function StreakFact({
  label,
  streak,
  words,
}: {
  label: string;
  streak: TrophyCaseStreak | undefined;
  words: (count: number) => string;
}): JSX.Element {
  const current = streak?.current ?? 0;
  const best = streak?.best ?? 0;
  return (
    <div>
      <dt>{label}</dt>
      <dd className="nv-num">
        {current === 0 ? 'Aucune' : words(current)}
        {/* A break is never read as a loss: her best stays beside it (ADR 0108 § 3, recette 16/11 CRE-02). */}
        {best > current ? <span className="tm-muted"> · meilleure : {best}</span> : null}
      </dd>
    </div>
  );
}

/**
 * Créatrices › her sheet › « Jeu » (ADR 0107 § 12): the owner and an active manager read her series, her highest medal
 * and her trophies, and change nothing. Never a chatter's, never a level or an amount (§ 3), and her reveals stay hers:
 * nothing here marks one seen. Nothing shows while it loads or when the read fails.
 */
export function CreatorGameBlock({
  creatorId,
  name,
}: {
  creatorId: string;
  name: string;
}): JSX.Element | null {
  const trophyCase = useCreatorTrophyCase(creatorId, true).data;
  if (trophyCase === undefined) return null;
  const day = trophyCase.streaks.find((one) => one.kind === 'day');
  const delivery = trophyCase.streaks.find((one) => one.kind === 'delivery');
  const medal = highestMedal(trophyCase.items);
  // Her medals are her series, read above: the list holds her trophies.
  const earned = trophyCase.items.flatMap((item) =>
    item.earnedAt !== null && isCreatorTrophy(item.kind) ? [item.kind] : [],
  );
  return (
    <section className="tm-block nv-enter rw-member" aria-label="Jeu">
      <h3>Jeu</h3>
      <p className="tm-hint">
        Ce que {name} a gagné dans son jeu. En lecture : ses séries viennent de ses routines et de ses
        livraisons.
      </p>
      <dl className="rw-member__facts">
        <StreakFact label="Série en cours" streak={day} words={(count) => plural(count, 'jour', 'jours')} />
        <StreakFact
          label="Livraisons à l’heure"
          streak={delivery}
          words={(count) => `${String(count)} de suite`}
        />
        <div>
          <dt>Médaille</dt>
          <dd className="rw-member__rank">
            {medal === null ? (
              <span className="tm-muted">Pas encore de médaille</span>
            ) : (
              <>
                <CreatorObject kind={medal} size={28} earned />
                {medalName(medal)}
              </>
            )}
          </dd>
        </div>
      </dl>
      <p className="rw-member__label">Trophées</p>
      {earned.length === 0 ? (
        <p className="tm-muted rw-member__none">Aucun trophée pour l’instant.</p>
      ) : (
        <ul className="rw-member__trophies" aria-label="Trophées gagnés">
          {earned.map((kind) => (
            <li key={kind}>
              <CreatorObject kind={kind} size={28} earned />
              {CREATOR_TROPHY_NAMES[kind]}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
