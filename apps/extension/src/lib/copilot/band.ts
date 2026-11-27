import type { CopilotAssist, CopilotCut, DesireBand } from '@impera/contracts';

import type { IconName } from '../icons';

import { DESIRE_WORDS, type Standing } from './standing';

/**
 * The status band on top of the panel (Design 16/11, lot 0141-3): who he is, then whether one may write, as badges read
 * without reading. In red what forbids the sale, in amber what holds it back, then his desire as a flame and the
 * direction it takes, then the signals not to miss (ADR 0141 § 4). Nothing to say draws no badge.
 */

type BadgeTone = 'red' | 'amber' | 'neutral';

export interface Badge {
  readonly kind: 'stop' | 'care' | 'desire' | 'signal';
  readonly tone: BadgeTone;
  readonly icon: IconName;
  /** One or two words, as the CRM says them. */
  readonly words: string;
  /** His desire's direction since the message before (§ 4): its sense only, the figure stays in the CRM. */
  readonly trend: 'up' | 'down' | null;
  /** The desire badge's band, for its ramp of tints (Design 16/11): cold, a soft tint, the full tint. */
  readonly band: DesireBand | null;
  /** What a screen reader says: the whole badge in words. */
  readonly label: string;
}

const TREND_WORDS = { up: 'en hausse', down: 'en baisse' } as const;

/** Badges at most, past what forbids or holds back, which is always said (§ 14). */
const MAX_BADGES = 3;

const capital = (text: string): string => text.charAt(0).toLocaleUpperCase('fr-FR') + text.slice(1);

function desireBadge(standing: Standing, trend: 'up' | 'down' | null): Badge | null {
  if (standing.band === null && trend === null) return null;
  const words = standing.band === null ? 'désir' : DESIRE_WORDS[standing.band];
  const label = ['désir', standing.band === null ? null : DESIRE_WORDS[standing.band]]
    .filter((part): part is string => part !== null)
    .join(' ');
  return {
    kind: 'desire',
    tone: 'neutral',
    icon: 'flame',
    words,
    trend,
    band: standing.band,
    label: capital(trend === null ? label : `${label}, ${TREND_WORDS[trend]}`),
  };
}

/**
 * The badges of the band, and how many signals wait behind « +N ». What forbids, what holds back and his desire are
 * never folded; the signals fill up to three badges. While his age is contested nothing of his desire is said, and
 * under any cut no signal pushes to write or to sell (§ 9).
 */
const badge = (kind: Badge['kind'], tone: BadgeTone, icon: IconName, words: string): Badge => ({
  kind,
  tone,
  icon,
  words,
  trend: null,
  band: null,
  label: words,
});

export function bandBadges(
  standing: Standing,
  assist: CopilotAssist | null,
  cut: CopilotCut | null,
  open: boolean,
  /** False when the fire under his name says his desire (maquette v4, 27/11): no badge says it a second time. */
  withDesire = true,
): { readonly badges: readonly Badge[]; readonly hidden: number } {
  const held = [
    ...standing.stops.map((words) => badge('stop', 'red', 'ban', words)),
    ...standing.cares.map((words) => badge('care', 'amber', 'alert', words)),
    ...(standing.unread ? [badge('care', 'amber', 'alert', 'Limites non lues')] : []),
  ];
  const lively = cut === null ? assist : null;
  const direction = lively?.signals.desireTrend;
  const shownDesire =
    cut === 'age_doubt'
      ? null
      : desireBadge(standing, direction === 'up' || direction === 'down' ? direction : null);
  // Its tint only while nothing forbids or holds back: next to a stop, a warm badge would read as a second alert.
  const desire =
    shownDesire === null || (held.length === 0 && cut === null)
      ? shownDesire
      : { ...shownDesire, band: null };
  const parts = desire === null || !withDesire ? held : [...held, desire];
  const signals = [
    ...(lively?.signals.followUpDue === true ? [badge('signal', 'neutral', 'clock', 'Relance due')] : []),
    ...(lively?.sale?.offerPending === true
      ? [badge('signal', 'neutral', 'hourglass', 'Offre sans réponse')]
      : []),
  ];
  const room = Math.max(0, MAX_BADGES - parts.length);
  const hidden = open ? 0 : Math.max(0, signals.length - room);
  return { badges: [...parts, ...(hidden === 0 ? signals : signals.slice(0, room))], hidden };
}
