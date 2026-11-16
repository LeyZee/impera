import type { TrophyCaseStreak } from '@impera/contracts';
import type { JSX } from 'react';

import { useCreatorTrophyCase } from './api';
import { CREATOR_TROPHY_NAMES, CreatorObject, highestMedal, isCreatorTrophy, medalName } from './creator-art';
import './rewards.css';

/** No-break spaces around the middle dot and before the colon (French typography, avis Design 16/11). */
const BEST = '\u00a0·\u00a0meilleure\u00a0: ';

/** An empty fact weighs less than a value: muted, normal weight, one turn of phrase for all (avis Design, 16/11). */
const Empty = ({ words }: { words: string }): JSX.Element => (
  <span className="rw-member__empty">{words}</span>
);

function StreakFact({
  label,
  streak,
  none,
}: {
  label: string;
  streak: TrophyCaseStreak | undefined;
  /** Agreed with what is counted: « Aucun » day, « Aucune » delivery (avis Design, 16/11). */
  none: string;
}): JSX.Element {
  const current = streak?.current ?? 0;
  const best = streak?.best ?? 0;
  return (
    <div>
      <dt>{label}</dt>
      <dd className="nv-num">
        {current === 0 && best === 0 ? (
          <Empty words={none} />
        ) : (
          <>
            {current}
            {/* A break is never read as a loss: her best stays beside it (ADR 0108 § 3, recette 16/11 CRE-02). */}
            {best > current ? (
              <span className="tm-muted">
                {BEST}
                {best}
              </span>
            ) : null}
          </>
        )}
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
        Ce que {name} a gagné. Ses séries viennent de ses routines et de ses livraisons, rien ne se règle ici.
      </p>
      <dl className="rw-member__facts">
        <StreakFact label="Jours de routine d’affilée" streak={day} none="Aucun pour l’instant" />
        <StreakFact label="Livraisons à l’heure d’affilée" streak={delivery} none="Aucune pour l’instant" />
        <div>
          <dt>Médaille</dt>
          <dd>
            {/* Its name alone: under 40 px a medal is a bare coin beside drawn trophies (avis Design, 16/11). */}
            {medal === null ? <Empty words="Aucune pour l’instant" /> : medalName(medal)}
          </dd>
        </div>
      </dl>
      <p className="rw-member__label">Trophées</p>
      {earned.length === 0 ? (
        <p className="rw-member__none">
          <Empty words="Aucun pour l’instant" />
        </p>
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
