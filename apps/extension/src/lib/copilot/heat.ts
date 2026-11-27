import type { CopilotAssist, CopilotCut, FanStanding } from '@impera/contracts';
import { fireAt } from '@impera/design-system';

import { missingWords } from './assist';
import { DESIRE_WORDS, type Standing } from './standing';

/**
 * His desire as fire, on top of the panel (maquette v4, « ok maquette » de Charles le 27/11): a flame, a track that warms
 * from cold to burning, the line where it becomes the moment to sell, and one word. Never a figure (ADR 0141 § 4): the
 * fill is placed from his band and the code's verdict, never from his score. Under a cut or a contested age nothing of
 * his desire is said; after a purchase it rests for the pause of the method.
 */

/** Where the line of the moment to sell sits on the track, in %. */
export const HEAT_MARK = 70;

/** The fill of each band, under the line; `good` alone crosses it. */
const LEVELS = { neutral: 22, playful: 48, hot: 64 } as const;
const BURNING = 86;
const REST = 30;
/** His direction moves the fill a little, never across the line. */
const NUDGE = 5;

/** The pause after a purchase (méthode : « pause 48 h après un achat »). */
const PAUSE_AFTER_PURCHASE_MS = 48 * 60 * 60 * 1000;

export interface Heat {
  /** The fill, 0 to 100, for `--_w`: a place on the track, never shown as a number. */
  readonly level: number;
  /** The colour at the tip of the fill, shared by the flame and the word. */
  readonly color: string | null;
  /** Above the line: the moment to sell. */
  readonly lit: boolean;
  /** After a purchase: neutral, the pause. */
  readonly rest: boolean;
  /** « chaud », « brûlant », « après achat · en pause ». */
  readonly word: string;
  /** What is missing to sell, said under the track when there is one (« il manque sa dispo »). */
  readonly note: string | null;
  /** What a screen reader says. */
  readonly label: string;
}

export interface HeatInput {
  readonly standing: Standing | null;
  readonly money: FanStanding | null;
  readonly assist: CopilotAssist | null;
  readonly cut: CopilotCut | null;
  readonly now: Date;
}

const recentPurchase = (money: FanStanding | null, now: Date): boolean =>
  money?.lastPurchaseAt != null && now.getTime() - Date.parse(money.lastPurchaseAt) < PAUSE_AFTER_PURCHASE_MS;

export function heatOf({ standing, money, assist, cut, now }: HeatInput): Heat | null {
  // What forbids the sale (a stop in red) takes the fire's place: nothing of his desire next to it (maquette v4, cadre 6).
  if (cut !== null || standing === null || standing.ageDisputed || standing.stops.length > 0) return null;
  const verdict = assist?.saleMoment?.verdict ?? null;
  const offering = assist?.nextMove?.kind === 'offer_step';
  // A step bought tonight with the next one offered: the script goes on, no pause yet.
  // The server's pause wins when it says one (its length is the creator's setting); else the panel's own reading.
  const paused =
    assist?.nextMove?.block === 'after_purchase' ||
    (recentPurchase(money, now) && !offering && verdict !== 'good');
  if (paused)
    return {
      level: REST,
      color: null,
      lit: false,
      rest: true,
      word: 'après achat · en pause',
      note: null,
      label: 'Son envie : en pause après un achat',
    };
  if (verdict === 'good')
    return {
      level: BURNING,
      color: fireAt(BURNING),
      lit: true,
      rest: false,
      word: 'brûlant',
      note: null,
      label: 'Son envie : brûlant, c’est le moment de vendre',
    };
  const band = standing.band;
  if (band === null) return null;
  const trend = assist?.signals.desireTrend ?? null;
  const nudge = trend === 'up' ? NUDGE : trend === 'down' ? -NUDGE : 0;
  const level = Math.min(HEAT_MARK - 2, Math.max(4, LEVELS[band] + nudge));
  const missing = assist?.saleMoment == null ? null : missingWords(assist.saleMoment);
  const word = DESIRE_WORDS[band];
  const note = missing === null ? null : `il manque ${missing}`;
  return {
    level,
    color: fireAt(level),
    lit: false,
    rest: false,
    word,
    note,
    label: `Son envie : ${word}${note === null ? '' : `, ${note}`}${trend === 'up' ? ', en hausse' : trend === 'down' ? ', en baisse' : ''}`,
  };
}
