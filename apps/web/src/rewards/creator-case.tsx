import type { TrophyCaseItem } from '@impera/contracts';

import type { TrophyCaseEntry } from './case/TrophyCaseView';
import {
  CREATOR_HOW_TO,
  CreatorObject,
  creatorObjectName,
  creatorRevealWordsOf,
  isCreatorMedal,
  isCreatorTrophy,
} from './creator-art';

/**
 * What is left before her next object, in her words (ADR 0108 § 6): days of routine, or deliveries on time. A delivery
 * streak says the count alone: its name and its shelf already say what it counts (recette 16/11, CRE-14). A trophy of
 * one gesture says how to earn it instead.
 */
function leftOf(progress: TrophyCaseItem['progress']): string | undefined {
  if (progress === null) return undefined;
  const missing = Math.max(progress.target - progress.current, 0);
  if (progress.unit === 'day') return `Encore ${String(missing)} ${missing > 1 ? 'jours' : 'jour'}`;
  if (progress.unit === 'delivery') return `Encore ${String(missing)}`;
  return undefined;
}

/**
 * The creator's objects on the shared case (ADR 0108 § 2): her names, her « comment le gagner », her drawings and her
 * reveal, all from creator-art (ADR 0107). A kind this screen does not know is left out.
 */
export function creatorEntry(item: TrophyCaseItem): TrophyCaseEntry | null {
  const { kind } = item;
  if (!isCreatorMedal(kind) && !isCreatorTrophy(kind)) return null;
  const name = creatorObjectName(kind);
  const words = creatorRevealWordsOf(item);
  if (name === null || words === null) return null;
  const how = CREATOR_HOW_TO[kind];
  const left = leftOf(item.progress);
  return {
    name,
    how,
    ...(left === undefined ? {} : { left }),
    art: (size, earned) => <CreatorObject kind={kind} size={size} earned={earned} />,
    reveal: { kicker: words.kicker, text: words.text, tone: words.tone },
  };
}
